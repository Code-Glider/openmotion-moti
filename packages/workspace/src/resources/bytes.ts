import { createHash } from "node:crypto";
import { Fault, type Resource } from "../contract.js";
import type { Database } from "../database.js";

export const resourceChunkSize = 64 * 1024;
type Identity = Pick<Resource, "digest" | "bytes">;
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Persistent user bytes, in the same SQLite transaction as manifests/history/receipts. */
export class ResourceBytes {
  constructor(private db: Database) {}
  layout(resource: Identity) {
    const row = this.db.one("SELECT bytes FROM resources WHERE digest=?", resource.digest),
      count = this.db.one("SELECT count(*) AS n FROM resource_chunks WHERE digest=?", resource.digest)?.n;
    if (row?.bytes !== resource.bytes || Number(count) !== Math.ceil(resource.bytes / resourceChunkSize))
      throw new Fault("integrity", "persistent resource bytes are missing or truncated");
  }
  chunk(resource: Identity, position: number): Uint8Array {
    const row = this.db.one(
        "SELECT c.bytes,r.bytes AS total FROM resource_chunks c JOIN resources r ON r.digest=c.digest WHERE c.digest=? AND c.position=?",
        resource.digest,
        position,
      ),
      value = row?.bytes;
    if (
      row?.total !== resource.bytes ||
      !(value instanceof Uint8Array) ||
      value.byteLength !== Math.min(resourceChunkSize, resource.bytes - position * resourceChunkSize)
    )
      throw new Fault("integrity", "persistent resource bytes are corrupt: chunk is missing or invalid");
    return value;
  }
  *chunks(resource: Identity) {
    this.layout(resource);
    for (let position = 0; position < Math.ceil(resource.bytes / resourceChunkSize); position++)
      yield this.chunk(resource, position);
  }
  verify(resource: Identity) {
    const complete = createHash("sha256");
    for (const bytes of this.chunks(resource)) complete.update(bytes);
    if (`sha256:${complete.digest("hex")}` !== resource.digest)
      throw new Fault("integrity", "persistent resource bytes are corrupt");
  }
  read(resource: Identity) {
    const bytes = Buffer.concat([...this.chunks(resource)]);
    if (hash(bytes) !== resource.digest) throw new Fault("integrity", "persistent resource bytes are corrupt");
    return bytes;
  }
  /** Caller owns the surrounding write transaction; duplicate identities must remain byte-identical. */
  retain(digest: string, bytes: Buffer) {
    const resource = { digest, bytes: bytes.length },
      prior = this.db.one("SELECT bytes FROM resources WHERE digest=?", digest);
    if (prior) {
      let offset = 0;
      for (const chunk of this.chunks(resource)) {
        if (!Buffer.from(chunk).equals(bytes.subarray(offset, offset + chunk.byteLength)))
          throw new Fault("integrity", "persistent resource content mismatch");
        offset += chunk.byteLength;
      }
      return;
    }
    if (this.db.one("SELECT digest FROM resource_chunks WHERE digest=? LIMIT 1", digest))
      throw new Fault("integrity", "persistent resource has orphan chunks");
    this.db.run("INSERT INTO resources VALUES(?,?)", digest, bytes.length);
    for (let at = 0; at < bytes.length; at += resourceChunkSize)
      this.db.run(
        "INSERT INTO resource_chunks VALUES(?,?,?)",
        digest,
        at / resourceChunkSize,
        bytes.subarray(at, at + resourceChunkSize),
      );
  }
}
