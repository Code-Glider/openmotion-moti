import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Motion } from "@open-motion/motion";
import { inspectContext } from "@open-motion/motion/project";
import { Fault, type Input, type Operation, Workspace } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { mount, type Transport } from "@";
import { studioTimeline } from "@/lib/components/studio/timeline.js";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing fixture element");
  return value;
}
async function fixture(fail: boolean, inspect?: () => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "studio-fields-")),
    db = new Workspace(root);
  const session = db.execute("session_create", { requestId: randomUUID(), title: "creative", mode: "motion" });
  const files = [
    {
      path: "index.html",
      content:
        '<main data-composition-id="main" data-duration="5"><p data-hf-id="hf-title" data-start="0" data-duration="5">Original</p></main>',
    },
  ];
  const a = db.execute("artifact_create", { requestId: randomUUID(), sessionId: session.id, title: "A", files }),
    b = db.execute("artifact_create", { requestId: randomUUID(), sessionId: session.id, title: "B", files });
  db.execute("artifact_open", {
    requestId: randomUUID(),
    sessionId: session.id,
    artifactId: a.id,
    expectedSelection: 0,
    expectedCurrent: null,
  });
  const transport: Transport = async (url, init) => {
    const input = JSON.parse(String(init?.body));
    try {
      if (String(url).endsWith("/preview/close")) return new Response("{}");
      if (String(url).endsWith("/motion/context")) return new Response(JSON.stringify(await inspectContext(input)));
      if (String(url).includes("/motion/")) {
        const model = await Motion.open(input.html);
        try {
          return new Response(
            JSON.stringify({
              html: String(url).endsWith("/patch") ? model.patch(input.id, input) : input.html,
              clips: model.clips,
            }),
          );
        } finally {
          model.dispose();
        }
      }
      return new Response(
        JSON.stringify(db.execute(String(url).split("/api/")[1] as Operation, input as Input<Operation>)),
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: { code: error instanceof Fault ? error.code : "integrity", message: (error as Error).message },
        }),
        { status: 409 },
      );
    }
  };
  const view = mount(document.body, { daemon: "http://127.0.0.1:4000", token: "fixture" }, transport);
  const editor = view.editor;
  let injection: DatabaseSync | undefined;
  try {
    await vi.waitFor(() =>
      expect(document.querySelector('select[aria-label="图层选择"] option[value="hf-title"]')).not.toBeNull(),
    );
    const select = required(document.querySelector<HTMLSelectElement>('select[aria-label="图层选择"]'));
    select.value = "hf-title";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(document.querySelector("[aria-live]")?.textContent).toBe("就绪");
      expect(document.querySelector<HTMLTextAreaElement>('[aria-label="文本内容"]')?.readOnly).toBe(false);
    });
    await inspect?.();
    const field = required(document.querySelector<HTMLTextAreaElement>('[aria-label="文本内容"]'));
    field.value = "Pending native field";
    field.dispatchEvent(new Event("input"));
    expect(editor.drafts?.dirty()).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="index.html"]')?.readOnly).toBe(true);
    if (fail) {
      injection = new DatabaseSync(join(root, "workspace.sqlite"));
      injection.exec(
        "CREATE TRIGGER fail_native_save BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT,'storage failure');END",
      );
    }
    document.querySelector<HTMLButtonElement>('[aria-label="打开项目列表"]')?.click();
    await vi.waitFor(() => expect(document.querySelector(`[data-project-id="${b.id}"]`)).not.toBeNull());
    required(document.querySelector<HTMLButtonElement>(`[data-project-id="${b.id}"]`)).click();
    if (fail) {
      await vi.waitFor(() => expect(document.querySelector("[aria-live]")?.textContent).toBe("storage failure"));
      expect(db.execute("workspace_state", {}).selection.artifactId).toBe(a.id);
      expect(editor.draft).toContain("Pending native field");
      expect(editor.dirty).toBe(true);
      expect(db.execute("project_read", { sessionId: session.id, artifactId: a.id }).files[0]?.content).toContain(
        "Original",
      );
    } else {
      await vi.waitFor(() => expect(editor.project?.artifactId).toBe(b.id));
      expect(db.execute("project_read", { sessionId: session.id, artifactId: a.id }).files[0]?.content).toContain(
        "Pending native field",
      );
    }
  } finally {
    await view.dispose();
    injection?.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
it("drains real native SDK fields into the shared save before a project switch", () => fixture(false));
it("keeps transformed native draft and original selection when the actual transaction aborts", () => fixture(true));

it("keeps the same timeline projection and active trim through an unchanged render", async () => {
  const model = await inspectContext({
    instance: null,
    files: [
      {
        path: "index.html",
        content:
          '<main data-composition-id="main" data-duration="5"><p data-hf-id="title" data-start="0" data-duration="5">Title</p></main>',
      },
    ],
  });
  const root = document.createElement("div"),
    actions = document.createElement("div"),
    commit = vi.fn();
  document.body.replaceChildren(root, actions);
  Object.defineProperty(root, "clientWidth", { value: 1000 });
  const options = {
    identity: "revision-one",
    clips: model.clips,
    selected: "title",
    blocked: false,
    time: 0,
    duration: 5,
    root,
    actions,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    choose: vi.fn(),
    seek: vi.fn(),
    retime: vi.fn(),
    commit,
  };
  const first = studioTimeline(document, options),
    svg = required(root.querySelector("svg")),
    track = required(root.querySelector<SVGElement>("[data-clip-id]")),
    handle = required(track.querySelector(".om-time__handle"));
  Object.defineProperty(track, "setPointerCapture", { value: vi.fn() });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 100));
  const pointer = (type: string, clientX: number) =>
    handle.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX }));
  try {
    pointer("pointerdown", 500);
    pointer("pointermove", 418);
    const next = studioTimeline(document, { ...options, clips: structuredClone(model.clips), time: 1.5 });
    expect(next.element).toBe(first.element);
    pointer("pointermove", 172);
    pointer("pointerup", 172);
    expect(commit).toHaveBeenCalledExactlyOnceWith("title", 0, 3);
    first.disable(true);
    const invalidated = studioTimeline(document, options);
    expect(invalidated.element).not.toBe(first.element);
    expect(invalidated.disabled).toBe(false);
    const changed = studioTimeline(document, { ...options, identity: "revision-two" });
    expect(changed.element).not.toBe(first.element);
    expect(root.contains(first.element)).toBe(false);
    const blocked = studioTimeline(document, { ...options, identity: "revision-two", blocked: true });
    expect(blocked.element).not.toBe(changed.element);
    expect(root.querySelector("[data-clip-id]")?.getAttribute("tabindex")).toBe("-1");
  } finally {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  }
});

it("retains a timeline trim through fractional observer delivery for the same client width", async () => {
  let notify: (() => void) | undefined;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        notify = () =>
          this.callback(
            [{ target, contentRect: new DOMRect(0, 0, 1000.25, 100) } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      disconnect() {
        notify = undefined;
      }
    },
  );
  try {
    await fixture(false, async () => {
      const svg = required(document.querySelector<SVGSVGElement>(".om-time__surface")),
        track = required(svg.querySelector<SVGElement>("[data-clip-id]")),
        handle = required(track.querySelector(".om-time__handle"));
      Object.defineProperty(track, "setPointerCapture", { value: vi.fn() });
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 100));
      const pointer = (type: string, clientX: number) =>
        handle.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX }));
      pointer("pointerdown", 500);
      required(notify)();
      pointer("pointermove", 172);
      pointer("pointerup", 172);
      await vi.waitFor(() =>
        expect(document.querySelector('[data-clip-id="hf-title"]')?.getAttribute("aria-label")).toContain("3.00秒"),
      );
    });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

// JSDOM covers modal state only; native focus, Escape and inertness are verified in Chromium.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  },
  close: {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  },
});
