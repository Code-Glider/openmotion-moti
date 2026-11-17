import { type TemplateInput, templateSchemas } from "@open-motion/templates/contract";
import { attr, button, text as copyText, m, note, setButtonSelected, slot } from "../../locale/index.js";

export type Page = "editor" | "templates";
type Position = { visit: string; index: number };
const key = "open-motion-navigation";
function position(value: unknown): Position | undefined {
  if (!value || typeof value !== "object") return;
  const p = Reflect.get(value, key);
  if (
    p &&
    typeof p === "object" &&
    typeof p.visit === "string" &&
    /^[a-f0-9-]{36}$/.test(p.visit) &&
    Number.isSafeInteger(p.index) &&
    p.index >= 0
  )
    return { visit: p.visit, index: p.index };
}
/** Presentation history only: never stores project data or admits a project. */
export class Pages {
  readonly element: HTMLElement;
  page: Page = "editor";
  template: TemplateInput<"template_read"> | null | undefined;
  private window: Window | null;
  private address?: URL;
  private current: Position = { visit: crypto.randomUUID(), index: 0 };
  private maximum = 0;
  private traversing = false;
  private editor: HTMLButtonElement;
  private templates: HTMLButtonElement;
  private back: HTMLButtonElement;
  private forward: HTMLButtonElement;
  private status: HTMLElement;
  constructor(
    document: Document,
    private changed: (page: Page) => void,
  ) {
    this.window = document.defaultView;
    this.element = slot(document, "navigation");
    this.element.setAttribute("role", "navigation");
    attr(this.element, "aria-label", m("工作区导航"));
    this.editor = button(document, {
      label: m("编辑工作区"),
      icon: "film",
      iconOnly: true,
      variant: "item",
      onClick: () => this.go("editor"),
    });
    this.templates = button(document, {
      label: m("模板库"),
      icon: "layers",
      iconOnly: true,
      variant: "item",
      onClick: () => this.go("templates"),
    });
    this.back = button(document, {
      label: m("后退"),
      icon: "undo",
      iconOnly: true,
      variant: "ghost",
      onClick: () => this.move(-1),
    });
    this.forward = button(document, {
      label: m("前进"),
      icon: "redo",
      iconOnly: true,
      variant: "ghost",
      onClick: () => this.move(1),
    });
    this.status = note(document, "");
    this.status.setAttribute("role", "status");
    this.element.append(this.editor, this.templates, this.back, this.forward, this.status);
    if (this.window) {
      this.address = new URL(this.window.location.href);
      this.current = position(this.window.history.state) ?? this.current;
      this.maximum = this.current.index;
      try {
        const stored = JSON.parse(this.window.sessionStorage.getItem(key) ?? "null");
        if (
          stored?.visit === this.current.visit &&
          Number.isSafeInteger(stored.maximum) &&
          stored.maximum >= this.current.index
        )
          this.maximum = stored.maximum;
      } catch {
        /* Storage failure retains this view's in-memory bounds. */
      }
      this.replace(this.address);
      this.remember();
      this.page = this.read();
      this.readTemplate();
      this.window.addEventListener("popstate", this.pop);
      this.window.addEventListener("hashchange", this.hash);
    }
    this.render();
  }
  private read(): Page {
    return this.address?.searchParams.getAll("page").length === 1 &&
      this.address.searchParams.get("page") === "templates"
      ? "templates"
      : "editor";
  }
  private readTemplate() {
    const params = this.address?.searchParams;
    this.template = undefined;
    if (this.page !== "templates" || !params || (!params.has("template") && !params.has("templateHash"))) return;
    const result = templateSchemas.template_read.safeParse({
      id: params.get("template"),
      contentHash: params.get("templateHash"),
    });
    this.template =
      params.getAll("template").length === 1 && params.getAll("templateHash").length === 1 && result.success
        ? result.data
        : null;
  }
  private state() {
    const state = this.window?.history.state;
    return { ...(state && typeof state === "object" && !Array.isArray(state) ? state : {}), [key]: this.current };
  }
  private replace(address: URL) {
    this.window?.history.replaceState(this.state(), "", address);
  }
  private remember() {
    try {
      this.window?.sessionStorage.setItem(key, JSON.stringify({ visit: this.current.visit, maximum: this.maximum }));
    } catch {
      /* No URL, project content or credential is stored here. */
    }
  }
  private pop = () => {
    if (!this.window) return;
    const next = new URL(this.window.location.href),
      state = position(this.window.history.state);
    this.traversing = false;
    if (state?.visit === this.current.visit && state.index <= this.maximum) {
      this.current = state;
      // These entries navigate pages, not old project revisions or selections.
      next.hash = this.address?.hash ?? next.hash;
      this.replace(next);
    } else {
      this.current = { visit: crypto.randomUUID(), index: 0 };
      this.maximum = 0;
      this.replace(next);
      this.remember();
    }
    this.address = next;
    this.publish();
  };
  private hash = () => {
    if (!this.window || this.address?.href === this.window.location.href) return;
    this.address = new URL(this.window.location.href);
    if (position(this.window.history.state)?.visit !== this.current.visit) {
      this.current = { visit: crypto.randomUUID(), index: 0 };
      this.maximum = 0;
      this.replace(this.address);
      this.remember();
    }
    this.publish();
  };
  private publish() {
    this.page = this.read();
    this.readTemplate();
    this.render();
    this.changed(this.page);
  }
  go(page: Page, template?: TemplateInput<"template_read">) {
    if (this.traversing) return;
    if (!this.window || !this.address) {
      this.page = page;
      this.template = template;
      this.render();
      this.changed(page);
      return;
    }
    const address = new URL(this.window.location.href);
    if (page === "templates") address.searchParams.set("page", "templates");
    else address.searchParams.delete("page");
    address.searchParams.delete("template");
    address.searchParams.delete("templateHash");
    if (page === "templates" && template) {
      address.searchParams.set("template", template.id);
      address.searchParams.set("templateHash", template.contentHash);
    }
    if (address.href === this.address.href) return;
    const current = this.current;
    this.current = { ...current, index: current.index + 1 };
    try {
      this.window.history.pushState(this.state(), "", address);
    } catch {
      this.current = current;
      copyText(this.status, m("页面切换失败，请重试"));
      return;
    }
    this.maximum = this.current.index;
    this.address = address;
    this.remember();
    this.publish();
  }
  acknowledge(fragment: string) {
    if (!this.window) return;
    this.address = new URL(this.window.location.href);
    this.address.hash = fragment;
    this.replace(this.address);
  }
  focus() {
    (this.page === "editor" ? this.editor : this.templates).focus();
  }
  private move(delta: number) {
    if (!this.window || this.traversing || this.current.index + delta < 0 || this.current.index + delta > this.maximum)
      return;
    this.traversing = true;
    this.render();
    try {
      this.window.history.go(delta);
    } catch {
      this.traversing = false;
      copyText(this.status, m("页面切换失败，请重试"));
      this.render();
    }
  }
  private render() {
    for (const [control, page] of [
      [this.editor, "editor"],
      [this.templates, "templates"],
    ] as const) {
      setButtonSelected(control, page === this.page);
      control.removeAttribute("aria-pressed");
      if (page === this.page) control.setAttribute("aria-current", "page");
      else control.removeAttribute("aria-current");
      control.disabled = this.traversing;
    }
    this.back.disabled = !this.window || this.traversing || this.current.index === 0;
    this.forward.disabled = !this.window || this.traversing || this.current.index >= this.maximum;
  }
  dispose() {
    this.window?.removeEventListener("popstate", this.pop);
    this.window?.removeEventListener("hashchange", this.hash);
    this.element.remove();
  }
}
