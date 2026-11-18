import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import { identifyResource } from "@open-motion/workspace";
import type { Resource, SourceFile } from "@open-motion/workspace/contract";
import { Fault, resourceBytesLimit, type SourcePayload, sourceLimits } from "@open-motion/workspace/contract";
import type { Entry, ZipFile } from "yauzl";
import { content } from "../content.js";
import { digest, invalid, inventory, limits, manifestPath, names } from "../contract.js";
import { at, type Input, open, verified } from "./input.js";
import { entries, envelope } from "./scan.js";

async function collect(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, expected: string) {
  if (!digest.safeParse(expected).success) invalid("invalid fixed archive digest");
  const chunks: Buffer[] = [],
    hash = createHash("sha256");
  let total = 0,
    pending: Buffer | undefined,
    used = 0;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) invalid("archive chunks must be bytes");
    total += chunk.byteLength;
    if (total > limits.archiveBytes) invalid("archive exceeds 72 MiB");
    for (let at = 0; at < chunk.byteLength; ) {
      pending ??= Buffer.allocUnsafe(limits.chunkBytes);
      const length = Math.min(pending.length - used, chunk.byteLength - at);
      pending.set(chunk.subarray(at, at + length), used);
      hash.update(pending.subarray(used, used + length));
      used += length;
      at += length;
      if (used === pending.length) {
        chunks.push(pending);
        pending = undefined;
        used = 0;
      }
    }
  }
  if (`sha256:${hash.digest("hex")}` !== expected)
    throw new Fault("integrity", "archive digest does not match fixed intent");
  if (pending && used) chunks.push(pending.subarray(0, used));
  return Buffer.concat(chunks, total);
}
async function extract(zip: ZipFile, entry: Entry): Promise<Buffer> {
  const stream = await new Promise<Readable>((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) =>
      error ? reject(error) : stream ? resolve(stream) : reject(Error("ZIP stream missing")),
    ),
  );
  const bytes = Buffer.allocUnsafe(entry.uncompressedSize);
  let size = 0,
    crc = 0;
  try {
    for await (const chunk of stream) {
      if (size + chunk.length > entry.uncompressedSize) invalid("ZIP entry expanded beyond declaration");
      bytes.set(chunk, size);
      crc = crc32(bytes.subarray(size, size + chunk.length), crc) >>> 0;
      size += chunk.length;
    }
    if (size !== entry.uncompressedSize || crc !== entry.crc32) invalid("ZIP entry size or CRC mismatch");
    return bytes;
  } finally {
    stream.destroy();
  }
}
/** Caller supplies verified bounded random reads and owns all actual IO/drain/staging. */
export async function readInto<T>(
  input: Input,
  expected: string,
  retain: (resource: Resource, bytes: Uint8Array) => T | Promise<T>,
): Promise<{ files: SourceFile[]; resources: T[] }> {
  let zip: ZipFile | undefined, fault: Error | undefined;
  try {
    input = await verified(input, expected);
    const shape = envelope(await at(input, input.bytes - 22, 22), input.bytes);
    zip = await open(input);
    zip.on("error", (error) => {
      fault = error;
    });
    const scanned = await entries(zip, input, shape.directory);
    if (fault) throw fault;
    if (scanned.found.length !== shape.count || scanned.central !== shape.size) invalid("ZIP inventory count mismatch");
    const map = new Map(scanned.found.map((entry) => [entry.fileName, entry])),
      meta = map.get(manifestPath);
    if (!meta) invalid("portable inventory missing");
    const metadata = await extract(zip, meta),
      parsed = inventory.safeParse(JSON.parse(metadata.toString("utf8")));
    if (!parsed.success || JSON.stringify(parsed.data) !== metadata.toString("utf8"))
      invalid("invalid canonical portable inventory");
    const selected = parsed.data,
      claims = [...selected.files, ...selected.resources];
    names([manifestPath, ...claims.map((claim) => claim.path)]);
    if (
      selected.files.reduce((sum, file) => sum + file.bytes, 0) > sourceLimits.bytes ||
      selected.resources.reduce((sum, resource) => sum + resource.bytes, 0) > resourceBytesLimit
    )
      invalid("portable inventory content exceeds limits");
    if (map.size !== claims.length + 1) invalid("unlisted ZIP content");
    for (const claim of claims)
      if (!map.has(claim.path) || map.get(claim.path)!.uncompressedSize !== claim.bytes)
        invalid("ZIP inventory size/name mismatch");
    const files: SourceFile[] = [],
      resources: T[] = [],
      facts: Resource[] = [];
    for (const claim of selected.files) {
      const data = await extract(zip, map.get(claim.path)!);
      if (Buffer.from(data.toString("utf8")).compare(data)) invalid("source bytes are not valid UTF-8");
      files.push({ path: claim.path, content: data.toString("utf8") });
    }
    const source = content({ files, resources: [] });
    for (const claim of selected.resources) {
      const bytes = await extract(zip, map.get(claim.path)!),
        resource = identifyResource(claim.path, claim.name, bytes);
      if (JSON.stringify(resource) !== JSON.stringify(claim)) invalid("portable content facts or hashes changed");
      facts.push(resource);
      resources.push(await retain(resource, bytes));
    }
    facts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (JSON.stringify({ ...source.inventory, resources: facts }) !== JSON.stringify(selected))
      invalid("portable content facts or hashes changed");
    if (fault) throw fault;
    return { files: source.payload.files, resources };
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault("invalid", error instanceof Error ? error.message : "portable ZIP could not be verified");
  } finally {
    zip?.close();
  }
}
/** Independent bounded in-memory input remains available; both paths share the exact verifier. */
export async function read(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  expected: string,
): Promise<SourcePayload> {
  try {
    const bytes = await collect(source, expected);
    return await readInto(
      { bytes: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) },
      expected,
      (resource, bytes) => ({ path: resource.path, name: resource.name, bytes }),
    );
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault("invalid", error instanceof Error ? error.message : "portable ZIP could not be verified");
  }
}
