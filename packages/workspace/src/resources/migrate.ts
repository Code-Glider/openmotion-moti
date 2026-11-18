import { createHash } from "node:crypto";
import { Fault } from "../contract.js";
import type { Database } from "../database.js";
import { ResourceBytes, resourceChunkSize } from "./bytes.js";
import { resource, resourceBytesLimit, resourceCountLimit, resourceLimit } from "./contract.js";

/** Runs inside Database's one upgrade transaction. Never rewrites revisions or original receipts. */
export function migrateResourceBytes(db: Database) {
  db.sql.exec(`ALTER TABLE resources RENAME TO resource_blobs;
    CREATE TABLE resources(digest TEXT PRIMARY KEY NOT NULL,bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes BETWEEN 1 AND ${resourceLimit}));
    CREATE TABLE resource_chunks(digest TEXT NOT NULL REFERENCES resources(digest) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(typeof(position)='integer' AND position BETWEEN 0 AND ${resourceLimit / resourceChunkSize - 1}),
      bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes) BETWEEN 1 AND ${resourceChunkSize}),PRIMARY KEY(digest,position));`);
  const store = new ResourceBytes(db);
  // Accepted legacy files are individually bounded. Never load the whole retained byte inventory.
  for (const row of db.sql.prepare("SELECT digest,bytes FROM resource_blobs ORDER BY digest").iterate()) {
    const bytes = row.bytes;
    if (
      !(bytes instanceof Uint8Array) ||
      !bytes.byteLength ||
      bytes.byteLength > resourceLimit ||
      typeof row.digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(row.digest) ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== row.digest
    )
      throw new Fault("integrity", "legacy persistent resource bytes are invalid or corrupt");
    store.retain(row.digest, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }
  for (const row of db.sql.prepare("SELECT resources FROM revisions").iterate()) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(String(row.resources));
    } catch {
      throw new Fault("integrity", "legacy resource manifest is invalid");
    }
    const parsed = resource.array().max(resourceCountLimit).safeParse(manifest);
    if (!parsed.success || parsed.data.reduce((n, entry) => n + entry.bytes, 0) > resourceBytesLimit)
      throw new Fault("integrity", "legacy resource manifest is invalid");
    for (const entry of parsed.data) store.layout(entry);
  }
  db.sql.exec("DROP TABLE resource_blobs; PRAGMA user_version=8;");
}
