import { runtimeProtocolMetadata } from "@open-motion/motion/protocol";
import type { Descriptor } from "@open-motion/templates/contract";
import { expect, it, vi } from "vitest";
import { Client, type Transport } from "@";
import { TemplateDetail } from "@/lib/components/workspace/detail.js";

it("fences stale template reads and drains a reader that ignores abort before disposing the detail", async () => {
  const descriptor = (id: string): Descriptor => ({
    id,
    title: id,
    description: "Verified source",
    contentHash: `sha256:${(id === "first" ? "a" : "b").repeat(64)}`,
    width: 320,
    height: 180,
    duration: 2,
    source: "fixture",
    license: "Apache-2.0",
    adaptations: [],
    files: [],
  });
  const pending: { template: Descriptor; resolve(response: Response): void; signal?: AbortSignal | null }[] = [],
    opened: string[] = [],
    closed: string[] = [];
  const transport: Transport = async (url, init) => {
    const input = JSON.parse(String(init?.body));
    if (String(url).endsWith("/api/template_read"))
      return new Promise((resolve) => pending.push({ template: descriptor(input.id), resolve, signal: init?.signal }));
    if (String(url).endsWith("/preview/template")) {
      opened.push(input.template.id);
      return new Response(
        JSON.stringify({ id: input.id, revision: input.template.contentHash, template: descriptor(input.template.id) }),
      );
    }
    if (String(url).endsWith("/preview/close")) {
      closed.push(input.id);
      return new Response("{}");
    }
    throw Error("unexpected detail request");
  };
  const detail = new TemplateDetail(document, new Client("http://127.0.0.1:4100", "fixture", transport), {
    back: () => {},
    create: () => {},
    resume: () => {},
  });
  const result = (template: Descriptor) =>
    new Response(
      JSON.stringify({ template, files: [{ path: "index.html", content: `<main>${template.title}</main>` }] }),
    );
  document.body.append(detail.element);
  try {
    detail.activate(true, descriptor("first"));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    detail.activate(true, descriptor("second"));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]!.signal?.aborted).toBe(true);
    pending[1]!.resolve(result(pending[1]!.template));
    await vi.waitFor(() => expect(detail.element.querySelector("iframe")).not.toBeNull());
    const frame = detail.element.querySelector("iframe")!;
    const send = (data: unknown) =>
      window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data }));
    send({ source: "hf-preview", type: "timeline", durationSeconds: 2, ...runtimeProtocolMetadata(30) });
    send({ source: "open-motion-fonts", protocolVersion: 1, ready: true });
    await vi.waitFor(() => expect(detail.element.textContent).toContain("预览就绪"));
    pending[0]!.resolve(result(pending[0]!.template));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(detail.element.querySelector("h1,h2,h3")?.textContent).toBe("second");
    expect(opened).toEqual(["second"]);
    detail.activate(false);
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    detail.activate(true, descriptor("first"));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    let drained = false;
    const close = detail.dispose().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drained).toBe(false);
    pending[2]!.resolve(result(pending[2]!.template));
    await close;
    expect(opened).toEqual(["second"]);
    expect(detail.element.isConnected).toBe(false);
  } finally {
    for (const read of pending) read.resolve(result(read.template));
    await detail.dispose();
  }
});
