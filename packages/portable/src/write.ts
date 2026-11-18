import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import type { Entry } from "./content.js";
import { type Archive, invalid, limits } from "./contract.js";

export interface StreamEntry {
  path: string;
  bytes: number;
  digest?: string;
  chunks(): Iterable<Uint8Array>;
}
export function buffered(entry: Entry): StreamEntry {
  const bytes = entry.bytes;
  return {
    path: entry.path,
    bytes: bytes.length,
    *chunks() {
      for (let at = 0; at < bytes.length; at += limits.chunkBytes) yield bytes.subarray(at, at + limits.chunkBytes);
    },
  };
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Capture bounded verification metadata, never retained media bytes. */
function verify(entry: StreamEntry) {
  const produce = entry.chunks.bind(entry),
    size = entry.bytes,
    hashes: string[] = [],
    lengths: number[] = [],
    complete = createHash("sha256");
  let crc = 0,
    total = 0;
  for (const chunk of produce()) {
    if (
      !(chunk instanceof Uint8Array) ||
      !chunk.byteLength ||
      chunk.byteLength > limits.chunkBytes ||
      total + chunk.byteLength > size
    )
      invalid("invalid portable stream chunk or size");
    total += chunk.byteLength;
    crc = crc32(chunk, crc) >>> 0;
    complete.update(chunk);
    hashes.push(hash(chunk));
    lengths.push(chunk.byteLength);
  }
  const digest = `sha256:${complete.digest("hex")}`;
  if (total !== size || (entry.digest !== undefined && entry.digest !== digest))
    invalid("portable stream size or digest mismatch");
  return {
    crc,
    *chunks() {
      let at = 0;
      for (const chunk of produce()) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength !== lengths[at] || hash(chunk) !== hashes[at])
          invalid("portable stream changed after verification");
        at++;
        // Consumers may modify output without changing another iteration or the source.
        yield Buffer.from(chunk);
      }
      if (at !== hashes.length) invalid("portable stream truncated after verification");
    },
  };
}
/** One deterministic classic ZIP writer for buffered payloads and verified snapshot readers. */
export function zip(entries: StreamEntry[]): Archive {
  const local: (() => Iterable<Uint8Array>)[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || offset + entry.bytes > limits.archiveBytes)
      invalid("portable ZIP exceeds limit");
    const name = Buffer.from(entry.path),
      body = verify(entry),
      header = Buffer.alloc(30),
      record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(body.crc, 14);
    header.writeUInt32LE(entry.bytes, 18);
    header.writeUInt32LE(entry.bytes, 22);
    header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(body.crc, 16);
    record.writeUInt32LE(entry.bytes, 20);
    record.writeUInt32LE(entry.bytes, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    local.push(function* () {
      yield Buffer.from(header);
      yield Buffer.from(name);
      yield* body.chunks();
    });
    central.push(record, name);
    offset += header.length + name.length + entry.bytes;
  }
  const directoryBytes = central.reduce((sum, chunk) => sum + chunk.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes, 12);
  end.writeUInt32LE(offset, 16);
  const bytes = offset + directoryBytes + end.length;
  if (bytes > limits.archiveBytes || entries.length > limits.entries) invalid("portable ZIP exceeds limit");
  function* chunks() {
    for (const entry of local) yield* entry();
    for (const part of [...central, end]) yield Buffer.from(part);
  }
  const complete = createHash("sha256");
  for (const part of chunks()) complete.update(part);
  return Object.freeze({ digest: `sha256:${complete.digest("hex")}`, bytes, entries: entries.length, chunks });
}
