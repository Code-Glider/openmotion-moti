import { button, dialog, note, setButton, slot } from "@open-motion/components";
import type { ContentVersion, Input, Output } from "@open-motion/workspace/contract";
import type { Client } from "../../../api.js";
import type { Editor } from "../../editor.js";

/** Read-only version pages; the existing Editor owns save/restore intents and source application. */
export class Versions {
  readonly view;
  private list: HTMLElement;
  private status: HTMLElement;
  private restore: HTMLButtonElement;
  private previous: HTMLButtonElement;
  private next: HTMLButtonElement;
  private refresh: HTMLButtonElement;
  private page?: Output<"project_versions">;
  private cursor?: Input<"project_versions">["cursor"];
  private history: Input<"project_versions">["cursor"][] = [];
  private selected?: string;
  private key = "";
  private blocked = false;
  private loading = false;
  private epoch = 0;
  private controller?: AbortController;
  private flights = new Set<Promise<void>>();
  private disposed = false;
  constructor(
    document: Document,
    private editor: Editor,
    private client: Client,
    private run: (action: () => Promise<void>) => unknown,
  ) {
    this.view = dialog(document, "版本历史", true);
    this.status = note(document, "打开版本历史以读取工程快照");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-label", "版本读取状态");
    this.list = slot(document, "stack");
    this.list.setAttribute("role", "list");
    this.list.setAttribute("aria-label", "工程版本");
    this.restore = button(document, { label: "恢复为新版本", primary: true, onClick: () => this.apply() });
    this.previous = button(document, {
      label: "上一页版本",
      onClick: () => {
        this.cursor = this.history.pop();
        this.load();
      },
    });
    this.next = button(document, {
      label: "下一页版本",
      onClick: () => {
        if (this.page?.nextCursor) {
          this.history.push(this.cursor);
          this.cursor = this.page.nextCursor;
          this.load();
        }
      },
    });
    this.refresh = button(document, { label: "刷新版本历史", onClick: () => this.reset() });
    const pages = slot(document, "toolbar");
    pages.append(this.previous, this.next, this.refresh);
    this.view.body.append(
      note(document, "每页五个完整快照。恢复会先保存当前修改，再创建新版本；后续版本会保留。"),
      this.status,
      this.list,
      pages,
      this.restore,
    );
    this.view.element.addEventListener("close", this.closed);
    this.controls();
  }
  private closed = () => {
    this.controller?.abort();
    ++this.epoch;
    this.loading = false;
  };
  open(trigger: HTMLElement) {
    this.view.open(trigger);
    this.reset();
  }
  update(blocked: boolean) {
    this.blocked = blocked;
    const project = this.editor.project,
      key = project ? `${project.sessionId}:${project.artifactId}:${project.revision}:${project.history.version}` : "";
    if (key !== this.key) {
      this.key = key;
      this.controller?.abort();
      ++this.epoch;
      this.page = undefined;
      this.selected = undefined;
      this.list.replaceChildren();
      if (this.view.element.open) this.reset();
    }
    this.controls();
  }
  private reset() {
    this.cursor = undefined;
    this.history = [];
    this.load();
  }
  private load() {
    if (this.disposed || !this.view.element.open) return;
    this.controller?.abort();
    const project = this.editor.project,
      epoch = ++this.epoch,
      controller = new AbortController();
    this.controller = controller;
    if (!project) {
      this.status.textContent = "先打开工程";
      this.controls();
      return;
    }
    this.loading = true;
    this.status.textContent = "正在读取版本";
    this.controls();
    const flight = this.client
      .execute(
        "project_versions",
        { sessionId: project.sessionId, artifactId: project.artifactId, cursor: this.cursor },
        controller.signal,
      )
      .then(
        (page) => {
          if (this.disposed || epoch !== this.epoch) return;
          this.page = page;
          if (!page.versions.some((v) => v.id === this.selected)) this.selected = page.versions[0]?.id;
          this.status.textContent = page.newerAvailable ? "此分页读取期间有新版本，请刷新查看" : "版本已就绪";
          this.paint();
        },
        (error) => {
          if (!this.disposed && epoch === this.epoch)
            this.status.textContent = `版本读取失败：${(error as Error).message}`;
        },
      )
      .finally(() => {
        this.flights.delete(flight);
        if (!this.disposed && epoch === this.epoch) {
          this.loading = false;
          this.controls();
        }
      });
    this.flights.add(flight);
  }
  private label(version: ContentVersion) {
    return version.kind === "legacy" ? `既有快照 #${version.number}（时间与先后未知）` : `v${version.number}`;
  }
  private paint() {
    const document = this.list.ownerDocument;
    this.list.replaceChildren();
    for (const version of this.page?.versions ?? []) {
      const row = slot(document, "stack"),
        select = button(document, {
          label: this.label(version),
          selected: version.id === this.selected,
          onClick: () => {
            this.selected = version.id;
            this.paint();
            this.controls();
          },
        }),
        current = version.id === this.page?.current.id,
        kinds = { create: "创建", edit: "编辑", undo: "撤销", redo: "重做", restore: "恢复", legacy: "既有快照" };
      row.setAttribute("role", "listitem");
      row.append(
        select,
        note(
          document,
          `${kinds[version.kind]}${current ? " · 当前版本" : ""}${version.createdAt === null ? "" : ` · ${new Date(version.createdAt).toLocaleString("zh-CN")}`}`,
        ),
      );
      if (!version.restorable) row.append(note(document, `无法恢复：${version.unavailableFiles.join("、")}`));
      if (version.restoredFromVersionId) row.append(note(document, "此版本由历史快照恢复，原版本仍保留"));
      this.list.append(row);
    }
  }
  private apply() {
    const target = this.editor.versions.pending ?? this.selected;
    if (target && !this.restore.disabled) this.run(() => this.editor.versions.restore(target));
  }
  private controls() {
    const pending = this.editor.versions.pending,
      version = this.page?.versions.find((v) => v.id === this.selected);
    setButton(this.restore, {
      label: pending
        ? "继续上次恢复"
        : this.editor.dirty || this.editor.drafts?.dirty()
          ? "保存当前修改并恢复为新版本"
          : "恢复为新版本",
      primary: true,
      onClick: () => this.apply(),
    });
    this.restore.disabled =
      this.blocked ||
      (!pending &&
        (this.loading || this.editor.unconfirmed || !version?.restorable || version.id === this.page?.current.id));
    this.previous.disabled = this.loading || !this.history.length;
    this.next.disabled = this.loading || !this.page?.nextCursor;
    this.refresh.disabled = this.loading;
  }
  async dispose() {
    this.disposed = true;
    this.controller?.abort();
    ++this.epoch;
    this.view.element.removeEventListener("close", this.closed);
    this.view.dispose();
    await Promise.allSettled([...this.flights]);
  }
}
