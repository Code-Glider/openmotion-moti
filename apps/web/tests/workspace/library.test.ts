import type { TemplateOutput } from "@open-motion/templates/contract";
import { expect, it, vi } from "vitest";
import { Client, type Transport } from "@";
import { Library } from "@/lib/components/workspace/library.js";

type Catalog = TemplateOutput<"template_list">;
function catalog(title: string, count = 1): Catalog {
  return {
    catalog: null,
    templates: Array.from({ length: count }, (_, i) => ({
      id: `template-${i}`,
      title: `${title} ${i}`,
      description: "Verified metadata",
      contentHash: `sha256:${"a".repeat(64)}`,
      duration: 2,
      width: 320,
      height: 180,
      source: "fixture",
      license: "Apache-2.0",
      adaptations: [],
      files: [],
    })),
  };
}
it("fences catalogue responses across page changes and drains even an abort-ignoring transport", async () => {
  const pending: { resolve: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  const transport: Transport = (_url, init) =>
    new Promise((resolve) => pending.push({ resolve, signal: init?.signal }));
  const view = new Library(document, new Client("http://127.0.0.1:4100", "fixture", transport));
  document.body.append(view.element);
  view.activate(true);
  expect(pending).toHaveLength(1);
  view.activate(false);
  expect(pending[0]?.signal?.aborted).toBe(true);
  view.activate(true);
  pending[1]!.resolve(new Response(JSON.stringify(catalog("Current"))));
  await vi.waitFor(() => expect(view.element.textContent).toContain("Current 0"));
  pending[0]!.resolve(new Response(JSON.stringify(catalog("Obsolete"))));
  await vi.waitFor(() => expect(view.element.querySelector("button")?.disabled).toBe(false));
  expect(view.element.textContent).not.toContain("Obsolete");
  view.element.querySelector("button")!.click();
  view.activate(false);
  view.activate(true);
  expect(pending).toHaveLength(3);
  expect(view.element.textContent).toContain("刷新已暂停");
  expect(view.element.textContent).toContain("Current 0");
  expect(view.element.querySelector("button")!.disabled).toBe(false);
  pending[2]!.resolve(new Response(JSON.stringify(catalog("Late refresh"))));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(view.element.textContent).not.toContain("Late refresh");
  expect(view.element.textContent).toContain("刷新已暂停");
  view.element.querySelector("button")!.click();
  let drained = false;
  const close = view.dispose().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  pending[3]!.resolve(new Response(JSON.stringify(catalog("Disposed"))));
  await close;
  expect(view.element.isConnected).toBe(false);
});
it("retains catalogue and search on refresh failure and bounds local paging", async () => {
  let fail = false;
  const transport: Transport = async () => {
    if (fail) throw Error("offline");
    return new Response(JSON.stringify(catalog("Card", 13)));
  };
  const view = new Library(document, new Client("http://127.0.0.1:4100", "fixture", transport));
  document.body.append(view.element);
  try {
    view.activate(true);
    await vi.waitFor(() => expect(view.element.querySelectorAll("[data-template-id]")).toHaveLength(12));
    const [refresh, previous, next] = view.element.querySelectorAll("button");
    expect(previous!.disabled).toBe(true);
    next!.click();
    expect(view.element.querySelectorAll("[data-template-id]")).toHaveLength(1);
    expect(next!.disabled).toBe(true);
    const query = view.element.querySelector("input")!;
    query.value = "Card 12";
    query.dispatchEvent(new Event("input"));
    expect(previous!.disabled).toBe(true);
    fail = true;
    refresh!.click();
    await vi.waitFor(() => expect(view.element.textContent).toContain("保留上次目录"));
    expect(query.value).toBe("Card 12");
    expect(view.element.querySelector("[data-template-hash]")?.getAttribute("data-template-hash")).toBe(
      `sha256:${"a".repeat(64)}`,
    );
    fail = false;
    refresh!.click();
    await vi.waitFor(() => expect(view.element.textContent).not.toContain("保留上次目录"));
    expect(query.value).toBe("Card 12");
  } finally {
    await view.dispose();
  }
});
