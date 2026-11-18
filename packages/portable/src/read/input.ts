import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Fault } from "@open-motion/workspace/contract";
import { fromRandomAccessReader, RandomAccessReader, type ZipFile } from "yauzl";
import { digest, invalid, limits } from "../contract.js";

/** Exact bounded reads; the caller owns immutable identity, cancellation and actual IO drain. */
export interface Input {
  readonly bytes: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}
export async function at(input: Input, offset: number, length: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    length > limits.chunkBytes ||
    offset + length > input.bytes
  )
    invalid("ZIP read exceeds fixed bounds");
  const bytes = await input.read(offset, length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) invalid("truncated ZIP read");
  return Buffer.from(bytes);
}
class Reader extends RandomAccessReader {
  constructor(private input: Input) {
    super();
  }
  _readStreamForRange(start: number, end: number) {
    const input = this.input;
    const chunks = async function* () {
      for (let offset = start; offset < end; offset += limits.chunkBytes)
        yield await at(input, offset, Math.min(limits.chunkBytes, end - offset));
    };
    return Readable.from(chunks(), { objectMode: false, highWaterMark: limits.chunkBytes });
  }
}
export function open(input: Input): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    fromRandomAccessReader(
      new Reader(input),
      input.bytes,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => (error ? reject(error) : zip ? resolve(zip) : reject(Error("ZIP reader missing"))),
    ),
  );
}

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Capture complete outer identity and recheck every full touched block before parser exposure. */
export async function verified(input: Input, expected: string): Promise<Input> {
  if (
    !digest.safeParse(expected).success ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 22 ||
    input.bytes > limits.archiveBytes ||
    typeof input.read !== "function"
  )
    invalid("invalid fixed archive identity");
  const original = { bytes: input.bytes, read: input.read.bind(input) },
    chunks: string[] = [],
    complete = createHash("sha256");
  for (let offset = 0; offset < original.bytes; offset += limits.chunkBytes) {
    const bytes = await at(original, offset, Math.min(limits.chunkBytes, original.bytes - offset));
    complete.update(bytes);
    chunks.push(hash(bytes));
  }
  if (`sha256:${complete.digest("hex")}` !== expected)
    throw new Fault("integrity", "archive digest does not match fixed intent");
  return {
    bytes: original.bytes,
    read: async (offset, length) => {
      const bytes = Buffer.alloc(length);
      let written = 0;
      while (written < length) {
        const position = offset + written,
          block = Math.floor(position / limits.chunkBytes),
          start = block * limits.chunkBytes,
          data = await at(original, start, Math.min(limits.chunkBytes, original.bytes - start));
        if (hash(data) !== chunks[block]) throw new Fault("integrity", "ZIP input changed after verification");
        const begin = position - start,
          count = Math.min(length - written, data.length - begin);
        bytes.set(data.subarray(begin, begin + count), written);
        written += count;
      }
      return bytes;
    },
  };
}
