import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Fault, type Input, initialFiles, type Operation, Workspace } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { Client, Editor, type Transport } from "@";
import { Versions } from "@/lib/components/workspace/versions.js";

it("saves drafts before restoring, retains the exact unknown intent and rejects substituted targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "web-versions-")),
    db = new Workspace(root),
    session = db.execute("session_create", { requestId: randomUUID(), title: "History", mode: "motion" }),
    artifact = db.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Film",
      files: initialFiles(),
    }),
    owner = { sessionId: session.id, artifactId: artifact.id },
    original = db.execute("project_read", owner),
    target = db.execute("project_versions", owner).current;
  db.execute("artifact_open", { ...owner, requestId: randomUUID(), expectedSelection: 0, expectedCurrent: null });
  const writes: Input<"project_restore">[] = [];
  let lost = true;
  const transport: Transport = async (url, init) => {
    const operation = String(url).split("/api/")[1] as Operation,
      input = JSON.parse(String(init?.body));
    let result: unknown;
    try {
      result = db.execute(operation, input);
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: { code: (error as Fault).code, message: (error as Error).message, current: (error as Fault).current },
        }),
        { status: 409 },
      );
    }
    if (operation === "project_restore") {
      writes.push(input);
      if (lost) {
        lost = false;
        throw Error("lost restore response");
      }
    }
    return new Response(JSON.stringify(result));
  };
  const client = new Client("http://127.0.0.1:4200", "fixture", transport),
    editor = new Editor(client);
  try {
    await editor.load();
    editor.edit(editor.draft + "<!-- saved draft -->");
    await expect(editor.versions.restore(target.id)).rejects.toThrow("lost restore");
    expect(editor.unconfirmed).toBe(true);
    expect(editor.versions.pending).toBe(target.id);
    expect(db.execute("project_read", owner).revision).toBe(original.revision);
    const saved = db.execute("project_versions", owner).versions.find((v) => v.kind === "edit")!;
    expect(
      db.execute("project_snapshot", { ...owner, revision: saved.revision }).files.find((f) => f.path === "index.html")
        ?.content,
    ).toContain("saved draft");
    await expect(editor.versions.restore(randomUUID())).rejects.toThrow("先重试");
    await editor.versions.restore(target.id);
    expect(writes[0]).toEqual(writes[1]);
    expect(editor.unconfirmed).toBe(false);
    expect(editor.versions.pending).toBeUndefined();
    expect(editor.project?.files).toEqual(original.files);
    expect(db.execute("project_versions", owner).versions).toHaveLength(3);
    editor.edit(editor.draft + "<!-- conflict draft -->");
    await editor.save();
    const current = db.execute("project_read", owner);
    db.execute("project_save", {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: current.revision,
      files: [{ path: "index.html", content: "outside" }],
    });
    await expect(editor.versions.restore(target.id)).rejects.toThrow("外部修改");
    expect(editor.project?.files.find((f) => f.path === "index.html")?.content).toContain("conflict draft");
    expect(db.execute("project_read", owner).files.find((f) => f.path === "index.html")?.content).toBe("outside");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("fences abort-ignoring version reads across closing and drains outstanding readers on disposal", async () => {
  const pending: { resolve(value: unknown): void }[] = [],
    client = { execute: vi.fn(() => new Promise((resolve) => pending.push({ resolve }))) } as unknown as Client,
    editor = {
      project: {
        sessionId: randomUUID(),
        artifactId: randomUUID(),
        revision: "sha256:" + "a".repeat(64),
        history: { version: 0 },
      },
      versions: {},
    } as unknown as Editor,
    modal = new Versions(document, editor, client, vi.fn()),
    trigger = document.createElement("button");
  Object.defineProperty(modal.view.element, "showModal", { value: () => modal.view.element.setAttribute("open", "") });
  Object.defineProperty(modal.view.element, "close", {
    value: () => {
      modal.view.element.removeAttribute("open");
      modal.view.element.dispatchEvent(new Event("close"));
    },
  });
  document.body.append(trigger, modal.view.element);
  const version = {
      id: randomUUID(),
      number: 1,
      revision: editor.project!.revision,
      kind: "create",
      createdAt: 1,
      restoredFromVersionId: null,
      restorable: true,
      unavailableFiles: [],
    },
    page = { current: version, historyVersion: 0, versions: [version], nextCursor: null, newerAvailable: false };
  modal.update(false);
  modal.open(trigger);
  modal.view.close();
  modal.open(trigger);
  pending[1]!.resolve(page);
  await vi.waitFor(() => expect(modal.view.body.textContent).toContain("版本已就绪"));
  pending[0]!.resolve({ ...page, versions: [{ ...version, number: 999 }] });
  await Promise.resolve();
  expect(modal.view.body.textContent).not.toContain("v999");
  modal.view.close();
  modal.open(trigger);
  let closed = false;
  const disposing = modal.dispose().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  pending[2]!.resolve(page);
  await disposing;
  expect(closed).toBe(true);
  trigger.remove();
});
