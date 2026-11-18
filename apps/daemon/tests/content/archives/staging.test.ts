import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { prepare, read } from "@open-motion/portable";
import { initialFiles, Workspace } from "@open-motion/workspace";
import { afterEach, expect, it, vi } from "vitest";
import { Archives } from "@/content/archives/index.js";
import { Staging } from "@/content/archives/staging.js";

vi.mock("node:fs/promises", async (load) => {
  const actual = await load<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function fixture() {
  const root = fileURLToPath(
    new URL(`../../../../../.artifacts/archive-staging/files/${randomUUID()}/`, import.meta.url),
  );
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}
function wave(size: number) {
  const bytes = Buffer.alloc(size, 3);
  bytes.write("RIFF");
  bytes.writeUInt32LE(size - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(192000, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(size - 44, 40);
  return bytes;
}
async function* chunks(input: Iterable<Uint8Array>) {
  yield* input;
}
function archive(size = 131116, count = 2) {
  const bytes = wave(size);
  return prepare({
    files: initialFiles(),
    resources: Array.from({ length: count }, (_, at) => ({ path: `assets/${at}.wav`, name: `Sound${at}`, bytes })),
  });
}
it("stages64MiB of media without a whole-container Buffer, removes the raw ZIP, repeats POST and imports independent readers", async () => {
  const root = await fixture(),
    input = archive(16 * 1024 * 1024, 4),
    staged = new Staging(root, input),
    allocate = vi.spyOn(Buffer, "alloc"),
    unsafe = vi.spyOn(Buffer, "allocUnsafe");
  const data = await staged.write(chunks(input.chunks()), new AbortController().signal);
  expect(allocate.mock.calls.every(([size]) => size <= 16 * 1024 * 1024)).toBe(true);
  expect(unsafe.mock.calls.every(([size]) => size <= 16 * 1024 * 1024)).toBe(true);
  allocate.mockRestore();
  unsafe.mockRestore();
  const names = (await readdir(root)).sort();
  expect(names).toHaveLength(4);
  for (const name of names) {
    const info = await stat(join(root, name));
    expect(info.size).toBe(16 * 1024 * 1024);
    expect(info.mode & 0o777).toBe(0o600);
  }
  const repeated = await staged.write(chunks(input.chunks()), new AbortController().signal);
  expect(repeated).toBe(data);
  expect((await readdir(root)).sort()).toEqual(names);
  const dbRoot = join(root, "workspace");
  await mkdir(dbRoot);
  const workspace = new Workspace(dbRoot);
  const session = workspace.execute("session_create", { requestId: randomUUID(), title: "Reader", mode: "motion" }),
    intent = {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Large ZIP",
      source: { id: "portable-project", contentHash: input.digest },
    };
  try {
    const created = workspace.createSource(intent, data),
      project = workspace.execute("project_read", { sessionId: session.id, artifactId: created.id });
    expect(project.resources).toHaveLength(4);
    expect(project.resources.reduce((n, r) => n + r.bytes, 0)).toBe(64 * 1024 * 1024);
    staged.close();
    expect((await readdir(root)).sort()).toEqual(["workspace"]);
    expect(workspace.createSource(intent, data)).toEqual(created);
  } finally {
    workspace.close();
    staged.close();
  }
}, 15000);
it.each(["overwrite", "truncate", "replace", "symlink"])(
  "refuses %s of extracted media and rolls back the entire source transaction",
  async (kind) => {
    const root = await fixture(),
      input = archive(),
      staged = new Staging(root, input),
      data = await staged.write(chunks(input.chunks()), new AbortController().signal),
      path = join(root, (await readdir(root))[0]!),
      dbRoot = join(root, "db");
    await mkdir(dbRoot);
    const workspace = new Workspace(dbRoot),
      session = workspace.execute("session_create", { requestId: randomUUID(), title: "Fault", mode: "motion" }),
      intent = {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Rejected",
        source: { id: "portable-project", contentHash: input.digest },
      };
    try {
      if (kind === "overwrite") await writeFile(path, wave(131116));
      if (kind === "truncate") await writeFile(path, Buffer.from([1]));
      if (kind === "replace" || kind === "symlink") {
        await unlink(path);
        if (kind === "replace") await writeFile(path, wave(131116));
        else {
          await writeFile(join(root, "unrelated"), wave(131116));
          await symlink(join(root, "unrelated"), path);
        }
      }
      expect(() => workspace.createSource(intent, data)).toThrow();
      expect(workspace.sourceReceipt(intent)).toBeUndefined();
      expect(workspace.execute("session_get", { sessionId: session.id }).artifacts).toEqual([]);
      staged.close();
      expect((await readdir(root)).filter((name) => name.endsWith(".upload"))).toEqual([]);
      if (kind === "symlink") expect(hash(await readFile(join(root, "unrelated")))).toBe(hash(wave(131116)));
    } finally {
      workspace.close();
      staged.close();
    }
  },
);
it("drains an accepted native range read before rejecting cancellation and removing any staged file", async () => {
  const root = await fixture(),
    input = archive(),
    staged = new Staging(root, input),
    controller = new AbortController(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    actual = vi.mocked(open).getMockImplementation()!;
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  vi.mocked(open).mockImplementation(async (...args) => {
    const file = await actual(...args),
      read = file.read.bind(file);
    handles.push(file);
    vi.spyOn(file, "read").mockImplementation(async (...params) => {
      const pending = Reflect.apply(read, file, params);
      entered.resolve();
      await release.promise;
      return await pending;
    });
    return file;
  });
  let settled = false;
  const pending = staged.write(chunks(input.chunks()), controller.signal).finally(() => {
      settled = true;
    }),
    rejected = expect(pending).rejects.toThrow();
  try {
    await entered.promise;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(handles.some((file) => file.fd >= 0)).toBe(true);
    expect(() => staged.close()).toThrow("has not drained");
  } finally {
    release.resolve();
    await rejected;
  }
  expect(handles.every((file) => file.fd === -1)).toBe(true);
  expect(await readdir(root)).toEqual([]);
});
it("cleans earlier extracted media after a later actual file write fails and allows the same input to retry", async () => {
  const root = await fixture(),
    input = archive(),
    staged = new Staging(root, input),
    actual = vi.mocked(open).getMockImplementation()!;
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  let writes = 0;
  vi.mocked(open).mockImplementation(async (...args) => {
    const file = await actual(...args),
      write = file.write.bind(file);
    handles.push(file);
    if (args[1] === "wx" && ++writes === 3)
      vi.spyOn(file, "write").mockImplementation(async (...params) => {
        await Reflect.apply(write, file, params);
        throw Error("staged disk fault");
      });
    return file;
  });
  await expect(staged.write(chunks(input.chunks()), new AbortController().signal)).rejects.toMatchObject({
    code: "integrity",
    message: "archive media staging failed",
  });
  expect(writes).toBe(3);
  expect(handles.every((file) => file.fd === -1)).toBe(true);
  expect(await readdir(root)).toEqual([]);
  const data = await staged.write(chunks(input.chunks()), new AbortController().signal);
  expect(data.resources).toHaveLength(2);
  staged.close();
  expect(await readdir(root)).toEqual([]);
});

it("removes earlier extracted media when a later container body fails CRC after outer verification", async () => {
  const root = await fixture(),
    input = archive(),
    bytes = Buffer.concat([...input.chunks()]);
  let offset = 0,
    changed = false;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const nameLength = bytes.readUInt16LE(offset + 26),
      size = bytes.readUInt32LE(offset + 18),
      data = offset + 30 + nameLength;
    if (bytes.toString("utf8", offset + 30, data) === "assets/1.wav") {
      bytes[data + 44]! ^= 1;
      changed = true;
      break;
    }
    offset = data + size;
  }
  expect(changed).toBe(true);
  const staged = new Staging(root, { bytes: bytes.length, digest: hash(bytes) });
  await expect(staged.write(chunks([bytes]), new AbortController().signal)).rejects.toThrow("CRC");
  expect(vi.mocked(open).mock.calls.filter((call) => call[1] === "wx")).toHaveLength(2);
  expect(await readdir(root)).toEqual([]);
});
it("preserves staging and refuses retirement when a native close cannot be confirmed", async () => {
  const root = await fixture(),
    input = archive(),
    staged = new Staging(root, input),
    actual = vi.mocked(open).getMockImplementation()!;
  let retained: Awaited<ReturnType<typeof open>> | undefined, close: (() => Promise<void>) | undefined;
  vi.mocked(open).mockImplementation(async (...args) => {
    const file = await actual(...args);
    if (!retained) {
      retained = file;
      close = file.close.bind(file);
      vi.spyOn(file, "close").mockRejectedValue(Error("uncertain close"));
    }
    return file;
  });
  try {
    await expect(staged.write(chunks(input.chunks()), new AbortController().signal)).rejects.toThrow(
      "retirement is uncertain",
    );
    expect(retained?.fd).toBeGreaterThanOrEqual(0);
    expect(await readdir(root)).toHaveLength(1);
    expect(() => staged.close()).toThrow("has not drained");
  } finally {
    if (close) await close();
  }
});
it("replays a byte-backed archive receipt before an unrelated expired file cleanup fault", async () => {
  const root = await fixture(),
    dbRoot = join(root, "db");
  await mkdir(dbRoot);
  const workspace = new Workspace(dbRoot),
    input = archive(),
    transfers = new Archives(workspace, "http://fixture.invalid", root),
    session = workspace.execute("session_create", { requestId: randomUUID(), title: "Legacy", mode: "motion" }),
    intent = { requestId: randomUUID(), sessionId: session.id, title: "Original", digest: input.digest };
  let changed: string | undefined;
  try {
    const artifact = workspace.createSource(
        {
          requestId: intent.requestId,
          sessionId: session.id,
          title: intent.title,
          source: { id: "portable-project", contentHash: input.digest },
        },
        await read(input.chunks(), input.digest),
      ),
      ticket = transfers.execute("archive_upload", {
        requestId: randomUUID(),
        bytes: input.bytes,
        digest: input.digest,
      }),
      request = Object.assign(Readable.from(input.chunks()), {
        url: new URL(ticket.url).pathname,
        method: "POST",
        headers: { "content-type": "application/zip" },
      });
    await transfers.transfer(
      request as unknown as IncomingMessage,
      { writeHead() {}, end() {} } as unknown as ServerResponse,
    );
    changed = join(root, (await readdir(root)).find((name) => name.endsWith(".upload"))!);
    await unlink(changed);
    await mkdir(changed);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600001);
    expect(transfers.execute("archive_import", intent)).toEqual({ artifact });
    expect(() => transfers.execute("archive_release", { id: ticket.id })).toThrow();
  } finally {
    if (changed) await rm(changed, { recursive: true });
    transfers.close();
    workspace.close();
  }
});

it("refuses a replaced raw ZIP without exposing its granted path or deleting the symlink target", async () => {
  const root = await fixture(),
    input = archive(),
    staged = new Staging(root, input),
    target = join(root, "unrelated"),
    actual = vi.mocked(open).getMockImplementation()!;
  await writeFile(target, "unrelated owned fixture");
  let changed = false;
  vi.mocked(open).mockImplementation(async (...args) => {
    if (!changed && typeof args[1] === "number") {
      changed = true;
      await unlink(String(args[0]));
      await symlink(target, String(args[0]));
    }
    return actual(...args);
  });
  const error = await staged.write(chunks(input.chunks()), new AbortController().signal).then(
    () => undefined,
    (error: Error) => error,
  );
  expect(error).toMatchObject({ code: "integrity" });
  expect(error?.message).not.toContain(root);
  expect(await readdir(root)).toEqual(["unrelated"]);
  expect(await readFile(target, "utf8")).toBe("unrelated owned fixture");
});
