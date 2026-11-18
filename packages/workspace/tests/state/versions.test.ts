import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { Fault, type Input, initialFiles, Workspace } from "@";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "motion-versions-"));
  let db = new Workspace(root);
  const session = db.execute("session_create", { requestId: randomUUID(), title: "Versions", mode: "motion" }),
    artifact = db.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Film",
      files: initialFiles(),
    }),
    owner = { sessionId: session.id, artifactId: artifact.id };
  return {
    root,
    owner,
    get db() {
      return db;
    },
    cold() {
      db.close();
      db = new Workspace(root);
    },
    read: () => db.execute("project_read", owner),
    versions: (cursor?: Input<"project_versions">["cursor"]) => db.execute("project_versions", { ...owner, cursor }),
    save: (content: string) =>
      db.execute("project_save", {
        ...owner,
        requestId: randomUUID(),
        expectedRevision: db.execute("project_read", owner).revision,
        files: [{ path: "index.html", content }],
      }),
    restore(versionId: string): Input<"project_restore"> {
      const current = db.execute("project_read", owner),
        page = db.execute("project_versions", owner);
      return {
        ...owner,
        requestId: randomUUID(),
        versionId,
        expectedRevision: current.revision,
        expectedHistory: current.history.version,
        expectedVersionId: page.current.id,
      };
    },
    finish() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function inventory(f: ReturnType<typeof fixture>) {
  let page = f.versions();
  const versions = [...page.versions];
  while (page.nextCursor) {
    page = f.versions(page.nextCursor);
    versions.push(...page.versions);
  }
  return versions;
}

it("keeps stable five-entry pages, records undo/redo and preserves pruned later versions through restore and cold reopen", () => {
  const f = fixture();
  try {
    for (let i = 1; i < 12; i++) f.save(`source ${i}`);
    const first = f.versions(),
      before = inventory(f),
      head = f.read();
    expect(first.versions).toHaveLength(5);
    expect(before).toHaveLength(12);
    expect(f.save("source 11").history).toEqual(head.history);
    expect(inventory(f)).toEqual(before);
    f.save("new during paging");
    let page = f.versions(first.nextCursor!);
    const older = [...page.versions];
    expect(page.newerAvailable).toBe(true);
    while (page.nextCursor) {
      page = f.versions(page.nextCursor);
      older.push(...page.versions);
    }
    expect([...first.versions, ...older]).toEqual(before);
    const latest = f.read(),
      undo = f.db.execute("project_undo", {
        ...f.owner,
        requestId: randomUUID(),
        expectedRevision: latest.revision,
        expectedHistory: latest.history.version,
      });
    const branchedAway = f.versions().versions.find((v) => v.revision === latest.revision)!;
    f.save("branch after undo");
    expect(f.read().history.canRedo).toBe(false);
    expect(inventory(f).some((v) => v.id === branchedAway.id)).toBe(true);
    const request = f.restore(branchedAway.id),
      restored = f.db.execute("project_restore", request);
    expect(restored.revision).toBe(latest.revision);
    expect(restored.revision).not.toBe(undo.revision);
    const restoredHead = f.versions().current;
    expect(restoredHead.kind).toBe("restore");
    expect(restoredHead.restoredFromVersionId).toBe(branchedAway.id);
    expect(before.every((v) => inventory(f).some((saved) => saved.id === v.id))).toBe(true);
    expect(f.db.execute("project_restore", request)).toEqual(restored);
    f.cold();
    expect(f.read()).toEqual(restored);
    expect(f.versions().current).toEqual(restoredHead);
    const foreign = f.db.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: f.owner.sessionId,
      title: "Other",
      files: initialFiles(),
    });
    expect(() =>
      f.db.execute("project_versions", {
        sessionId: f.owner.sessionId,
        artifactId: foreign.id,
        cursor: first.nextCursor!,
      }),
    ).toThrow("cursor");
    const foreignVersion = f.db.execute("project_versions", {
      sessionId: f.owner.sessionId,
      artifactId: foreign.id,
    }).current;
    expect(() => f.db.execute("project_restore", f.restore(foreignVersion.id))).toThrow("belong");
  } finally {
    f.finish();
  }
});

it("fences repeated-content ABA and creates a distinct restore occurrence without confusing hashes with version IDs", () => {
  const f = fixture();
  try {
    f.save("A");
    const a = f.versions().current;
    f.save("B");
    const b = f.read(),
      stale = f.restore(a.id);
    const undo = f.db.execute("project_undo", {
      ...f.owner,
      requestId: randomUUID(),
      expectedRevision: b.revision,
      expectedHistory: b.history.version,
    });
    f.db.execute("project_redo", {
      ...f.owner,
      requestId: randomUUID(),
      expectedRevision: undo.revision,
      expectedHistory: undo.history.version,
    });
    try {
      f.db.execute("project_restore", stale);
      throw Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(Fault);
      expect((error as Fault).current).toEqual({
        revision: b.revision,
        historyVersion: f.read().history.version,
        versionId: f.versions().current.id,
      });
    }
    const oldB = inventory(f).find((v) => v.kind === "edit" && v.revision === b.revision)!;
    const previous = f.versions().current,
      restored = f.db.execute("project_restore", f.restore(oldB.id));
    expect(restored.revision).toBe(b.revision);
    expect(f.versions().current.id).not.toBe(previous.id);
    expect(f.versions().current.number).toBe(previous.number + 1);
    expect(() => f.db.execute("project_restore", f.restore(f.versions().current.id))).toThrow("already current");
  } finally {
    f.finish();
  }
});

it("verifies historical media atomically, rolls back failed version writes and replays the original receipt after later edits", () => {
  const f = fixture(),
    raw = new DatabaseSync(join(f.root, "workspace.sqlite")),
    bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAAPklEQVR4AcXBMQEAIAzAsK5CuPEvChtMRpN5535CEpOYxCQmMYlJTGISk5jEJCYxiUlMYhKTmMQkJjGJSWwBYl8CWwMRvGQAAAAASUVORK5CYII=",
      "base64",
    ),
    digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  try {
    const media = f.db.importResource(
        {
          ...f.owner,
          requestId: randomUUID(),
          expectedRevision: f.read().revision,
          path: "assets/picture.png",
          name: "Picture",
          digest,
          bytes: bytes.length,
        },
        bytes,
      ),
      version = f.versions().current;
    f.db.execute("resource_remove", {
      ...f.owner,
      requestId: randomUUID(),
      expectedRevision: media.revision,
      path: "assets/picture.png",
    });
    const request = f.restore(version.id),
      before = f.read(),
      selection = f.db.execute("workspace_state", {}).selection,
      count = () => raw.prepare("SELECT COUNT(*) AS n FROM requests").get()?.n;
    const receipts = count();
    raw.prepare("UPDATE resources SET bytes=? WHERE digest=?").run(Buffer.from("corrupt"), digest);
    expect(f.versions().versions.find((v) => v.id === version.id)?.unavailableFiles).toEqual(["assets/picture.png"]);
    expect(() => f.db.execute("project_restore", request)).toThrow("missing or corrupt");
    expect(f.read()).toEqual(before);
    expect(count()).toBe(receipts);
    expect(f.db.execute("workspace_state", {}).selection).toEqual(selection);
    raw.prepare("UPDATE resources SET bytes=? WHERE digest=?").run(bytes, digest);
    raw.exec(
      "CREATE TRIGGER reject_version BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT,'version failure'); END",
    );
    expect(() => f.db.execute("project_restore", request)).toThrow("version failure");
    expect(f.read()).toEqual(before);
    expect(count()).toBe(receipts);
    raw.exec("DROP TRIGGER reject_version");
    const restored = f.db.execute("project_restore", request);
    expect(restored.resources).toEqual(media.resources);
    expect(
      f.db.execute("resource_read", { ...f.owner, revision: restored.revision, path: "assets/picture.png" }).data,
    ).toBe(bytes.toString("base64"));
    const later = f.save("later source");
    f.cold();
    expect(f.db.execute("project_restore", request)).toEqual(restored);
    expect(f.read()).toEqual(later);
    raw.prepare("DELETE FROM resources WHERE digest=?").run(digest);
    const afterDelete = f.read(),
      second = f.restore(version.id);
    expect(() => f.db.execute("project_restore", second)).toThrow("missing or corrupt");
    expect(f.read()).toEqual(afterDelete);
  } finally {
    raw.close();
    f.finish();
  }
});

it("upgrades accepted format3 in place, preserves all rows and receipts, and labels pruned legacy snapshots without invented chronology", () => {
  const f = fixture();
  try {
    f.save("legacy one");
    const two = f.save("legacy two");
    f.db.execute("project_undo", {
      ...f.owner,
      requestId: randomUUID(),
      expectedRevision: two.revision,
      expectedHistory: two.history.version,
    });
    f.save("legacy branch");
    f.db.close();
    const raw = new DatabaseSync(join(f.root, "workspace.sqlite")),
      tables = [
        "sessions",
        "messages",
        "artifacts",
        "projects",
        "revisions",
        "resources",
        "history",
        "selection",
        "requests",
      ],
      rows = () => Object.fromEntries(tables.map((table) => [table, raw.prepare(`SELECT * FROM ${table}`).all()])),
      before = rows();
    raw.exec("DROP TABLE preferences; DROP TABLE versions; PRAGMA user_version=3");
    try {
      f.cold();
      expect(rows()).toEqual(before);
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(7);
      const legacy = inventory(f);
      expect(legacy).toHaveLength(4);
      expect(legacy.every((v) => v.kind === "legacy" && v.createdAt === null)).toBe(true);
      expect(legacy.some((v) => v.revision === two.revision)).toBe(true);
      expect(f.versions().current.revision).toBe(f.read().revision);
      const ids = legacy.map((v) => v.id);
      f.cold();
      expect(inventory(f).map((v) => v.id)).toEqual(ids);
      const head = f.versions().current;
      f.save("real new edit");
      expect(f.versions().current.kind).toBe("edit");
      expect(f.versions().current.number).toBe(head.number + 1);
      const target = legacy.find((v) => v.revision === two.revision)!;
      expect(f.db.execute("project_restore", f.restore(target.id)).revision).toBe(two.revision);
    } finally {
      raw.close();
    }
  } finally {
    f.finish();
  }
});

it("refuses an incomplete accepted schema3 head without leaving a partial upgrade or rewriting its source tables", () => {
  const f = fixture(),
    file = join(f.root, "workspace.sqlite");
  try {
    f.db.close();
    const raw = new DatabaseSync(file);
    raw.exec("DROP TABLE preferences; DROP TABLE versions; PRAGMA user_version=3");
    raw.prepare("UPDATE projects SET current_revision=?").run("sha256:" + "0".repeat(64));
    raw.close();
    const before = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(() => new Workspace(f.root)).toThrow("existing project revision is missing");
    expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(before);
    const after = new DatabaseSync(file);
    try {
      expect(after.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
      expect(after.prepare("SELECT name FROM sqlite_master WHERE name='versions'").get()).toBeUndefined();
      expect(after.prepare("SELECT COUNT(*) AS n FROM artifacts").get()?.n).toBe(1);
    } finally {
      after.close();
    }
  } finally {
    f.finish();
  }
});
