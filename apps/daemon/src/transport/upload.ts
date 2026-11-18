import { createHash, randomUUID } from "node:crypto";
import { type BigIntStats, closeSync, constants, fstatSync, openSync, readSync, unlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { Fault } from "@open-motion/workspace";

const chunkBytes = 65536;
const identity = (s: BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
/** Reversible bytes within the composer's attempt grant; no persistent store or receipt. */
export class Upload {
  private path: string;
  private witness?: string;
  constructor(
    root: string,
    private expected: { bytes: number; digest: string },
  ) {
    this.path = join(root, `${randomUUID()}.upload`);
  }
  get ready() {
    return this.witness !== undefined;
  }
  async write(source: AsyncIterable<Uint8Array>, signal: AbortSignal) {
    signal.throwIfAborted();
    const file = await open(this.path, "wx", 0o600),
      hash = createHash("sha256");
    let size = 0,
      witness: string | undefined;
    try {
      for await (const chunk of source) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || size + chunk.length > this.expected.bytes)
          throw new Fault("invalid", "resource upload exceeds fixed size");
        for (let at = 0; at < chunk.length; ) {
          signal.throwIfAborted();
          const part = chunk.subarray(at, at + chunkBytes);
          let written = 0;
          while (written < part.length) {
            signal.throwIfAborted();
            const result = await file.write(part.subarray(written));
            if (!result.bytesWritten) throw new Fault("integrity", "resource staging write made no progress");
            written += result.bytesWritten;
          }
          hash.update(part);
          size += part.length;
          at += part.length;
        }
      }
      if (size !== this.expected.bytes || `sha256:${hash.digest("hex")}` !== this.expected.digest)
        throw new Fault("invalid", "resource upload does not match fixed bytes/digest");
      await file.sync();
      signal.throwIfAborted();
      const info = await file.stat({ bigint: true });
      if (!info.isFile() || info.size !== BigInt(size)) throw new Fault("integrity", "resource staging changed");
      signal.throwIfAborted();
      witness = identity(info);
    } finally {
      await file.close();
      if (!witness) this.close();
    }
    if (signal.aborted) {
      this.close();
      signal.throwIfAborted();
    }
    this.witness = witness;
  }
  /** Only import materializes one bounded file for Workspace's existing checked format decoder. */
  read() {
    if (!this.witness) throw new Fault("missing", "resource upload is not ready");
    const fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd, { bigint: true });
      if (!info.isFile() || info.size !== BigInt(this.expected.bytes) || identity(info) !== this.witness)
        throw new Fault("integrity", "resource staging changed");
      const bytes = Buffer.alloc(this.expected.bytes),
        hash = createHash("sha256");
      for (let at = 0; at < bytes.length; ) {
        const count = readSync(fd, bytes, at, Math.min(chunkBytes, bytes.length - at), at);
        if (!count) throw new Fault("integrity", "resource staging is truncated");
        hash.update(bytes.subarray(at, at + count));
        at += count;
      }
      if (
        `sha256:${hash.digest("hex")}` !== this.expected.digest ||
        identity(fstatSync(fd, { bigint: true })) !== this.witness
      )
        throw new Fault("integrity", "resource staging changed during import");
      return bytes;
    } finally {
      closeSync(fd);
    }
  }
  close() {
    try {
      unlinkSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.witness = undefined;
  }
}
