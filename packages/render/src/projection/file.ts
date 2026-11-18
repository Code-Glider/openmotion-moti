import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

export const chunkSize = 65536,
  projectionLimit = 128 * 1024 ** 2;
export const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const identity = (s: BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
export async function checked(path: string, size: number, witness?: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat({ bigint: true }),
      value = identity(info);
    if (!info.isFile() || Number(info.size) !== size || (witness !== undefined && value !== witness))
      throw Error("frozen export input changed or is not a regular file");
    return { file, witness: value };
  } catch (error) {
    await file.close();
    throw error;
  }
}
export async function unchanged(file: FileHandle, witness: string) {
  if (identity(await file.stat({ bigint: true })) !== witness) throw Error("frozen export input changed during read");
}
export async function block(file: FileHandle, at: number, size: number, signal?: AbortSignal) {
  const bytes = Buffer.alloc(Math.min(chunkSize, size - at));
  let done = 0;
  while (done < bytes.length) {
    signal?.throwIfAborted();
    const next = await file.read(bytes, done, bytes.length - done, at + done);
    if (!next.bytesRead) throw Error("frozen export input is truncated");
    done += next.bytesRead;
  }
  return bytes;
}
/** All output belongs to the caller's existing granted staging/inbox root. */
export async function persist(
  path: string,
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
  expected?: { bytes: number; digest: string },
) {
  const file = await open(path, "wx", 0o600),
    complete = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      if (
        !(chunk instanceof Uint8Array) ||
        chunk.length > chunkSize ||
        bytes + chunk.length > (expected?.bytes ?? projectionLimit)
      )
        throw Error("export stream exceeds fixed bounds");
      complete.update(chunk);
      bytes += chunk.length;
      let at = 0;
      while (at < chunk.length) {
        signal?.throwIfAborted();
        const written = await file.write(chunk.subarray(at));
        if (!written.bytesWritten) throw Error("export stream write made no progress");
        at += written.bytesWritten;
      }
    }
    signal?.throwIfAborted();
    const digest = `sha256:${complete.digest("hex")}`;
    if (expected && (bytes !== expected.bytes || digest !== expected.digest))
      throw Error("export resource integrity mismatch");
    await file.sync();
    return { bytes, digest };
  } finally {
    await file.close();
  }
}
