import type { Descriptor, TemplateInput, TemplateOutput } from "@open-motion/templates/contract";
import type { Client } from "../../../api.js";
import {
  attr,
  button,
  codeEditor,
  text as copyText,
  disclosure,
  field,
  heading,
  m,
  note,
  setButton,
  slot,
} from "../../locale/index.js";
import { NativePreview } from "../preview.js";

type Selection = TemplateInput<"template_read">;
/** One verified read-only template projection; workspace creation is an explicit separate action. */
export class TemplateDetail {
  readonly element: HTMLElement;
  private heading: HTMLElement;
  private info: HTMLElement;
  private provenance: HTMLElement;
  private pending = false;
  private busy = false;
  private status: HTMLElement;
  private title: HTMLInputElement;
  private path: HTMLSelectElement;
  private code: HTMLTextAreaElement;
  private seek: HTMLInputElement;
  private create: HTMLButtonElement;
  private retry: HTMLButtonElement;
  private transport: HTMLButtonElement[];
  private preview: NativePreview;
  private active = false;
  private blocked = false;
  private ready = false;
  private loading = false;
  private disposed = false;
  private epoch = 0;
  private key = "";
  private target?: Selection | null;
  private selected?: TemplateOutput<"template_read">;
  private drafts = new Map<string, string>();
  private controller?: AbortController;
  private flights = new Set<Promise<void>>();
  constructor(
    document: Document,
    private client: Client,
    private actions: {
      back(): void;
      create(template: Descriptor, title: string, trigger: HTMLElement): void;
      resume(trigger: HTMLElement): void;
    },
  ) {
    this.element = slot(document, "fill");
    this.element.setAttribute("role", "region");
    attr(this.element, "aria-label", m("模板详情"));
    this.element.hidden = true;
    const content = slot(document, "content"),
      toolbar = slot(document, "toolbar"),
      host = slot(document, "fill");
    this.heading = heading(document, m("模板详情"));
    this.heading.tabIndex = -1;
    this.info = slot(document, "stack");
    this.status = note(document, "");
    this.status.setAttribute("role", "status");
    attr(this.status, "aria-label", m("模板预览状态"));
    this.title = document.createElement("input");
    this.title.maxLength = 120;
    attr(this.title, "aria-label", m("独立项目标题"));
    this.title.oninput = () => this.drafts.set(this.key, this.title.value);
    this.create = button(document, {
      label: m("从此模板创建独立项目"),
      primary: true,
      onClick: this.createProject,
    });
    this.retry = button(document, { label: m("重试模板预览"), onClick: () => this.load() });
    const back = button(document, { label: m("返回模板目录"), onClick: actions.back });
    this.seek = document.createElement("input");
    this.seek.type = "number";
    this.seek.min = "0";
    this.seek.step = "0.1";
    this.seek.value = "0";
    attr(this.seek, "aria-label", m("模板定位秒"));
    this.transport = [
      button(document, { label: m("播放模板预览"), onClick: () => this.preview.control("play") }),
      button(document, { label: m("暂停模板预览"), onClick: () => this.preview.control("pause") }),
      button(document, {
        label: m("定位模板预览"),
        onClick: () => {
          const time = this.seek.valueAsNumber;
          if (Number.isFinite(time) && time >= 0 && time <= (this.selected?.template.duration ?? 0))
            this.preview.control("seek", time);
          else copyText(this.status, m("请输入模板时长以内的有效秒数"));
        },
      }),
    ];
    toolbar.append(back, this.retry, ...this.transport, field(document, m("模板定位秒"), this.seek));
    const source = disclosure(document, m("已验证源码与许可"), false);
    this.path = document.createElement("select");
    attr(this.path, "aria-label", m("模板源文件"));
    this.code = codeEditor(document);
    this.code.readOnly = true;
    attr(this.code, "aria-label", m("模板源码"));
    this.path.onchange = () => this.showSource();
    this.provenance = slot(document, "stack");
    source.body.append(this.provenance, field(document, m("模板源文件"), this.path), this.code);
    this.preview = new NativePreview(host, client, () => null, {
      message: (value) => {
        if (this.active && value) copyText(this.status, value);
      },
      ready: () => {
        if (this.active) {
          this.ready = true;
          this.preview.control("seek", Math.min(1, (this.selected?.template.duration ?? 2) / 2));
          this.controls();
        }
      },
      time: (value) => {
        if (document.activeElement !== this.seek) this.seek.value = value.toFixed(2);
      },
      select: () => {},
    });
    content.append(
      this.heading,
      note(document, m("浏览和播放不会创建项目。确认模板后，可创建独立的可编辑工程。")),
      this.info,
      field(document, m("独立项目标题"), this.title),
      this.create,
      toolbar,
      this.status,
      host,
      source.element,
    );
    this.element.append(content);
    this.controls();
  }
  activate(active: boolean, target?: Selection | null) {
    const key = target ? `${target.id}:${target.contentHash}` : target === null ? "invalid" : "";
    if (active === this.active && key === this.key) return;
    this.active = active;
    this.key = key;
    this.target = target;
    this.element.hidden = !active;
    this.element.inert = !active;
    this.controller?.abort();
    ++this.epoch;
    this.ready = false;
    if (!active) {
      void this.preview.close().catch(() => {});
      this.controls();
      return;
    }
    this.load();
    this.heading.focus();
  }
  update(blocked: boolean, pending = false, busy = false) {
    this.blocked = blocked;
    this.pending = pending;
    this.busy = busy;
    this.controls();
  }
  private load() {
    if (!this.active || this.disposed) return;
    this.controller?.abort();
    const controller = new AbortController(),
      epoch = ++this.epoch;
    this.controller = controller;
    this.ready = false;
    this.loading = true;
    this.selected = undefined;
    copyText(this.status, this.target ? m("正在验证模板源码") : m("模板链接无效，请返回目录重新选择"));
    this.provenance.replaceChildren();
    this.title.value = "";
    this.info.replaceChildren();
    this.code.value = "";
    this.path.replaceChildren();
    copyText(this.heading, m("模板详情"));
    this.controls();
    const flight = (async () => {
      await this.preview.close();
      if (!this.active || epoch !== this.epoch) return;
      if (!this.target) {
        copyText(this.status, m("模板链接无效，请返回目录重新选择"));
        return;
      }
      copyText(this.status, m("正在验证模板源码"));
      const selected = await this.client.execute("template_read", this.target, controller.signal);
      if (!this.active || epoch !== this.epoch) return;
      if (selected.template.id !== this.target.id || selected.template.contentHash !== this.target.contentHash)
        throw Error("模板来源版本不匹配");
      this.selected = selected;
      const { template, files } = selected,
        document = this.element.ownerDocument;
      copyText(this.heading, template.title);
      this.title.value = this.drafts.get(this.key) ?? template.title;
      this.seek.value = "0";
      this.seek.max = String(template.duration);
      this.info.replaceChildren(
        note(document, template.description),
        note(
          document,
          m("{0} 秒 · {1} × {2} · {3} 个源文件 · {4}", [
            template.duration,
            template.width,
            template.height,
            files.length,
            template.license,
          ]),
        ),
      );
      this.provenance.replaceChildren(
        note(document, template.source),
        note(document, m("模板 {0} · 来源版本 {1}", [template.id, template.contentHash])),
        ...template.adaptations.map((value) => note(document, value)),
      );
      this.path.replaceChildren(
        ...files.map((file) => {
          const option = document.createElement("option");
          option.value = file.path;
          copyText(option, file.path);
          return option;
        }),
      );
      this.path.value = "index.html";
      this.showSource();
      await this.preview.openTemplate(this.target);
    })()
      .catch((error) => {
        if (this.active && epoch === this.epoch)
          copyText(this.status, m("模板预览不可用：{0} · 可重试或返回目录", [(error as Error).message]));
      })
      .finally(() => {
        this.flights.delete(flight);
        if (epoch === this.epoch) {
          this.loading = false;
          this.controls();
        }
      });
    this.flights.add(flight);
  }
  private showSource() {
    this.code.value = this.selected?.files.find((file) => file.path === this.path.value)?.content ?? "";
  }
  private createProject = () => {
    if (this.pending) {
      this.actions.resume(this.create);
      return;
    }
    if (this.selected && this.ready && !this.blocked)
      this.actions.create(this.selected.template, this.title.value.trim() || this.selected.template.title, this.create);
  };
  private controls() {
    setButton(this.create, {
      primary: true,
      onClick: this.createProject,
      label: this.pending ? m("继续上次创建") : m("从此模板创建独立项目"),
      disabled: !this.active || (this.pending ? this.busy : this.blocked || !this.ready || !this.selected),
    });
    this.title.disabled = this.blocked || !this.selected;
    for (const control of this.transport) control.disabled = !this.ready;
    this.seek.disabled = !this.ready;
    this.retry.disabled = !this.active || this.loading;
    this.path.disabled = !this.selected;
    this.code.disabled = !this.selected;
  }
  async dispose() {
    this.disposed = true;
    this.active = false;
    ++this.epoch;
    this.controller?.abort();
    await this.preview.close();
    await Promise.all(this.flights);
    await this.preview.dispose();
    this.element.remove();
  }
}
