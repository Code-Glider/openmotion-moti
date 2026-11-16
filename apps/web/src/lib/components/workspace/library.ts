import { button, field, heading, layout, note, panel, slot } from "@open-motion/components";
import type { TemplateOutput } from "@open-motion/templates/contract";
import type { Client } from "../../../api.js";

type Catalog = TemplateOutput<"template_list">;
type Entry = Catalog["templates"][number] | NonNullable<Catalog["catalog"]>["entries"][number];
/** Read-only presentation of the existing catalogue; creates no session, project or preview. */
export class Library {
  readonly element: HTMLElement;
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
  ) {
    this.element = slot(document, "fill");
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", "模板库");
    this.element.hidden = true;
    this.element.inert = true;
    const content = slot(document, "content"),
      actions = slot(document, "toolbar");
    this.query = document.createElement("input");
    this.query.type = "search";
    this.query.maxLength = 120;
    this.query.setAttribute("aria-label", "搜索模板");
    this.query.oninput = () => {
      this.page = 0;
      this.render();
    };
    this.refresh = button(document, {
      label: "刷新模板库",
      icon: "refresh",
      compact: true,
      onClick: () => this.load(),
    });
    this.previous = button(document, {
      label: "上一页模板",
      compact: true,
      onClick: () => {
        this.page--;
        this.render();
      },
    });
    this.next = button(document, {
      label: "下一页模板",
      compact: true,
      onClick: () => {
        this.page++;
        this.render();
      },
    });
    this.status = note(document, "打开模板库以读取目录");
    this.status.setAttribute("role", "status");
    this.list = layout(document, "stack");
    this.list.setAttribute("aria-label", "模板目录");
    actions.append(this.refresh, this.previous, this.next);
    content.append(
      heading(document, "模板库"),
      note(document, "浏览不会创建项目。返回编辑工作区后，可从新建项目选择模板。"),
      field(document, "搜索模板", this.query),
      actions,
      this.status,
      this.list,
    );
    this.element.append(content);
    this.render();
  }
  activate(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.element.hidden = !active;
    this.element.inert = !active;
    if (!active) {
      if (this.flight)
        this.status.textContent = this.catalog ? "刷新已暂停 · 保留上次目录，可刷新重试" : "目录读取已暂停";
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
    this.status.textContent = "正在读取模板目录";
    this.refresh.disabled = true;
    const flight = this.client
      .execute("template_list", {}, controller.signal)
      .then(
        (result) => {
          if (this.disposed || !this.active || epoch !== this.epoch) return;
          const entries: Entry[] = [...result.templates];
          for (const entry of result.catalog?.entries ?? [])
            if (!entries.some((e) => e.id === entry.id && e.contentHash === entry.contentHash)) entries.push(entry);
          this.catalog = entries;
          this.page = 0;
          this.status.textContent = result.catalogError
            ? `目录读取失败：${result.catalogError} · 仍可浏览内置模板`
            : result.catalog?.stale
              ? `使用已验证目录缓存 · ${result.catalog.warning ?? "远端暂不可用"}`
              : `共 ${entries.length} 个模板`;
          this.render();
        },
        (error) => {
          if (!this.disposed && this.active && epoch === this.epoch)
            this.status.textContent = `模板目录读取失败：${(error as Error).message} · 可刷新重试${this.catalog ? "，保留上次目录" : ""}`;
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
                ? `暂不支持：${entry.reason ?? "资源类型未验证"}`
                : "创建前需要读取并验证源码"
              : `${entry.duration} 秒 · ${entry.width} × ${entry.height}`,
          ),
          note(document, `${entry.source} · ${entry.license}`),
        );
        return card;
      }),
    );
    if (this.catalog && !entries.length) this.list.append(note(document, query ? "没有匹配的模板" : "目录中暂无模板"));
  }
  async dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.epoch++;
    await Promise.all(this.flights);
    this.element.remove();
  }
}
