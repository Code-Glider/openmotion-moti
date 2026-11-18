import { createHash } from "node:crypto";
import { Fault, type Resource } from "../contract.js";
import type { Database } from "../database.js";
import { resourceChunkSize as chunkSize, ResourceBytes } from "./bytes.js";
import { checksum } from "./formats.js";

export interface ResourceReader {
  readonly resource: Resource;
  /** Repeatable verified chunks or an inclusive interval; full verification always precedes admission.
   * The caller drains readers before closing Workspace. */
  chunks(interval?: { start: number; end: number }): Iterable<Uint8Array>;
}

/** Existing persistent bytes remain in SQLite; only bounded verification metadata is retained. */
export function resourceReader(db: Database, resource: Resource, assertOpen: () => void): ResourceReader {
  const { digest, bytes } = resource,
    hashes: string[] = [],
    complete = createHash("sha256"),
    store = new ResourceBytes(db);
  function chunk(offset: number) {
    assertOpen();
    return store.chunk(resource, offset / chunkSize);
  }
  // The caller pins one read transaction across ownership, manifest and complete verification.
  store.layout(resource);
  for (let at = 0; at < bytes; at += chunkSize) {
    const value = chunk(at);
    complete.update(value);
    hashes.push(checksum(value));
  }
  if (`sha256:${complete.digest("hex")}` !== digest)
    throw new Fault("integrity", "persistent resource bytes are corrupt");
  return {
    resource: structuredClone(resource),
    *chunks(interval = { start: 0, end: bytes - 1 }) {
      assertOpen();
      const { start, end } = interval;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= bytes)
        throw new Fault("invalid", "invalid resource byte interval");
      store.layout(resource);
      for (let at = Math.floor(start / chunkSize) * chunkSize; at <= end; at += chunkSize) {
        const value = chunk(at);
        // A later database mutation cannot emit bytes under the previously verified identity.
        if (checksum(value) !== hashes[at / chunkSize])
          throw new Fault("integrity", "persistent resource bytes changed after verification");
        yield value.subarray(Math.max(0, start - at), Math.min(value.byteLength, end - at + 1));
      }
    },
  };
}
