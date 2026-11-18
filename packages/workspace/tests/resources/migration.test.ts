import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { initialFiles, resourceLimit, Workspace } from "@";

const hash = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function wave(size = 2 * 65536 + 44) {
  const bytes = Buffer.alloc(size);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(192000, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let at = 44; at < bytes.length; at++) bytes[at] = at % 251;
  return bytes;
}
function fixture(size?: number) {
  const root = mkdtempSync(join(tmpdir(), "motion-chunk-migration-")),
    workspace = new Workspace(root),
    session = workspace.execute("session_create", { requestId: randomUUID(), title: "Migration", mode: "motion" }),
    artifact = workspace.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Retained",
      files: initialFiles(),
    }),
    owner = { sessionId: session.id, artifactId: artifact.id },
    before = workspace.execute("project_read", owner),
    bytes = wave(size),
    input = {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: before.revision,
      path: "assets/tone.wav",
      name: "Tone",
      digest: hash(bytes),
      bytes: bytes.length,
    },
    imported = workspace.importResource(input, bytes),
    current = workspace.execute("resource_remove", {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: imported.revision,
      path: input.path,
    });
  workspace.execute("artifact_open", {
    ...owner,
    requestId: randomUUID(),
    expectedSelection: 0,
    expectedCurrent: null,
  });
  workspace.execute("workspace_configure", {
    requestId: randomUUID(),
    expectedVersion: 0,
    value: { theme: "dark", embeddedTheme: "light", layout: "preview", locale: "en" },
  });
  workspace.close();
  const file = join(root, "workspace.sqlite"),
    raw = new DatabaseSync(file);
  legacyResources(raw);
  return {
    root,
    file,
    raw,
    owner,
    bytes,
    input,
    imported,
    current,
    read: { ...owner, revision: imported.revision, path: input.path },
    finish: () => {
      raw.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
/** Reconstruct actual accepted schema7 byte storage before exercising older upgrades. */
function legacyResources(raw: DatabaseSync) {
  raw.exec(
    "BEGIN; ALTER TABLE resources RENAME TO resource_meta; CREATE TABLE resources(digest TEXT PRIMARY KEY,bytes BLOB NOT NULL);",
  );
  try {
    for (const row of raw.prepare("SELECT digest FROM resource_meta").all()) {
      const chunks = raw.prepare("SELECT bytes FROM resource_chunks WHERE digest=? ORDER BY position").all(row.digest!);
      raw
        .prepare("INSERT INTO resources VALUES(?,?)")
        .run(row.digest!, Buffer.concat(chunks.map((x) => Buffer.from(x.bytes as Uint8Array))));
    }
    raw.exec("DROP TABLE resource_chunks; DROP TABLE resource_meta; PRAGMA user_version=7; COMMIT;");
  } catch (error) {
    raw.exec("ROLLBACK");
    throw error;
  }
}

function legacyVersion(raw: DatabaseSync, version: number) {
  if (version < 4) raw.exec("DROP TABLE versions");
  if (version < 5) raw.exec("DROP TABLE preferences");
  else {
    if (version < 7) raw.exec("ALTER TABLE preferences DROP COLUMN embedded_theme");
    if (version < 6) raw.exec("ALTER TABLE preferences DROP COLUMN locale");
  }
  raw.exec(`PRAGMA user_version=${version}`);
}
function inventory(raw: DatabaseSync) {
  return raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name!='resources' ORDER BY name")
    .all()
    .map((row) => {
      const table = String(row.name),
        columns = raw
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((x) => String(x.name));
      return { table, columns, rows: raw.prepare(`SELECT ${columns.join(",")} FROM ${table} ORDER BY rowid`).all() };
    });
}
it("migrates a retained maximum-size resource into bounded chunks and deduplicates later imports", () => {
  const f = fixture(resourceLimit);
  let db: Workspace | undefined;
  const started = performance.now();
  try {
    db = new Workspace(f.root);
    const migrationMs = performance.now() - started,
      readStart = performance.now(),
      complete = createHash("sha256");
    let count = 0,
      total = 0,
      largest = 0;
    for (const chunk of db.readResource(f.read).chunks()) {
      count++;
      total += chunk.byteLength;
      largest = Math.max(largest, chunk.byteLength);
      complete.update(chunk);
    }
    const readMs = performance.now() - readStart;
    expect({ count, total, largest }).toEqual({ count: 256, total: resourceLimit, largest: 65536 });
    expect(`sha256:${complete.digest("hex")}`).toBe(f.input.digest);
    const duplicate = db.importResource(
      { ...f.input, requestId: randomUUID(), expectedRevision: f.current.revision, path: "assets/copy.wav" },
      f.bytes,
    );
    expect(duplicate.resources[0]?.digest).toBe(f.input.digest);
    expect(f.raw.prepare("SELECT count(*) AS n FROM resources").get()?.n).toBe(1);
    expect(f.raw.prepare("SELECT count(*) AS n FROM resource_chunks").get()?.n).toBe(256);
    expect(db.execute("resource_import", f.input)).toEqual({ project: f.imported });
    db.close();
    db = new Workspace(f.root);
    expect(hash(Buffer.concat([...db.readResource(f.read).chunks()]))).toBe(f.input.digest);
    const evidence = fileURLToPath(new URL(`../../../../.artifacts/resource-chunks/${randomUUID()}/`, import.meta.url));
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, "report.json"),
      JSON.stringify(
        {
          bytes: total,
          chunks: count,
          largestChunk: largest,
          digest: f.input.digest,
          migrationMs,
          readMs,
          deduplicated: true,
          coldRead: true,
        },
        null,
        2,
      ),
    );
  } finally {
    db?.close();
    f.finish();
  }
}, 15000);

it.each([3, 4, 5, 6, 7])(
  "upgrades accepted schema%s bytes atomically without rewriting retained domain rows or original receipts",
  (version) => {
    const f = fixture();
    let upgraded: Workspace | undefined;
    try {
      legacyVersion(f.raw, version);
      const before = inventory(f.raw),
        original = f.raw.prepare("SELECT bytes FROM resources WHERE digest=?").get(f.input.digest)?.bytes;
      expect(Buffer.from(original as Uint8Array).equals(f.bytes)).toBe(true);
      upgraded = new Workspace(f.root);
      expect(f.raw.prepare("PRAGMA user_version").get()?.user_version).toBe(8);
      for (const row of before)
        expect(f.raw.prepare(`SELECT ${row.columns.join(",")} FROM ${row.table} ORDER BY rowid`).all()).toEqual(
          row.rows,
        );
      expect(
        f.raw
          .prepare("SELECT length(bytes) AS n FROM resource_chunks ORDER BY position")
          .all()
          .map((x) => x.n),
      ).toEqual([65536, 65536, 44]);
      expect(f.raw.prepare("SELECT name FROM sqlite_master WHERE name='resource_blobs'").get()).toBeUndefined();
      expect(upgraded.execute("project_read", f.owner)).toEqual(f.current);
      expect(upgraded.execute("resource_import", f.input)).toEqual({ project: f.imported });
      expect(Buffer.concat([...upgraded.readResource(f.read).chunks()]).equals(f.bytes)).toBe(true);
      expect(upgraded.execute("resource_read", f.read).data).toBe(f.bytes.toString("base64"));
      upgraded.close();
      upgraded = new Workspace(f.root);
      expect(upgraded.execute("resource_import", f.input)).toEqual({ project: f.imported });
      expect(hash(Buffer.concat([...upgraded.readResource(f.read).chunks()]))).toBe(f.input.digest);
    } finally {
      upgraded?.close();
      f.finish();
    }
  },
);

it.each([3, 7].flatMap((version) => ["corrupt", "missing", "manifest"].map((kind) => ({ version, kind }))))(
  "leaves schema$version and every original database byte intact when legacy $kind data blocks migration",
  ({ version, kind }) => {
    const f = fixture();
    try {
      legacyVersion(f.raw, version);
      if (kind === "corrupt")
        f.raw
          .prepare("INSERT INTO resources VALUES(?,?)")
          .run(`sha256:${"f".repeat(64)}`, Buffer.from("corrupt orphan"));
      if (kind === "missing") f.raw.prepare("DELETE FROM resources WHERE digest=?").run(f.input.digest);
      if (kind === "manifest")
        f.raw.prepare("UPDATE revisions SET resources='invalid' WHERE revision=?").run(f.imported.revision);
      const before = hash(readFileSync(f.file));
      expect(() => new Workspace(f.root)).toThrow();
      expect(hash(readFileSync(f.file))).toBe(before);
      expect(f.raw.prepare("PRAGMA user_version").get()?.user_version).toBe(version);
      expect(
        f.raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('resource_chunks','resource_blobs')").all(),
      ).toEqual([]);
    } finally {
      f.finish();
    }
  },
);

it("rolls back every resource chunk, project/history and receipt if a later chunk insert fails", () => {
  const f = fixture();
  const db = new Workspace(f.root);
  try {
    const before = db.execute("project_read", f.owner),
      tables = inventory(f.raw).filter((row) => row.table !== "resource_chunks"),
      receiptCount = f.raw.prepare("SELECT count(*) AS n FROM requests").get()?.n,
      bytes = Buffer.from(f.bytes);
    bytes[44] = bytes[44]! ^ 1;
    const input = {
      ...f.input,
      requestId: randomUUID(),
      expectedRevision: before.revision,
      path: "assets/second.wav",
      digest: hash(bytes),
    };
    f.raw.exec(
      "CREATE TRIGGER reject_chunk BEFORE INSERT ON resource_chunks WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'chunk write failed'); END",
    );
    expect(() => db.importResource(input, bytes)).toThrow("chunk write failed");
    expect(db.execute("project_read", f.owner)).toEqual(before);
    expect(f.raw.prepare("SELECT count(*) AS n FROM requests").get()?.n).toBe(receiptCount);
    expect(f.raw.prepare("SELECT digest FROM resources WHERE digest=?").get(input.digest)).toBeUndefined();
    expect(f.raw.prepare("SELECT digest FROM resource_chunks WHERE digest=?").all(input.digest)).toEqual([]);
    for (const row of tables)
      expect(f.raw.prepare(`SELECT ${row.columns.join(",")} FROM ${row.table} ORDER BY rowid`).all()).toEqual(row.rows);
    f.raw.exec("DROP TRIGGER reject_chunk");
    expect(db.importResource(input, bytes).resources).toHaveLength(1);
  } finally {
    db.close();
    f.finish();
  }
});

it.each([3, 7])(
  "recovers an actual process kill during schema%s migration without changing the legacy snapshot",
  async (version) => {
    const f = fixture();
    legacyVersion(f.raw, version);
    const checkpoint = join(f.root, "checkpoint"),
      before = hash(readFileSync(f.file)),
      rows = inventory(f.raw),
      media = f.raw.prepare("SELECT digest,hex(bytes) AS bytes FROM resources ORDER BY digest").all(),
      catalog = f.raw.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all(),
      entry = new URL("../../dist/index.mjs", import.meta.url).href;
    const script = `import {DatabaseSync} from 'node:sqlite';import{writeFileSync}from'node:fs';
    const prepare=DatabaseSync.prototype.prepare;let armed=true;
    DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);if(armed&&sql.startsWith('INSERT INTO resource_chunks')){this.exec('PRAGMA cache_size=8');
      const run=statement.run;statement.run=function(...args){const result=run.apply(this,args);armed=false;writeFileSync(${JSON.stringify(checkpoint)},'chunk');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);return result;};}return statement;};
    const {Workspace}=await import(${JSON.stringify(entry)});new Workspace(${JSON.stringify(f.root)});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "ignore", "pipe"],
      }),
      exited = once(child, "exit");
    let errors = "";
    child.stderr.on("data", (data) => {
      errors = (errors + data).slice(-2000);
    });
    try {
      await expect
        .poll(
          () => {
            if (child.exitCode !== null) throw Error(errors);
            return existsSync(checkpoint);
          },
          { timeout: 10000 },
        )
        .toBe(true);
      expect(existsSync(`${f.file}-journal`)).toBe(true);
      expect(hash(readFileSync(f.file))).not.toBe(before);
      expect(child.kill("SIGKILL")).toBe(true);
      await exited;
      expect(child.signalCode).toBe("SIGKILL");
      // SQLite does not journal free-list leaf contents: compare all domain rows/bytes, not unused pages.
      // https://www.sqlite.org/atomiccommit.html#_do_not_journal_freelist_pages
      const recovered = new DatabaseSync(f.file);
      try {
        expect(recovered.prepare("PRAGMA user_version").get()?.user_version).toBe(version);
        expect(recovered.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
        expect(recovered.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all()).toEqual(catalog);
        for (const row of rows)
          expect(recovered.prepare(`SELECT ${row.columns.join(",")} FROM ${row.table} ORDER BY rowid`).all()).toEqual(
            row.rows,
          );
        expect(recovered.prepare("SELECT digest,hex(bytes) AS bytes FROM resources ORDER BY digest").all()).toEqual(
          media,
        );
      } finally {
        recovered.close();
      }
      const reopened = new Workspace(f.root);
      try {
        expect(Buffer.concat([...reopened.readResource(f.read).chunks()]).equals(f.bytes)).toBe(true);
        expect(reopened.execute("resource_import", f.input)).toEqual({ project: f.imported });
      } finally {
        reopened.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      f.finish();
    }
  },
  15000,
);
