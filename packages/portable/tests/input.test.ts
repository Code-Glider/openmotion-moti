import { createHash } from "node:crypto";
import { initialFiles } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { prepare, readInto } from "@";

const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function wave(size: number) {
  const bytes = Buffer.alloc(size, 7);
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
it("verifies a ZIP beyond one-resource bounds with64KiB reads and waits for each sink without whole-container allocation", async () => {
  const media = wave(16 * 1024 * 1024),
    archive = prepare({
      files: initialFiles(),
      resources: [
        { path: "assets/a.wav", name: "A", bytes: media },
        { path: "assets/b.wav", name: "B", bytes: media },
      ],
    }),
    bytes = Buffer.concat([...archive.chunks()]),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const reads: number[] = [],
    results: string[] = [];
  const allocate = vi.spyOn(Buffer, "alloc"),
    unsafe = vi.spyOn(Buffer, "allocUnsafe");
  let result: Awaited<ReturnType<typeof readInto>>;
  try {
    const pending = readInto(
      {
        bytes: bytes.length,
        read: async (offset, length) => {
          reads.push(length);
          return bytes.subarray(offset, offset + length);
        },
      },
      archive.digest,
      async (resource, data) => {
        results.push(resource.path);
        expect(hash(data)).toBe(resource.digest);
        if (results.length === 1) {
          entered.resolve();
          await release.promise;
        }
        return { path: resource.path, digest: resource.digest };
      },
    );
    await entered.promise;
    const captured = reads.length;
    await Promise.resolve();
    await Promise.resolve();
    expect(results).toHaveLength(1);
    expect(reads).toHaveLength(captured);
    release.resolve();
    result = await pending;
    expect(allocate.mock.calls.every(([size]) => size <= media.length)).toBe(true);
    expect(unsafe.mock.calls.every(([size]) => size <= media.length)).toBe(true);
  } finally {
    release.resolve();
    allocate.mockRestore();
    unsafe.mockRestore();
  }
  expect(Math.max(...reads)).toBeLessThanOrEqual(65536);
  expect(result.resources).toHaveLength(2);
  expect(result.files).toEqual(initialFiles().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}, 15000);
it("refuses a different valid container returned after outer verification before exposing its changed bytes", async () => {
  const first = prepare({ files: [{ path: "index.html", content: "<main>A</main>" }], resources: [] }),
    second = prepare({ files: [{ path: "index.html", content: "<main>B</main>" }], resources: [] }),
    a = Buffer.concat([...first.chunks()]),
    b = Buffer.concat([...second.chunks()]);
  expect(a.length).toBe(b.length);
  let changed = false;
  await expect(
    readInto(
      {
        bytes: a.length,
        read: async (offset, length) => {
          const source = changed ? b : a;
          if (offset + length === a.length) changed = true;
          return source.subarray(offset, offset + length);
        },
      },
      first.digest,
      () => {
        throw Error("must not reach a sink");
      },
    ),
  ).rejects.toMatchObject({ code: "integrity" });
});
it("rejects truncated random reads and wrong fixed outer identities", async () => {
  const archive = prepare({ files: initialFiles(), resources: [] }),
    bytes = Buffer.concat([...archive.chunks()]);
  await expect(
    readInto(
      { bytes: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length - 1) },
      archive.digest,
      () => null,
    ),
  ).rejects.toMatchObject({ code: "invalid" });
  await expect(
    readInto(
      { bytes: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) },
      hash(Buffer.from("wrong")),
      () => null,
    ),
  ).rejects.toMatchObject({ code: "integrity" });
});
it("propagates sink failure without returning a partial source", async () => {
  const media = wave(48),
    archive = prepare({ files: initialFiles(), resources: [{ path: "assets/a.wav", name: "A", bytes: media }] }),
    bytes = Buffer.concat([...archive.chunks()]);
  await expect(
    readInto(
      { bytes: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) },
      archive.digest,
      () => {
        throw Error("staging refused");
      },
    ),
  ).rejects.toThrow("staging refused");
});
