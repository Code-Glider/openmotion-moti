import { button, dialog, field, note, setButton, slot } from "@open-motion/components";
import { setTheme } from "@open-motion/theme";
import type { Input, Preferences as State, ViewPreferences } from "@open-motion/workspace/contract";
import type { Client } from "../../../../api.js";

/** Presentation writes never enter the editor save/history chain. */
export class Preferences {
  readonly view;
  private state?: State;
  private pending?: Input<"workspace_configure">;
  private flight?: Promise<void>;
  private controller?: AbortController;
  private disposed = false;
  private theme: HTMLSelectElement;
  private layout: HTMLSelectElement;
  private status: HTMLElement;
  private save: HTMLButtonElement;
  private refresh: HTMLButtonElement;
  private media?: MediaQueryList;
  private embedded: boolean;
  private value: ViewPreferences = { theme: "light", layout: "edit" };
  private changed = () => this.apply();
  constructor(
    private root: HTMLElement,
    private client: Client,
    private actions: {
      layout(value: ViewPreferences["layout"]): void;
    },
  ) {
    const document = root.ownerDocument;
    this.view = dialog(document, "界面设置");
    this.embedded = new URLSearchParams(document.defaultView?.location.search).get("embed") === "1";
    this.media = document.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
    this.media?.addEventListener("change", this.changed);
    const select = (name: string, choices: [string, string][]) => {
      const control = document.createElement("select");
      control.setAttribute("aria-label", name);
      for (const [value, label] of choices) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        control.append(option);
      }
      return control;
    };
    this.theme = select("主题", [
      ["light", "浅色"],
      ["dark", "深色"],
      ["system", "跟随系统"],
    ]);
    this.layout = select("布局", [
      ["edit", "默认编辑布局"],
      ["preview", "聚焦预览"],
    ]);
    this.status = note(document, "读取界面偏好中");
    this.status.setAttribute("role", "status");
    this.save = button(document, { label: "应用并保存界面", primary: true, onClick: () => this.commit() });
    this.refresh = button(document, { label: "重新读取界面设置", onClick: () => this.load() });
    const actionsRow = slot(document, "toolbar");
    actionsRow.append(this.save, this.refresh);
    this.view.body.append(
      field(document, "主题", this.theme),
      note(
        document,
        this.embedded ? "嵌入视图跟随浏览器的系统外观；独立视图的主题偏好保持不变。" : "跟随系统会响应设备外观变化。",
      ),
      field(document, "布局", this.layout),
      note(document, "仅改变界面；保留预览、源码与属性草稿。"),
      this.status,
      actionsRow,
    );
    this.apply();
    this.controls();
    this.load();
  }
  open(trigger: HTMLElement) {
    this.view.open(trigger);
  }
  private apply() {
    const dark = this.embedded || this.value.theme === "system" ? !!this.media?.matches : this.value.theme === "dark";
    setTheme(this.root, dark ? "dark" : "light");
    this.actions.layout(this.value.layout);
  }
  private controls() {
    this.theme.disabled = this.embedded || !!this.flight || !!this.pending || !this.state;
    this.layout.disabled = !!this.flight || !!this.pending || !this.state;
    setButton(this.save, {
      label: this.pending ? "确认原界面保存" : "应用并保存界面",
      primary: true,
      disabled: !!this.flight || !this.state,
      onClick: () => this.commit(),
    });
    this.refresh.disabled = !!this.flight || !!this.pending;
  }
  private accept(state: State) {
    this.state = state;
    this.value = state.value;
    this.theme.value = state.value.theme;
    this.layout.value = state.value.layout;
    this.apply();
  }
  private load() {
    if (this.disposed || this.flight || this.pending) return;
    this.controller = new AbortController();
    this.status.textContent = "读取界面偏好中";
    this.flight = this.client
      .execute("workspace_preferences", {}, this.controller.signal)
      .then(
        (state) => {
          if (!this.disposed) {
            this.accept(state);
            this.status.textContent = "界面设置已同步";
          }
        },
        (error) => {
          if (!this.disposed) this.status.textContent = `读取失败：${(error as Error).message}`;
        },
      )
      .finally(() => {
        this.flight = undefined;
        if (!this.disposed) this.controls();
      });
    this.controls();
  }
  private commit() {
    if (this.disposed || this.flight || !this.state) return;
    this.pending ??= {
      requestId: crypto.randomUUID(),
      expectedVersion: this.state.version,
      value: {
        theme: this.embedded ? this.state.value.theme : (this.theme.value as ViewPreferences["theme"]),
        layout: this.layout.value as ViewPreferences["layout"],
      },
    };
    this.status.textContent = "保存界面设置中";
    this.flight = this.client
      .execute("workspace_configure", this.pending)
      .then(
        async () => {
          this.pending = undefined;
          // A replay is an original receipt; a later writer may already have advanced preferences.
          try {
            const current = await this.client.execute("workspace_preferences", {});
            if (!this.disposed) {
              this.accept(current);
              this.status.textContent = "界面设置已保存并同步";
            }
          } catch (error) {
            if (!this.disposed) this.status.textContent = `已保存，重新读取失败：${(error as Error).message}`;
          }
        },
        (error) => {
          if (["conflict", "invalid", "idempotency"].includes((error as { code?: string }).code ?? ""))
            this.pending = undefined;
          if (!this.disposed)
            this.status.textContent = this.pending
              ? "保存结果未确认，请确认原界面保存；可关闭后继续确认。"
              : `保存未完成：${(error as Error).message}`;
        },
      )
      .finally(() => {
        this.flight = undefined;
        if (!this.disposed) this.controls();
      });
    this.controls();
  }
  async dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.media?.removeEventListener("change", this.changed);
    await this.flight;
    this.view.dispose();
  }
}
