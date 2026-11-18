import { setTheme } from "@open-motion/theme";
import type { Input, Locale, Preferences as State, ViewPreferences } from "@open-motion/workspace/contract";
import type { Client } from "../../../../api.js";
import {
  attr,
  button,
  type Copy,
  text as copyText,
  dialog,
  field,
  m,
  note,
  setButton,
  slot,
} from "../../../locale/index.js";

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
  private language: HTMLSelectElement;
  private status: HTMLElement;
  private save: HTMLButtonElement;
  private refresh: HTMLButtonElement;
  private media?: MediaQueryList;
  private embedded: boolean;
  private value: ViewPreferences = { theme: "light", layout: "edit", locale: "zh-CN", embeddedTheme: "system" };
  private changed = () => this.apply();
  constructor(
    private root: HTMLElement,
    private client: Client,
    private actions: {
      layout(value: ViewPreferences["layout"]): void;
      language(value: Locale): void;
    },
  ) {
    const document = root.ownerDocument;
    this.view = dialog(document, m("界面设置"));
    this.embedded = new URLSearchParams(document.defaultView?.location.search).get("embed") === "1";
    this.media = document.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
    this.media?.addEventListener("change", this.changed);
    const select = (name: Copy, choices: [string, Copy][]) => {
      const control = document.createElement("select");
      attr(control, "aria-label", name);
      for (const [value, label] of choices) {
        const option = document.createElement("option");
        option.value = value;
        copyText(option, label);
        control.append(option);
      }
      return control;
    };
    this.theme = select(m("主题"), [
      ["light", m("浅色")],
      ["dark", m("深色")],
      ["system", m("跟随系统")],
    ]);
    this.layout = select(m("布局"), [
      ["edit", m("默认编辑布局")],
      ["preview", m("聚焦预览")],
    ]);
    this.language = select(m("语言"), [
      ["en", "English"],
      ["zh-CN", "简体中文"],
      ["ja", "日本語"],
      ["ko", "한국어"],
      ["de", "Deutsch"],
      ["fr", "Français"],
      ["ru", "Русский"],
      ["es", "Español"],
      ["pt-BR", "Português (BR)"],
      ["it", "Italiano"],
      ["tr", "Türkçe"],
    ]);
    this.language.name = "locale";
    for (const option of this.language.options) option.lang = option.value;
    this.status = note(document, m("读取界面偏好中"));
    this.status.setAttribute("role", "status");
    this.save = button(document, { label: m("应用并保存界面"), primary: true, onClick: () => this.commit() });
    this.refresh = button(document, { label: m("重新读取界面设置"), onClick: () => this.load() });
    const actionsRow = slot(document, "toolbar");
    actionsRow.append(this.save, this.refresh);
    this.view.body.append(
      field(document, m("主题"), this.theme),
      note(
        document,
        this.embedded
          ? m("嵌入视图的主题单独保存；跟随系统会响应浏览器的外观变化。")
          : m("跟随系统会响应设备外观变化。"),
      ),
      field(document, m("布局"), this.layout),
      field(document, m("语言"), this.language),
      note(document, m("仅改变界面；保留预览、源码与属性草稿。")),
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
    const theme = this.embedded ? this.value.embeddedTheme : this.value.theme;
    const dark = theme === "system" ? !!this.media?.matches : theme === "dark";
    setTheme(this.root, dark ? "dark" : "light");
    this.actions.layout(this.value.layout);
    this.actions.language(this.value.locale);
  }
  private controls() {
    this.theme.disabled = !!this.flight || !!this.pending || !this.state;
    this.language.disabled = !!this.flight || !!this.pending || !this.state;
    this.layout.disabled = !!this.flight || !!this.pending || !this.state;
    setButton(this.save, {
      label: this.pending ? m("确认原界面保存") : m("应用并保存界面"),
      primary: true,
      disabled: !!this.flight || !this.state,
      onClick: () => this.commit(),
    });
    this.refresh.disabled = !!this.flight || !!this.pending;
  }
  private accept(state: State) {
    this.state = state;
    this.value = state.value;
    this.theme.value = this.embedded ? state.value.embeddedTheme : state.value.theme;
    this.layout.value = state.value.layout;
    this.language.value = state.value.locale;
    this.apply();
  }
  private load() {
    if (this.disposed || this.flight || this.pending) return;
    this.controller = new AbortController();
    copyText(this.status, m("读取界面偏好中"));
    this.flight = this.client
      .execute("workspace_preferences", {}, this.controller.signal)
      .then(
        (state) => {
          if (!this.disposed) {
            this.accept(state);
            copyText(this.status, m("界面设置已同步"));
          }
        },
        (error) => {
          if (!this.disposed) copyText(this.status, m("读取失败：{0}", [(error as Error).message]));
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
        locale: this.language.value as Locale,
        embeddedTheme: this.embedded
          ? (this.theme.value as ViewPreferences["embeddedTheme"])
          : this.state.value.embeddedTheme,
      },
    };
    copyText(this.status, m("保存界面设置中"));
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
              copyText(this.status, m("界面设置已保存并同步"));
            }
          } catch (error) {
            if (!this.disposed) copyText(this.status, m("已保存，重新读取失败：{0}", [(error as Error).message]));
          }
        },
        (error) => {
          if (["conflict", "invalid", "idempotency"].includes((error as { code?: string }).code ?? ""))
            this.pending = undefined;
          if (!this.disposed)
            copyText(
              this.status,
              this.pending
                ? m("保存结果未确认，请确认原界面保存；可关闭后继续确认。")
                : m("保存未完成：{0}", [(error as Error).message]),
            );
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
