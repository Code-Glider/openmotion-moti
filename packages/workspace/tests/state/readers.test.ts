import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { initialFiles, resourceLimit, Workspace } from "@";

const hash = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "motion-resource-reader-")),
    workspace = new Workspace(root),
    session = workspace.execute("session_create", { requestId: randomUUID(), title: "Reader", mode: "motion" }),
    artifact = workspace.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Media",
      files: initialFiles(),
    }),
    owner = { sessionId: session.id, artifactId: artifact.id },
    bytes = Buffer.alloc(resourceLimit);
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
  // Distinct chunks exercise ordering as well as the final whole-resource digest.
  for (let at = 44; at < bytes.length; at++) bytes[at] = at % 251;
  const before = workspace.execute("project_read", owner),
    input = {
      requestId: randomUUID(),
      ...owner,
      expectedRevision: before.revision,
      path: "assets/large.wav",
      name: "Large WAV",
      digest: hash(bytes),
      bytes: bytes.length,
    },
    project = workspace.importResource(input, bytes),
    read = { ...owner, revision: project.revision, path: input.path };
  return {
    root,
    workspace,
    owner,
    bytes,
    input,
    project,
    read,
    finish: () => {
      workspace.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
it("reads bounded repeatable historical chunks after removal and cold reopen without changing project receipts", () => {
  const f = fixture();
  let cold: Workspace | undefined;
  try {
    const reader = f.workspace.readResource(f.read),
      removed = f.workspace.execute("resource_remove", {
        ...f.owner,
        requestId: randomUUID(),
        expectedRevision: f.project.revision,
        path: f.read.path,
      });
    let total = 0,
      count = 0;
    const complete = createHash("sha256");
    for (const chunk of reader.chunks()) {
      expect(chunk.byteLength).toBeLessThanOrEqual(65536);
      expect(Buffer.from(chunk).equals(f.bytes.subarray(total, total + chunk.byteLength))).toBe(true);
      complete.update(chunk);
      total += chunk.byteLength;
      count++;
    }
    expect(total).toBe(resourceLimit);
    expect(count).toBe(256);
    expect(`sha256:${complete.digest("hex")}`).toBe(f.input.digest);
    expect(Buffer.concat([...reader.chunks()]).equals(f.bytes)).toBe(true);
    expect(() => f.workspace.readResource({ ...f.read, revision: removed.revision })).toThrow("does not belong");
    expect(() => f.workspace.readResource({ ...f.read, artifactId: randomUUID() })).toThrow();
    expect(() => f.workspace.readResource({ ...f.read, data: "obsolete" } as never)).toThrow("invalid resource");
    expect(f.workspace.execute("project_read", f.owner)).toEqual(removed);
    expect(f.workspace.execute("resource_import", f.input)).toEqual({ project: f.project });
    const unchanged = f.workspace.execute("workspace_observe", {});
    f.workspace.close();
    expect(() => [...reader.chunks()]).toThrow("workspace is closed");
    cold = new Workspace(f.root);
    expect(hash(Buffer.concat([...cold.readResource(f.read).chunks()]))).toBe(f.input.digest);
    expect(cold.execute("workspace_observe", {})).toEqual(unchanged);
    expect(cold.execute("resource_import", f.input)).toEqual({ project: f.project });
  } finally {
    cold?.close();
    f.finish();
  }
});

it("refuses corruption before admission and rechecks every chunk after admission", () => {
  const f = fixture(),
    raw = new DatabaseSync(join(f.root, "workspace.sqlite"));
  try {
    const before = f.workspace.execute("project_read", f.owner),
      reader = f.workspace.readResource(f.read),
      stream = reader.chunks()[Symbol.iterator](),
      changed = Buffer.from(f.bytes);
    const first = stream.next();
    if (first.done) throw Error("missing first chunk");
    expect(Buffer.from(first.value).equals(f.bytes.subarray(0, 65536))).toBe(true);
    changed[65536] = changed[65536]! ^ 1;
    raw.prepare("UPDATE resources SET bytes=? WHERE digest=?").run(changed, f.input.digest);
    expect(() => stream.next()).toThrow("changed after verification");
    expect(() => f.workspace.readResource(f.read)).toThrow("bytes are corrupt");
    raw.prepare("UPDATE resources SET bytes=? WHERE digest=?").run(f.bytes.subarray(0, 65536), f.input.digest);
    expect(() => [...reader.chunks()]).toThrow("missing or truncated");
    raw.prepare("DELETE FROM resources WHERE digest=?").run(f.input.digest);
    expect(() => f.workspace.readResource(f.read)).toThrow("missing or truncated");
    expect(f.workspace.execute("project_read", f.owner)).toEqual(before);
  } finally {
    raw.close();
    f.finish();
  }
});
