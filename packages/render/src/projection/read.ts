import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { canonical } from "@odsuite/protocol";
import {
  id,
  resource,
  resourceBytesLimit,
  resourceCountLimit,
  resourceLimit,
  revision,
  schemas,
  sourceLimits,
} from "@open-motion/workspace/contract";
import { z } from "zod";
import { type Projection, specification } from "../jobs/contract.js";
import { block, checked, chunkSize, hash, projectionLimit, unchanged } from "./file.js";
import type { Snapshot } from "./index.js";

const metadata = z.strictObject({
  project: z.strictObject({
    id,
    artifactId: id,
    sessionId: id,
    revision,
    files: schemas.artifact_create.shape.files,
    resources: z.array(resource).max(resourceCountLimit),
  }),
  spec: specification,
});
/** Scanner for the existing canonical projection grammar; large base64 strings are never retained. */
class Scanner {
  private data = Buffer.alloc(0);
  private at = 0;
  private loaded = 0;
  readonly hashes: string[] = [];
  readonly complete = createHash("sha256");
  constructor(
    private file: FileHandle,
    private size: number,
    private signal?: AbortSignal,
  ) {}
  get position() {
    return this.loaded - this.data.length + this.at;
  }
  async fill() {
    if (this.at < this.data.length) return true;
    if (this.loaded === this.size) return false;
    this.data = await block(this.file, this.loaded, this.size, this.signal);
    this.loaded += this.data.length;
    this.at = 0;
    this.complete.update(this.data);
    this.hashes.push(hash(this.data));
    return true;
  }
  async peek() {
    if (!(await this.fill())) throw Error("truncated frozen projection grammar");
    return this.data[this.at];
  }
  async expect(text: string) {
    for (const byte of Buffer.from(text)) {
      if ((await this.peek()) !== byte) throw Error("invalid frozen projection grammar");
      this.at++;
    }
  }
  async quoted(limit: number, base64 = false) {
    let length = 0,
      padding = 0;
    const parts: Buffer[] = [];
    for (;;) {
      if (!(await this.fill())) throw Error("unterminated frozen projection string");
      const quote = this.data.indexOf(34, this.at),
        end = quote < 0 ? this.data.length : quote,
        part = this.data.subarray(this.at, end);
      length += part.length;
      if (length > limit) throw Error("frozen projection string exceeds bound");
      if (base64) {
        const text = part.toString("latin1"),
          match = /^([A-Za-z0-9+/]*)(=*)$/.exec(text);
        if (!match || (padding > 0 && match[1])) throw Error("invalid frozen projection base64");
        padding += match[2]!.length;
        if (padding > 2) throw Error("invalid frozen projection base64");
      } else parts.push(Buffer.from(part));
      this.at = end;
      if (quote >= 0) break;
    }
    if (base64 && length % 4) throw Error("invalid frozen projection base64 length");
    return { length, text: base64 ? "" : Buffer.concat(parts).toString("utf8") };
  }
  async rest() {
    const parts: Buffer[] = [];
    let size = 0;
    while (await this.fill()) {
      const part = this.data.subarray(this.at);
      size += part.length;
      if (size > 32 * 1024 ** 2) throw Error("frozen projection metadata exceeds bound");
      parts.push(Buffer.from(part));
      this.at = this.data.length;
    }
    const bytes = Buffer.concat(parts),
      text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes)) throw Error("invalid projection UTF-8");
    return text;
  }
}
async function* encoded(
  path: string,
  projection: Projection,
  witness: string,
  hashes: string[],
  start: number,
  length: number,
  signal?: AbortSignal,
) {
  const opened = await checked(path, projection.bytes, witness);
  try {
    for (let at = Math.floor(start / chunkSize) * chunkSize; at < start + length; at += chunkSize) {
      const bytes = await block(opened.file, at, projection.bytes, signal);
      if (hash(bytes) !== hashes[at / chunkSize]) throw Error("frozen projection chunk changed after verification");
      yield bytes.subarray(Math.max(0, start - at), Math.min(bytes.length, start + length - at));
    }
    await unchanged(opened.file, witness);
  } finally {
    await opened.file.close();
  }
}
async function* decoded(source: AsyncIterable<Uint8Array>) {
  let tail = "";
  for await (const chunk of source) {
    const text = tail + Buffer.from(chunk).toString("ascii"),
      end = text.length - (text.length % 4),
      part = text.slice(0, end),
      bytes = Buffer.from(part, "base64");
    if (bytes.toString("base64") !== part) throw Error("noncanonical frozen projection base64");
    if (bytes.length) yield bytes;
    tail = text.slice(end);
  }
  if (tail) throw Error("truncated frozen projection base64");
}
/** Complete identity verification and bounded metadata admission precede repeatable decoded readers. */
export async function readProjection(path: string, projection: Projection, signal?: AbortSignal): Promise<Snapshot> {
  if (
    !Number.isSafeInteger(projection.bytes) ||
    projection.bytes <= 0 ||
    projection.bytes > projectionLimit ||
    !/^sha256:[a-f0-9]{64}$/.test(projection.digest)
  )
    throw Error("invalid frozen export input");
  const opened = await checked(path, projection.bytes),
    scan = new Scanner(opened.file, projection.bytes, signal),
    ranges: { path: string; start: number; length: number }[] = [];
  try {
    await scan.expect('{"assets":[');
    if ((await scan.peek()) !== 93)
      for (;;) {
        if (ranges.length >= resourceCountLimit) throw Error("frozen projection resource count exceeds bound");
        await scan.expect('{"data":"');
        const start = scan.position,
          value = await scan.quoted(4 * Math.ceil(resourceLimit / 3), true);
        await scan.expect('","path":"');
        const name = await scan.quoted(240);
        await scan.expect('"}');
        ranges.push({ path: name.text, start, length: value.length });
        if ((await scan.peek()) === 93) break;
        await scan.expect(",");
      }
    await scan.expect('],"project":');
    const text = '{"project":' + (await scan.rest());
    if (`sha256:${scan.complete.digest("hex")}` !== projection.digest)
      throw Error("frozen export input integrity mismatch");
    await unchanged(opened.file, opened.witness);
    signal?.throwIfAborted();
    const parsed = metadata.parse(JSON.parse(text));
    if (
      canonical(parsed) !== text ||
      parsed.project.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > sourceLimits.bytes ||
      parsed.project.resources.reduce((n, r) => n + r.bytes, 0) > resourceBytesLimit
    )
      throw Error("invalid canonical projection metadata");
    if (ranges.length !== parsed.project.resources.length || new Set(ranges.map((r) => r.path)).size !== ranges.length)
      throw Error("frozen projection resource membership mismatch");
    for (const range of ranges) {
      const resource = parsed.project.resources.find((r) => r.path === range.path);
      if (!resource || range.length !== 4 * Math.ceil(resource.bytes / 3))
        throw Error("frozen projection resource membership or size mismatch");
    }
    return {
      ...parsed,
      assets: ranges.map((range) => ({
        path: range.path,
        chunks: () =>
          decoded(encoded(path, projection, opened.witness, scan.hashes, range.start, range.length, signal)),
      })),
    };
  } finally {
    await opened.file.close();
  }
}
