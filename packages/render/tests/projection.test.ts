import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, digest } from "@odsuite/protocol";
import { initialFiles, resourceLimit, Workspace } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { freeze, readProjection, writeProjection } from "@";
import { Store } from "@/jobs/store.js";
import { materialize } from "@/projection/index.js";
import { projection } from "@/projection/write.js";

async function fixture(size = 2 * 65536 + 44) {
  const root = await mkdtemp(join(tmpdir(), "motion-projection-")),
    workspace = new Workspace(root),
    session = workspace.execute("session_create", { requestId: randomUUID(), mode: "motion", title: "Projection" }),
    artifact = workspace.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Media",
      files: initialFiles(),
    }),
    owner = { sessionId: session.id, artifactId: artifact.id },
    before = workspace.execute("project_read", owner),
    bytes = Buffer.alloc(size);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(192000, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let at = 44; at < bytes.length; at++) bytes[at] = at % 251;
  const input = {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: before.revision,
      path: "assets/tone.wav",
      name: "Original",
      digest: digest(bytes),
      bytes: bytes.length,
    },
    current = workspace.importResource(input, bytes),
    snapshot = freeze(workspace, { ...owner, revision: current.revision, fps: { num: 30, den: 1 } }),
    path = join(root, "projection.json");
  // Exact previous canonical Snapshot representation, independent of the streaming serializer.
  const legacy = Buffer.from(
    canonical({
      project: snapshot.project,
      spec: snapshot.spec,
      assets: [{ path: input.path, data: bytes.toString("base64") }],
    }),
  );
  return {
    root,
    workspace,
    owner,
    bytes,
    input,
    current,
    snapshot,
    path,
    legacy,
    finish: async () => {
      workspace.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function* streaming(source: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) {
  yield* source;
}
async function complete(source: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) {
    expect(chunk.length).toBeLessThanOrEqual(65536);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
it.each([131116, 131120, 131124])(
  "preserves every previous projection byte for %s-byte media and all base64 tails",
  async (size) => {
    const f = await fixture(size);
    try {
      expect(await complete(projection(f.snapshot))).toEqual(f.legacy);
      const identity = await writeProjection(f.snapshot, f.path);
      expect(identity).toEqual({ bytes: f.legacy.length, digest: digest(f.legacy) });
      expect(await readFile(f.path)).toEqual(f.legacy);
      const reopened = await readProjection(f.path, identity);
      expect(reopened.project).toEqual(f.snapshot.project);
      expect(reopened.spec).toEqual(f.snapshot.spec);
      expect(await complete(reopened.assets[0]!.chunks())).toEqual(f.bytes);
      expect(await complete(reopened.assets[0]!.chunks())).toEqual(f.bytes);
      const roundtrip = join(f.root, "again.json");
      expect(await writeProjection(reopened, roundtrip)).toEqual(identity);
    } finally {
      await f.finish();
    }
  },
);
it("reads an existing accepted input after Workspace closure and preserves exact original journal receipts", async () => {
  const f = await fixture();
  let store: Store | undefined;
  try {
    await writeFile(f.path, f.legacy);
    const identity = { bytes: f.legacy.length, digest: digest(f.legacy) },
      command = {
        ...f.owner,
        requestId: randomUUID(),
        revision: f.current.revision,
        fps: f.snapshot.spec.fps,
        projection: identity,
      };
    await mkdir(join(f.root, "renderer"), { recursive: true });
    store = new Store(join(f.root, "renderer"));
    const original = store.create(command);
    store.close();
    store = undefined;
    f.workspace.close();
    const reopened = await readProjection(f.path, identity);
    await materialize(reopened, join(f.root, "view"));
    expect(await readFile(join(f.root, "view/assets/tone.wav"))).toEqual(f.bytes);
    const next = join(f.root, "replay.json");
    expect(await writeProjection(reopened, next)).toEqual(identity);
    store = new Store(join(f.root, "renderer"));
    expect(store.create(command)).toEqual(original);
    expect(store.read(original.id).projection).toEqual(identity);
    expect(await readFile(join(f.root, "view/index.html"), "utf8")).toContain("__runtime.js");
  } finally {
    store?.close();
    await f.finish();
  }
});
it("never uses buffered resource reads and preserves removed historical bytes through maximum-size staging", async () => {
  const f = await fixture(resourceLimit);
  try {
    const execute = f.workspace.execute.bind(f.workspace);
    vi.spyOn(f.workspace, "execute").mockImplementation((operation, input) => {
      if (operation === "resource_read") throw Error("buffered resource read");
      return execute(operation, input);
    });
    const snapshot = freeze(f.workspace, { ...f.owner, revision: f.current.revision, fps: { num: 30, den: 1 } });
    f.workspace.execute("resource_remove", {
      ...f.owner,
      requestId: randomUUID(),
      expectedRevision: f.current.revision,
      path: f.input.path,
    });
    const identity = await writeProjection(snapshot, f.path),
      reopened = await readProjection(f.path, identity);
    await materialize(reopened, join(f.root, "view"));
    expect(digest(await readFile(join(f.root, "view/assets/tone.wav")))).toBe(f.input.digest);
    expect(identity.digest).toBe(digest(f.legacy));
    expect(f.workspace.execute("resource_import", f.input)).toEqual({ project: f.current });
  } finally {
    vi.restoreAllMocks();
    await f.finish();
  }
}, 15000);
it.each(["digest", "size", "syntax", "base64", "membership", "duplicate", "metadata", "trailing"])(
  "refuses %s input before exposing readers",
  async (kind) => {
    const f = await fixture();
    try {
      let raw = Buffer.from(f.legacy),
        expected = digest(raw),
        size = raw.length;
      if (kind === "digest") expected = digest("wrong");
      if (kind === "size") size++;
      if (kind === "syntax") raw = Buffer.from(raw.toString().replace('{"assets":[', '{"assets":[ '));
      if (kind === "base64") raw = Buffer.from(raw.toString().replace('"data":"', '"data":"!'));
      if (kind === "membership")
        raw = Buffer.from(raw.toString().replace('"path":"assets/tone.wav"', '"path":"assets/other.wav"'));
      if (kind === "duplicate") {
        const value = JSON.parse(raw.toString());
        value.assets.push(value.assets[0]);
        raw = Buffer.from(canonical(value));
      }
      if (kind === "metadata") {
        const value = JSON.parse(raw.toString());
        value.spec.width = "invalid";
        raw = Buffer.from(canonical(value));
      }
      if (kind === "trailing") raw = Buffer.concat([raw, Buffer.from(" ")]);
      if (!["digest", "size"].includes(kind)) {
        expected = digest(raw);
        size = raw.length;
      }
      await writeFile(f.path, raw);
      await expect(readProjection(f.path, { digest: expected, bytes: size })).rejects.toThrow();
    } finally {
      await f.finish();
    }
  },
);
it("rejects symlinks and later in-place/replacement changes before altered bytes can escape", async () => {
  const f = await fixture();
  try {
    const identity = await writeProjection(f.snapshot, f.path),
      link = join(f.root, "link.json");
    await symlink(f.path, link);
    await expect(readProjection(link, identity)).rejects.toThrow();
    const reopened = await readProjection(f.path, identity),
      stream = streaming(reopened.assets[0]!.chunks())[Symbol.asyncIterator]();
    const first = await stream.next();
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!)).toEqual(f.bytes.subarray(0, first.value!.length));
    const handle = await open(f.path, "r+");
    try {
      const at = f.legacy.indexOf(Buffer.from('"data":"')) + 8 + 100000;
      await handle.write(Buffer.from("!"), 0, 1, at);
    } finally {
      await handle.close();
    }
    await expect(stream.next()).rejects.toThrow("changed");
    await stream.return?.();
    await expect(complete(reopened.assets[0]!.chunks())).rejects.toThrow("changed");
  } finally {
    await f.finish();
  }
});
it("closes actual file handles when cancelled during scan, iteration and decoded materialization", async () => {
  const f = await fixture(),
    probe = await open(f.path, "w"),
    prototype = Object.getPrototypeOf(probe),
    read = prototype.read,
    write = prototype.write,
    handles = new Set<FileHandle>();
  await probe.close();
  let cancelRead: AbortController | undefined;
  vi.spyOn(prototype, "read").mockImplementation(async function (this: FileHandle, ...args: unknown[]) {
    handles.add(this);
    const result = await Reflect.apply(read, this, args);
    cancelRead?.abort(Error("cancelled scan"));
    cancelRead = undefined;
    return result;
  });
  vi.spyOn(prototype, "write").mockImplementation(function (this: FileHandle, ...args: unknown[]) {
    handles.add(this);
    return Reflect.apply(write, this, args);
  });
  try {
    await rm(f.path);
    const identity = await writeProjection(f.snapshot, f.path);
    expect([...handles].every((h) => h.fd === -1)).toBe(true);
    handles.clear();
    const controller = new AbortController();
    cancelRead = controller;
    await expect(readProjection(f.path, identity, controller.signal)).rejects.toThrow("cancelled scan");
    expect([...handles].every((h) => h.fd === -1)).toBe(true);
    handles.clear();
    const pending = await readProjection(f.path, identity),
      iterator = streaming(pending.assets[0]!.chunks())[Symbol.asyncIterator]();
    await iterator.next();
    expect([...handles].some((h) => h.fd !== -1)).toBe(true);
    await iterator.return?.();
    expect([...handles].every((h) => h.fd === -1)).toBe(true);
    handles.clear();
    const stop = new AbortController(),
      source = pending.assets[0]!,
      snapshot = {
        ...pending,
        assets: [
          {
            path: source.path,
            async *chunks() {
              for await (const bytes of source.chunks()) {
                yield bytes;
                stop.abort(Error("cancelled materialization"));
              }
            },
          },
        ],
      };
    await expect(materialize(snapshot, join(f.root, "cancelled"), stop.signal)).rejects.toThrow(
      "cancelled materialization",
    );
    expect([...handles].every((h) => h.fd === -1)).toBe(true);
  } finally {
    vi.restoreAllMocks();
    await f.finish();
  }
});

it("captures metadata before asynchronous output and closes a failed serializer without publishing bytes", async () => {
  const f = await fixture();
  try {
    const pending = writeProjection(f.snapshot, f.path);
    f.snapshot.project.files[0]!.content = "later mutation";
    f.snapshot.spec.width = 2;
    expect(await pending).toEqual({ bytes: f.legacy.length, digest: digest(f.legacy) });
    expect(await readFile(f.path)).toEqual(f.legacy);
    const wrong = {
      ...f.snapshot,
      assets: [
        {
          path: f.input.path,
          *chunks() {
            yield new Uint8Array([0]);
          },
        },
      ],
    };
    await expect(writeProjection(wrong, join(f.root, "partial.json"))).rejects.toThrow("integrity");
    expect(await readProjection(f.path, { bytes: f.legacy.length, digest: digest(f.legacy) })).toBeDefined();
  } finally {
    await f.finish();
  }
});

it("loads and reserializes existing silent projections without media", async () => {
  const f = await fixture();
  try {
    const snapshot = freeze(f.workspace, { ...f.owner, revision: f.input.expectedRevision, fps: { num: 30, den: 1 } });
    const old = Buffer.from(canonical(snapshot));
    const identity = await writeProjection(snapshot, f.path);
    expect(await readFile(f.path)).toEqual(old);
    const reopened = await readProjection(f.path, identity);
    expect(reopened.assets).toEqual([]);
    expect(reopened.project).toEqual(snapshot.project);
    await materialize(reopened, join(f.root, "silent"));
    expect(await writeProjection(reopened, join(f.root, "silent.json"))).toEqual(identity);
  } finally {
    await f.finish();
  }
});

it("preserves ordered multi-asset projections including deduplicated byte identities", async () => {
  const f = await fixture();
  try {
    const second = f.workspace.importResource(
      {
        ...f.input,
        requestId: randomUUID(),
        expectedRevision: f.current.revision,
        path: "assets/second.wav",
        name: "第二段",
      },
      f.bytes,
    );
    const snapshot = freeze(f.workspace, { ...f.owner, revision: second.revision, fps: { num: 30, den: 1 } });
    const old = Buffer.from(
      canonical({
        project: snapshot.project,
        spec: snapshot.spec,
        assets: snapshot.project.resources.map((resource) => ({
          path: resource.path,
          data: f.bytes.toString("base64"),
        })),
      }),
    );
    const identity = await writeProjection(snapshot, f.path);
    expect(await readFile(f.path)).toEqual(old);
    const reopened = await readProjection(f.path, identity);
    expect(reopened.assets.map((asset) => asset.path)).toEqual(
      snapshot.project.resources.map((resource) => resource.path),
    );
    await materialize(reopened, join(f.root, "multiple"));
    for (const resource of second.resources)
      expect(await readFile(join(f.root, "multiple", resource.path))).toEqual(f.bytes);
  } finally {
    await f.finish();
  }
});
