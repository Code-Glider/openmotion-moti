import {
  catalogEntries,
  type Descriptor,
  type TemplateInput,
  type TemplateOutput,
} from "@open-motion/templates/contract";
import type { Client } from "../../../api.js";
import { attr, button, text as copyText, field, heading, layout, m, note, panel, slot } from "../../locale/index.js";
import { TemplateDetail } from "./detail.js";

type Catalog = TemplateOutput<"template_list">;
type Entry = Catalog["templates"][number] | NonNullable<Catalog["catalog"]>["entries"][number];
/** Read-only presentation of the existing catalogue; creates no session, project or preview. */
export class Library {
  readonly element: HTMLElement;
  private detail: TemplateDetail;
  private content: HTMLElement;
  private query: HTMLInputElement;
  private list: HTMLElement;
  private status: HTMLElement;
  private refresh: HTMLButtonElement;
  private previous: HTMLButtonElement;
  private next: HTMLButtonElement;
  private catalog?: Entry[];
  private page = 0;
  private active = false;
  private disposed = false;
  private epoch = 0;
  private controller?: AbortController;
  private flight?: Promise<void>;
  private flights = new Set<Promise<void>>();
  constructor(
    document: Document,
    private client: Client,
    private actions: {
      select(template: TemplateInput<"template_read">): void;
      back(): void;
      create(template: Descriptor, title: string, trigger: HTMLElement): void;
      resume(trigger: HTMLElement): void;
    },
  ) {
    this.element = slot(document, "fill");
    this.element.setAttribute("role", "region");
    attr(this.element, "aria-label", m("模板库"));
    this.element.hidden = true;
    this.element.inert = true;
    const content = slot(document, "content"),
      toolbar = slot(document, "toolbar");
    this.content = content;
    this.query = document.createElement("input");
    this.query.type = "search";
    this.query.maxLength = 120;
    attr(this.query, "aria-label", m("搜索模板"));
    this.query.oninput = () => {
      this.page = 0;
      this.render();
    };
    this.refresh = button(document, {
      label: m("刷新模板库"),
      icon: "refresh",
      compact: true,
      onClick: () => this.load(),
    });
    this.previous = button(document, {
      label: m("上一页模板"),
      compact: true,
      onClick: () => {
        this.page--;
        this.render();
      },
    });
    this.next = button(document, {
      label: m("下一页模板"),
      compact: true,
      onClick: () => {
        this.page++;
        this.render();
      },
    });
    this.status = note(document, m("打开模板库以读取目录"));
    this.status.setAttribute("role", "status");
    this.list = layout(document, "stack");
    attr(this.list, "aria-label", m("模板目录"));
    toolbar.append(this.refresh, this.previous, this.next);
    content.append(
      heading(document, m("模板库")),
      note(document, m("浏览不会创建项目。查看模板详情和原生预览，再明确创建独立工程。")),
      field(document, m("搜索模板"), this.query),
      toolbar,
      this.status,
      this.list,
    );
    this.detail = new TemplateDetail(document, client, actions);
    this.element.append(content, this.detail.element);
    this.render();
  }
  activate(visible: boolean, target?: TemplateInput<"template_read"> | null) {
    const returnFocus =
      visible && target === undefined && this.detail.element.contains(this.element.ownerDocument.activeElement);
    this.element.hidden = !visible;
    this.element.inert = !visible;
    this.content.hidden = target !== undefined;
    this.detail.activate(visible && target !== undefined, target);
    if (returnFocus) this.query.focus();
    const active = visible && target === undefined;
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      if (this.flight)
        copyText(this.status, this.catalog ? m("刷新已暂停 · 保留上次目录，可刷新重试") : m("目录读取已暂停"));
      this.epoch++;
      this.controller?.abort();
      this.flight = undefined;
      this.refresh.disabled = false;
    } else if (!this.catalog && !this.flight) this.load();
  }
  private load() {
    if (!this.active || this.flight || this.disposed) return;
    const controller = new AbortController(),
      epoch = ++this.epoch;
    this.controller = controller;
    copyText(this.status, m("正在读取模板目录"));
    this.refresh.disabled = true;
    const flight = this.client
      .execute("template_list", {}, controller.signal)
      .then(
        (result) => {
          if (this.disposed || !this.active || epoch !== this.epoch) return;
          const entries = catalogEntries(result);
          this.catalog = entries;
          this.page = 0;
          copyText(
            this.status,
            result.catalogError
              ? m("目录读取失败：{0} · 仍可浏览内置模板", [result.catalogError])
              : result.catalog?.stale
                ? m("使用已验证目录缓存 · {0}", [result.catalog.warning ?? m("远端暂不可用")])
                : m("共 {0} 个模板", [entries.length]),
          );
          this.render();
        },
        (error) => {
          if (!this.disposed && this.active && epoch === this.epoch)
            copyText(
              this.status,
              m("模板目录读取失败：{0} · 可刷新重试{1}", [
                (error as Error).message,
                this.catalog ? m("，保留上次目录") : "",
              ]),
            );
        },
      )
      .finally(() => {
        this.flights.delete(flight);
        if (epoch === this.epoch) {
          this.flight = undefined;
          this.refresh.disabled = false;
        }
      });
    this.flight = flight;
    this.flights.add(flight);
  }
  private render() {
    const query = this.query.value.trim().toLocaleLowerCase(),
      entries = (this.catalog ?? []).filter((e) => `${e.title} ${e.description}`.toLocaleLowerCase().includes(query)),
      start = this.page * 12;
    this.previous.disabled = this.page === 0;
    this.next.disabled = start + 12 >= entries.length;
    const document = this.element.ownerDocument;
    this.list.replaceChildren(
      ...entries.slice(start, start + 12).map((entry) => {
        const card = panel(document, entry.title);
        card.dataset.templateId = entry.id;
        card.dataset.templateHash = entry.contentHash;
        card.append(
          note(document, entry.description),
          note(
            document,
            "availability" in entry
              ? entry.availability === "unsupported"
                ? m("暂不支持：{0}", [entry.reason ?? m("资源类型未验证")])
                : m("创建前需要读取并验证源码")
              : m("{0} 秒 · {1} × {2}", [entry.duration, entry.width, entry.height]),
          ),
          note(document, `${entry.source} · ${entry.license}`),
          button(document, {
            label: m("查看模板详情"),
            disabled: "availability" in entry && entry.availability === "unsupported",
            onClick: () => this.actions.select({ id: entry.id, contentHash: entry.contentHash }),
          }),
        );
        return card;
      }),
    );
    if (this.catalog && !entries.length)
      this.list.append(note(document, query ? m("没有匹配的模板") : m("目录中暂无模板")));
  }
  update(blocked: boolean, pending = false, busy = false) {
    this.detail.update(blocked, pending, busy);
  }
  async dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.epoch++;
    await this.detail.dispose();
    await Promise.all(this.flights);
    this.element.remove();
  }
}
