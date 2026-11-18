import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdir, open, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { initialFiles, Workspace } from "@open-motion/workspace";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceTransfers } from "@/transport/resources.js";
import { Upload } from "@/transport/upload.js";

vi.mock("node:fs/promises", async (load) => {
  const actual = await load<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
vi.mock("node:fs", async (load) => {
  const actual = await load<typeof import("node:fs")>();
  return { ...actual, readSync: vi.fn(actual.readSync), closeSync: vi.fn(actual.closeSync) };
});
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = fileURLToPath(new URL(`../../../../.artifacts/upload-staging/files/${randomUUID()}/`, import.meta.url));
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}
async function* source(bytes: Uint8Array) {
  yield bytes;
}

it("stages maximum bytes with bounded sequential partial writes, no whole-file allocation and no idle descriptors", async () => {
  const root = await fixture(),
    bytes = Buffer.alloc(16 * 1024 * 1024, 123),
    upload = new Upload(root, { bytes: bytes.length, digest: hash(bytes) }),
    actualOpen = vi.mocked(open).getMockImplementation()!;
  const handles: Awaited<ReturnType<typeof open>>[] = [],
    sizes: number[] = [];
  let active = 0,
    peak = 0;
  vi.mocked(open).mockImplementation(async (...args) => {
    const file = await actualOpen(...args),
      write = file.write.bind(file);
    handles.push(file);
    vi.spyOn(file, "write").mockImplementation(async (...params) => {
      const data = params[0] as unknown as Uint8Array;
      sizes.push(data.byteLength);
      peak = Math.max(peak, ++active);
      try {
        return await Reflect.apply(write, file, [data.subarray(0, 19997)]);
      } finally {
        active--;
      }
    });
    return file;
  });
  const allocate = vi.spyOn(Buffer, "alloc"),
    unsafe = vi.spyOn(Buffer, "allocUnsafe");
  await upload.write(source(bytes), new AbortController().signal);
  expect(allocate.mock.calls.filter(([size]) => size > 65536)).toEqual([]);
  expect(unsafe.mock.calls.filter(([size]) => size > 65536)).toEqual([]);
  allocate.mockRestore();
  unsafe.mockRestore();
  expect(upload.ready).toBe(true);
  expect(peak).toBe(1);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(65536);
  expect(handles.every((file) => file.fd === -1)).toBe(true);
  const [name] = await readdir(root);
  expect((await stat(join(root, name!))).size).toBe(bytes.length);
  expect((await stat(join(root, name!))).mode & 0o777).toBe(0o600);
  expect(hash(upload.read())).toBe(hash(bytes));
  expect(vi.mocked(fs.readSync).mock.calls.every((call) => Number((call as unknown as unknown[])[3]) <= 65536)).toBe(
    true,
  );
  expect(fs.closeSync).toHaveBeenCalledTimes(1);
  upload.close();
  expect(await readdir(root)).toEqual([]);
}, 15000);

it.each(["short", "long", "digest", "source", "cancel"])(
  "closes and removes a failed %s upload before same-ticket retry",
  async (kind) => {
    const root = await fixture(),
      bytes = Buffer.alloc(131076, 7),
      upload = new Upload(root, { bytes: bytes.length, digest: hash(bytes) }),
      controller = new AbortController();
    const broken = async function* () {
      if (kind === "short") {
        yield bytes.subarray(0, -1);
        return;
      }
      if (kind === "long") {
        yield bytes;
        yield Buffer.from([1]);
        return;
      }
      if (kind === "digest") {
        yield Buffer.alloc(bytes.length, 8);
        return;
      }
      yield bytes.subarray(0, 65536);
      if (kind === "cancel") controller.abort();
      else throw Error("disconnected source");
      yield bytes.subarray(65536);
    };
    await expect(upload.write(broken(), controller.signal)).rejects.toThrow();
    expect(upload.ready).toBe(false);
    expect(await readdir(root)).toEqual([]);
    for (const result of vi.mocked(open).mock.results) {
      if (result.type === "return") expect((await result.value).fd).toBe(-1);
    }
    await upload.write(source(bytes), new AbortController().signal);
    expect(hash(upload.read())).toBe(hash(bytes));
    upload.close();
  },
);

it.each(["overwrite", "truncate", "replace", "symlink"])(
  "rejects %s staging before immutable bytes reach Workspace",
  async (kind) => {
    const root = await fixture(),
      bytes = Buffer.alloc(131076, 3),
      upload = new Upload(root, { bytes: bytes.length, digest: hash(bytes) });
    await upload.write(source(bytes), new AbortController().signal);
    const path = join(root, (await readdir(root))[0]!);
    if (kind === "overwrite") await writeFile(path, Buffer.alloc(bytes.length, 5));
    if (kind === "truncate") await writeFile(path, bytes.subarray(0, 44));
    if (kind === "replace" || kind === "symlink") {
      await unlink(path);
      if (kind === "replace") await writeFile(path, bytes);
      else {
        await writeFile(join(root, "unrelated"), bytes);
        await symlink(join(root, "unrelated"), path);
      }
    }
    expect(() => upload.read()).toThrow();
    if (kind !== "symlink") expect(fs.closeSync).toHaveBeenCalledTimes(1);
    upload.close();
    if (kind === "symlink") expect(await readdir(root)).toEqual(["unrelated"]);
    else expect(await readdir(root)).toEqual([]);
  },
);

it("verifies actual bytes and closes the read descriptor if the file changes during an import read", async () => {
  const root = await fixture(),
    bytes = Buffer.alloc(131076, 4),
    upload = new Upload(root, { bytes: bytes.length, digest: hash(bytes) });
  await upload.write(source(bytes), new AbortController().signal);
  const path = join(root, (await readdir(root))[0]!),
    actual = vi.mocked(fs.readSync).getMockImplementation()!;
  let changed = false;
  vi.mocked(fs.readSync).mockImplementation((...args) => {
    const count = Reflect.apply(actual, fs, args);
    if (!changed) {
      changed = true;
      fs.writeFileSync(path, Buffer.alloc(bytes.length, 6));
    }
    return count;
  });
  expect(() => upload.read()).toThrow();
  expect(fs.closeSync).toHaveBeenCalledTimes(1);
  upload.close();
});

it("requires composer-injected staging rather than silently retaining upload bytes in memory", async () => {
  const root = await fixture(),
    workspace = new Workspace(root);
  try {
    expect(() =>
      new ResourceTransfers(workspace, "http://fixture.invalid").execute("resource_upload", {
        requestId: randomUUID(),
        bytes: 1,
        digest: hash(Buffer.from([1])),
      }),
    ).toThrow("staging must be sidecar-injected");
  } finally {
    workspace.close();
  }
});

it("keeps the real write descriptor until an accepted write settles, then closes it before cancellation returns", async () => {
  const root = await fixture(),
    bytes = Buffer.alloc(131076, 4),
    upload = new Upload(root, { bytes: bytes.length, digest: hash(bytes) }),
    controller = new AbortController(),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    actualOpen = vi.mocked(open).getMockImplementation()!;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  vi.mocked(open).mockImplementation(async (...args) => {
    const file = await actualOpen(...args),
      write = file.write.bind(file);
    handle = file;
    vi.spyOn(file, "write").mockImplementation(async (...params) => {
      const pending = Reflect.apply(write, file, params);
      entered.resolve();
      await release.promise;
      return await pending;
    });
    return file;
  });
  let settled = false;
  const pending = upload.write(source(bytes), controller.signal).finally(() => {
    settled = true;
  });
  const rejected = expect(pending).rejects.toThrow();
  await entered.promise;
  controller.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(handle?.fd).toBeGreaterThanOrEqual(0);
  release.resolve();
  await rejected;
  expect(handle?.fd).toBe(-1);
  expect(await readdir(root)).toEqual([]);
});

it("returns an already committed receipt before an unrelated expired staging cleanup failure", async () => {
  const root = await fixture(),
    staging = join(root, "staging");
  await mkdir(staging);
  const workspace = new Workspace(root),
    transfers = new ResourceTransfers(workspace, "http://fixture.invalid", staging);
  let changed: string | undefined;
  try {
    const session = workspace.execute("session_create", { requestId: randomUUID(), title: "Receipt", mode: "motion" }),
      artifact = workspace.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Owner",
        files: initialFiles(),
      }),
      project = workspace.execute("project_read", { sessionId: session.id, artifactId: artifact.id }),
      bytes = Buffer.alloc(48);
    bytes.write("RIFF");
    bytes.writeUInt32LE(40, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(48000, 24);
    bytes.writeUInt32LE(96000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(4, 40);
    const intent = {
        requestId: randomUUID(),
        sessionId: session.id,
        artifactId: artifact.id,
        expectedRevision: project.revision,
        path: "assets/receipt.wav",
        name: "Receipt",
        bytes: bytes.length,
        digest: hash(bytes),
      },
      committed = workspace.importResource(intent, bytes),
      ticket = transfers.execute("resource_upload", {
        requestId: randomUUID(),
        bytes: bytes.length,
        digest: hash(bytes),
      });
    const request = Object.assign(Readable.from([bytes]), {
      url: new URL(ticket.url).pathname,
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
    });
    await transfers.transfer(
      request as unknown as IncomingMessage,
      { writeHead() {}, end() {} } as unknown as ServerResponse,
    );
    changed = join(staging, (await readdir(staging))[0]!);
    await unlink(changed);
    await mkdir(changed);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600001);
    expect(transfers.execute("resource_import", intent)).toEqual({ project: committed });
    expect(() => transfers.execute("resource_release", { id: ticket.id })).toThrow();
  } finally {
    if (changed) await rm(changed, { recursive: true });
    transfers.close();
    workspace.close();
  }
});
