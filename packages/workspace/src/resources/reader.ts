import { createHash } from "node:crypto";
import { Fault, type Resource } from "../contract.js";
import type { Database } from "../database.js";
import { checksum } from "./formats.js";

export interface ResourceReader {
  readonly resource: Resource;
  /** Repeatable verified chunks; the caller drains readers before closing Workspace. */
  chunks(): Iterable<Uint8Array>;
}
const chunkSize = 64 * 1024;

/** Existing persistent bytes remain in SQLite; only bounded verification metadata is retained. */
export function resourceReader(db: Database, resource: Resource, assertOpen: () => void): ResourceReader {
  const { digest, bytes } = resource,
    hashes: string[] = [],
    complete = createHash("sha256");
  function chunk(offset: number) {
    assertOpen();
    if (Number(db.one("SELECT length(bytes) AS size FROM resources WHERE digest=?", digest)?.size) !== bytes)
      throw new Fault("integrity", "persistent resource bytes are missing or truncated");
    const value = db.one(
      "SELECT substr(bytes,?,?) AS bytes FROM resources WHERE digest=?",
      offset + 1,
      Math.min(chunkSize, bytes - offset),
      digest,
    )?.bytes;
    if (!(value instanceof Uint8Array) || value.byteLength !== Math.min(chunkSize, bytes - offset))
      throw new Fault("integrity", "persistent resource chunk is invalid");
    return value;
  }
  // The caller pins one read transaction across ownership, manifest and complete verification.
  for (let at = 0; at < bytes; at += chunkSize) {
    const value = chunk(at);
    complete.update(value);
    hashes.push(checksum(value));
  }
  if (`sha256:${complete.digest("hex")}` !== digest)
    throw new Fault("integrity", "persistent resource bytes are corrupt");
  return {
    resource: structuredClone(resource),
    *chunks() {
      for (let at = 0; at < bytes; at += chunkSize) {
        const value = chunk(at);
        // A later database mutation cannot emit bytes under the previously verified identity.
        if (checksum(value) !== hashes[at / chunkSize])
          throw new Fault("integrity", "persistent resource bytes changed after verification");
        yield value;
      }
    },
  };
}
