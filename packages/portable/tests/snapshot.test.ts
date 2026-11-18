import { createHash } from "node:crypto";
import { identifyResource, type ResourceReader } from "@open-motion/workspace";
import { expect, it } from "vitest";
import { prepare, prepareSnapshot, read } from "@";

function fixture() {
  const files = [{ path: "index.html", content: "<main>Golden 场景</main>" }],
    bytes = Buffer.alloc(2 * 65536 + 44);
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
  let reads = 0;
  const reader: ResourceReader = {
    resource: identifyResource("assets/golden.wav", "Original sound", bytes),
    *chunks() {
      for (let at = 0; at < bytes.length; at += 65536) {
        reads++;
        yield bytes.subarray(at, at + 65536);
      }
    },
  };
  return {
    files,
    bytes,
    reader,
    reads: () => reads,
    reset() {
      reads = 0;
    },
  };
}
it("preserves the pinned previous encoder bytes, digest, facts and independent output copies", async () => {
  const f = fixture(),
    archive = prepareSnapshot(f.files, [f.reader]),
    original = prepare({
      files: f.files,
      resources: [{ path: f.reader.resource.path, name: f.reader.resource.name, bytes: f.bytes }],
    });
  // Captured with the unmodified writer at f5af5cf455ddafdba09220f341584cd0119d85f9.
  expect({ digest: archive.digest, bytes: archive.bytes }).toEqual({
    digest: "sha256:cf6aec02339e9ca8a3d2977df613b2a1fa31eee5dc6cc785d6c4c8d6bbb31c79",
    bytes: 131880,
  });
  expect(Buffer.concat([...archive.chunks()])).toEqual(Buffer.concat([...original.chunks()]));
  f.files[0]!.content = "Changed after preparation";
  f.reader.resource.name = "Changed after preparation";
  const iterator = archive.chunks()[Symbol.iterator]();
  iterator.next().value?.fill(0);
  iterator.return?.();
  const decoded = await read(archive.chunks(), archive.digest);
  expect(decoded.files[0]?.content).toBe("<main>Golden 场景</main>");
  expect(decoded.resources[0]).toEqual({ path: "assets/golden.wav", name: "Original sound", bytes: f.bytes });
});
it("reads media on demand and refuses a changed future chunk before releasing it", () => {
  const f = fixture(),
    archive = prepareSnapshot(f.files, [f.reader]);
  f.reset();
  const iterator = archive.chunks()[Symbol.iterator]();
  while (!f.reads()) expect(iterator.next().done).toBe(false);
  expect(f.reads()).toBe(1);
  f.bytes[65536] = f.bytes[65536]! ^ 1;
  expect(() => iterator.next()).toThrow("changed after verification");
});
it.each(["short", "long", "oversized", "digest", "unstable"])(
  "rejects %s reader output before admitting an archive",
  (kind) => {
    const f = fixture(),
      reader = f.reader;
    let passes = 0;
    const bad: ResourceReader = {
      resource: { ...reader.resource },
      *chunks() {
        passes++;
        if (kind === "oversized") {
          yield f.bytes;
          return;
        }
        let at = 0;
        for (const chunk of reader.chunks()) {
          if (kind === "short" && at++ === 2) return;
          const value = Buffer.from(chunk);
          if ((kind === "digest" || (kind === "unstable" && passes > 1)) && !at++) value[0] = value[0]! ^ 1;
          yield value;
        }
        if (kind === "long") yield new Uint8Array([0]);
      },
    };
    expect(() => prepareSnapshot(f.files, [bad])).toThrow();
  },
);
it("checks reader count, aggregate, paths, metadata and repeatable stream completion", () => {
  const f = fixture();
  expect(() =>
    prepareSnapshot(
      f.files,
      Array.from({ length: 65 }, () => f.reader),
    ),
  ).toThrow("count");
  expect(() =>
    prepareSnapshot(
      f.files,
      Array.from({ length: 5 }, () => ({ ...f.reader, resource: { ...f.reader.resource, bytes: 16 * 1024 ** 2 } })),
    ),
  ).toThrow("64 MiB");
  expect(() => prepareSnapshot(f.files, [f.reader, f.reader])).toThrow("collision");
  expect(() =>
    prepareSnapshot(f.files, [{ ...f.reader, resource: { ...f.reader.resource, path: "assets/CON.wav" } }]),
  ).toThrow("reserved");
  expect(() => prepareSnapshot(f.files, [{ ...f.reader, resource: { ...f.reader.resource, bytes: 0 } }])).toThrow();
  let short = false;
  const reader: ResourceReader = {
      resource: f.reader.resource,
      *chunks() {
        if (!short) yield* f.reader.chunks();
      },
    },
    archive = prepareSnapshot(f.files, [reader]);
  short = true;
  expect(() => [...archive.chunks()]).toThrow("truncated after verification");
  expect(archive.digest).toBe(
    `sha256:${createHash("sha256")
      .update(Buffer.concat([...prepareSnapshot(f.files, [f.reader]).chunks()]))
      .digest("hex")}`,
  );
});
