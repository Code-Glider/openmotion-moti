import { randomUUID } from "node:crypto";
import type { Job } from "@open-motion/render/contract";
import { expect, it, vi } from "vitest";
import { Client, Editor } from "@";
import { Receipts } from "@/io.js";
import { Exports } from "@/lib/components/exports.js";
import { Recovery } from "@/lib/components/workspace/navigation/recovery.js";

it("confirms a lost export submission without saving a later source draft", async () => {
  const owner = { sessionId: randomUUID(), artifactId: randomUUID() },
    revision = `sha256:${"a".repeat(64)}` as const;
  const requests: unknown[] = [];
  const client = new Client("http://127.0.0.1:4100", "fixture", async (url, init) => {
    if (String(url).endsWith("/export_list")) return Response.json({ jobs: [], next: null });
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) throw Error("lost acknowledgement");
    return Response.json({ id: randomUUID(), ...owner, revision } as Job);
  });
  const editor = new Editor(client);
  editor.project = { ...owner, revision } as never;
  const save = vi.spyOn(editor, "save").mockResolvedValue();
  let flight: Promise<void> | undefined;
  const panel = new Exports(document, editor, client, (action) => {
    flight = action();
  });
  document.body.append(panel.element);
  try {
    panel.update(editor.project, false);
    panel.element.querySelector<HTMLButtonElement>("button")?.click();
    await expect(flight).rejects.toThrow("lost acknowledgement");
    editor.draft = "later unsaved source";
    editor.dirty = true;
    panel.update(editor.project, false);
    panel.element.querySelector<HTMLButtonElement>("button")?.click();
    await flight;
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(editor.draft).toBe("later unsaved source");
    expect(editor.dirty).toBe(true);
  } finally {
    await panel.dispose();
  }
});

it("retains bounded metadata across views, excludes upload grants and fails closed on storage errors", () => {
  sessionStorage.clear();
  const owner = { sessionId: randomUUID(), artifactId: randomUUID() },
    first = new Receipts(window),
    second = new Receipts(window),
    input = { ...owner, requestId: randomUUID(), revision: `sha256:${"a".repeat(64)}`, fps: { num: 30, den: 1 } };
  first.begin("export_create", input);
  const resource = {
    ...owner,
    requestId: randomUUID(),
    expectedRevision: input.revision,
    path: "assets/picture.png",
    name: "Picture",
    bytes: 3,
    digest: input.revision,
    uploadId: randomUUID(),
  };
  second.begin("resource_import", resource);
  const restored = new Receipts(window);
  expect(restored.error).toBeUndefined();
  expect(restored.list()).toHaveLength(2);
  expect(JSON.stringify(restored.list())).not.toContain(resource.uploadId);
  expect(restored.blocks("export_create", owner)).toBe(true);
  expect(() => restored.begin("export_create", { ...input, requestId: randomUUID() })).toThrow("original");
  expect(() => restored.begin("export_create", { ...input, fps: { num: 60, den: 1 } })).toThrow("payload changed");
  const original = restored.list().find((record) => record.operation === "export_create");
  if (!original) throw Error("missing export metadata");
  first.confirm(original);
  // A second mounted writer must not resurrect the first view's confirmed receipt.
  const imported = restored.list().find((record) => record.operation === "resource_import");
  if (!imported) throw Error("missing import metadata");
  second.confirm(imported);
  expect(new Receipts(window).list()).toEqual([]);
  sessionStorage.setItem("openmotion.pending-io.v1", "corrupt");
  const broken = new Receipts(window);
  expect(broken.error).toBeTruthy();
  expect(() => broken.begin("export_create", input)).toThrow();
  expect(sessionStorage.getItem("openmotion.pending-io.v1")).toBe("corrupt");
  sessionStorage.clear();
  const denied = new Receipts({
    get sessionStorage() {
      throw Error("denied");
    },
  } as unknown as Window);
  expect(() => denied.begin("export_create", input)).toThrow("storage is required");
});

it("keeps an absent receipt unconfirmed and exposes recovery even without an admitted project", async () => {
  sessionStorage.clear();
  const owner = { sessionId: randomUUID(), artifactId: randomUUID() },
    input = { ...owner, requestId: randomUUID(), revision: `sha256:${"a".repeat(64)}`, fps: { num: 30, den: 1 } };
  new Receipts(window).begin("export_create", input);
  const requests: { operation: string; input: unknown }[] = [];
  let found = false;
  const client = new Client("http://127.0.0.1:4100", "secret", async (url, init) => {
    requests.push({ operation: String(url).split("/").at(-1) ?? "", input: JSON.parse(String(init?.body)) });
    return Response.json({ job: found ? { id: randomUUID() } : null });
  });
  client.receipts = new Receipts(window);
  let flight: Promise<void> | undefined;
  const recovery = new Recovery(document, client, (action) => {
    flight = action();
  });
  recovery.update(false);
  expect(recovery.element.hidden).toBe(false);
  recovery.element.querySelector<HTMLButtonElement>("button")?.click();
  await flight;
  expect(client.receipts.list()).toHaveLength(1);
  expect(requests).toEqual([{ operation: "export_lookup", input: { ...input, operation: "export_create" } }]);
  found = true;
  recovery.element.querySelector<HTMLButtonElement>("button")?.click();
  await flight;
  expect(client.receipts.list()).toEqual([]);
  expect(requests.every((request) => request.operation === "export_lookup")).toBe(true);
  expect(JSON.stringify(sessionStorage)).not.toContain("secret");
  sessionStorage.clear();
});

it("refuses network admission when pending metadata is full or cannot be persisted", async () => {
  sessionStorage.clear();
  const receipts = new Receipts(window),
    sessionId = randomUUID(),
    command = () => ({
      sessionId,
      artifactId: randomUUID(),
      requestId: randomUUID(),
      revision: `sha256:${"b".repeat(64)}`,
      fps: { num: 30, den: 1 },
    });
  const transport = vi.fn();
  const client = new Client("http://127.0.0.1:4100", "secret", transport);
  client.receipts = receipts;
  for (let n = 0; n < 32; n++) receipts.begin("export_create", command());
  const before = sessionStorage.getItem("openmotion.pending-io.v1");
  await expect(client.execute("export_create", command())).rejects.toThrow("Confirm pending");
  expect(transport).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("openmotion.pending-io.v1")).toBe(before);
  sessionStorage.clear();
  const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("quota");
  });
  try {
    await expect(client.execute("export_create", command())).rejects.toThrow("quota");
    expect(transport).not.toHaveBeenCalled();
  } finally {
    failure.mockRestore();
    sessionStorage.clear();
  }
});
