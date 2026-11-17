import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { initialFiles, Workspace } from "@";
import { locales } from "@/contract.js";

it("persists independent preferences, fences competing clients and replays original receipts without rewinding later choices", () => {
  const root = mkdtempSync(join(tmpdir(), "view-preferences-"));
  let db = new Workspace(root);
  try {
    const session = db.execute("session_create", { requestId: randomUUID(), title: "Keep", mode: "motion" });
    const artifact = db.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Keep",
      files: initialFiles(),
    });
    const owner = { sessionId: session.id, artifactId: artifact.id };
    const before = {
      observation: db.execute("workspace_observe", {}),
      versions: db.execute("project_versions", owner),
      project: db.execute("project_read", owner),
    };
    expect(db.execute("workspace_preferences", {})).toEqual({
      version: 0,
      value: { theme: "light", layout: "edit", locale: "zh-CN" },
    });
    const intent = {
      requestId: randomUUID(),
      expectedVersion: 0,
      value: { theme: "dark" as const, layout: "preview" as const },
    };
    const first = db.execute("workspace_configure", intent);
    expect(first.version).toBe(1);
    expect(() => db.execute("workspace_configure", { ...intent, requestId: randomUUID() })).toThrow("changed");
    const second = new Workspace(root);
    try {
      expect(second.execute("workspace_preferences", {})).toEqual(first);
      const later = second.execute("workspace_configure", {
        requestId: randomUUID(),
        expectedVersion: 1,
        value: { theme: "system", layout: "edit", locale: "de" },
      });
      expect(db.execute("workspace_configure", intent)).toEqual(first);
      expect(db.execute("workspace_preferences", {})).toEqual(later);
      expect(() => db.execute("workspace_configure", { ...intent, value: { theme: "light", layout: "edit" } })).toThrow(
        "already used",
      );
      expect(
        db.execute("workspace_configure", {
          requestId: randomUUID(),
          expectedVersion: later.version,
          value: later.value,
        }),
      ).toEqual(later);
      expect(db.execute("workspace_observe", {})).toEqual(before.observation);
      expect(db.execute("project_versions", owner)).toEqual(before.versions);
      expect(db.execute("project_read", owner)).toEqual(before.project);
      db.close();
      db = new Workspace(root);
      expect(db.execute("workspace_preferences", {})).toEqual(later);
      expect(db.execute("workspace_configure", intent)).toEqual(first);
      expect(() =>
        db.execute("workspace_configure", {
          ...intent,
          requestId: randomUUID(),
          expectedVersion: later.version,
          value: { theme: "dark", layout: "hidden" } as never,
        }),
      ).toThrow("schema");
    } finally {
      second.close();
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("upgrades schema5 without rewriting old preference JSON or receipt bytes, then preserves locale for requests that omit it", () => {
  const root = mkdtempSync(join(tmpdir(), "locale-upgrade-"));
  let db = new Workspace(root);
  const intent = {
    requestId: randomUUID(),
    expectedVersion: 0,
    value: { theme: "dark" as const, layout: "preview" as const },
  };
  try {
    const receipt = db.execute("workspace_configure", intent);
    db.close();
    const raw = new DatabaseSync(join(root, "workspace.sqlite"));
    try {
      // Reconstruct the accepted schema5 layout and original response, not a new-format replay.
      raw.exec("ALTER TABLE preferences DROP COLUMN locale; PRAGMA user_version=5");
      const original = { version: receipt.version, value: intent.value };
      const originalFingerprint = createHash("sha256")
        .update(JSON.stringify(["workspace_configure", intent]))
        .digest("hex");
      expect(raw.prepare("SELECT fingerprint FROM requests WHERE id=?").get(intent.requestId)?.fingerprint).toBe(
        originalFingerprint,
      );
      raw.prepare("UPDATE requests SET result=? WHERE id=?").run(JSON.stringify(original), intent.requestId);
      const receipts = raw.prepare("SELECT * FROM requests ORDER BY id").all();
      const stored = raw.prepare("SELECT version,value FROM preferences").get();
      db = new Workspace(root);
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(6);
      expect(raw.prepare("SELECT version,value FROM preferences").get()).toEqual(stored);
      expect(raw.prepare("SELECT * FROM requests ORDER BY id").all()).toEqual(receipts);
      expect(db.execute("workspace_configure", intent)).toEqual(original);
      let current = db.execute("workspace_preferences", {});
      expect(current.value.locale).toBe("zh-CN");
      for (const locale of locales) {
        current = db.execute("workspace_configure", {
          requestId: randomUUID(),
          expectedVersion: current.version,
          value: { ...current.value, locale },
        });
        expect(current.value.locale).toBe(locale);
      }
      const retained = db.execute("workspace_configure", {
        requestId: randomUUID(),
        expectedVersion: current.version,
        value: { theme: "system", layout: "edit" },
      });
      expect(retained.value.locale).toBe("tr");
      expect(db.execute("workspace_configure", intent)).toEqual(original);
      expect(db.execute("workspace_preferences", {})).toEqual(retained);
      expect(() =>
        db.execute("workspace_configure", {
          requestId: randomUUID(),
          expectedVersion: retained.version,
          value: { ...retained.value, locale: "invalid" } as never,
        }),
      ).toThrow("schema");
      db.close();
      db = new Workspace(root);
      expect(db.execute("workspace_preferences", {})).toEqual(retained);
    } finally {
      raw.close();
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("upgrades accepted schema4 atomically without changing content, history, selection or receipts", () => {
  const root = mkdtempSync(join(tmpdir(), "view-upgrade-"));
  let db = new Workspace(root);
  try {
    const session = db.execute("session_create", { requestId: randomUUID(), title: "Keep", mode: "motion" });
    const command = { requestId: randomUUID(), sessionId: session.id, title: "Keep", files: initialFiles() };
    const artifact = db.execute("artifact_create", command);
    db.close();
    const raw = new DatabaseSync(join(root, "workspace.sqlite"));
    try {
      raw.exec("DROP TABLE preferences; PRAGMA user_version=4");
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => String(r.name));
      const rows = () => tables.map((name) => raw.prepare(`SELECT * FROM ${name}`).all());
      const before = rows();
      db = new Workspace(root);
      expect(rows()).toEqual(before);
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(6);
      expect(db.execute("workspace_preferences", {}).value).toEqual({
        theme: "light",
        layout: "edit",
        locale: "zh-CN",
      });
      expect(db.execute("artifact_create", command)).toEqual(artifact);
    } finally {
      raw.close();
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
