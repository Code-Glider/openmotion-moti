import { mergeSources, type SourceChoice } from "@open-motion/workspace/contract";
import type { Editor } from "../../editor.js";
import type { Copy } from "../../locale/index.js";
import { attr, button, codeEditor, text as copyText, disclosure, field, m, note, slot } from "../../locale/index.js";
import type { ConnectionState } from "../../observe.js";

/** Explicit decisions only; a successful merge remains a local draft until Save. */
export class WorkspaceSync {
  readonly element: HTMLElement;
  private connection: HTMLElement;
  private reconnect: HTMLButtonElement;
  private connectionState: ConnectionState = "connecting";
  private blocked = true;
  private body: HTMLElement;
  private summary: HTMLElement;
  private conflicts: HTMLElement;
  private prepare: HTMLButtonElement;
  private merge: HTMLButtonElement;
  private follow: HTMLButtonElement;
  private retain: HTMLButtonElement;
  private signature = "";
  private invalid = false;
  private choices = new Map<string, SourceChoice>();
  private selectors = new Map<string, HTMLSelectElement>();
  constructor(
    document: Document,
    private editor: Editor,
    private run: (action: () => Promise<void>) => void,
    retryConnection: () => void,
  ) {
    this.element = slot(document, "content");
    this.connection = note(document, m("正在观察工作区"));
    attr(this.connection, "aria-label", m("协作连接状态"));
    this.connection.setAttribute("role", "status");
    this.reconnect = button(document, { label: m("重试工作区连接"), compact: true, onClick: retryConnection });
    this.reconnect.hidden = true;
    this.body = slot(document, "stack");
    attr(this.body, "aria-label", m("外部修改"));
    this.body.hidden = true;
    this.summary = note(document, "");
    this.conflicts = slot(document, "content");
    this.prepare = button(document, {
      label: m("准备本地属性草稿"),
      compact: true,
      onClick: () => run(() => editor.prepareExternal()),
    });
    this.merge = button(document, {
      label: m("合并到本地草稿"),
      compact: true,
      onClick: () => {
        const token = editor.incoming?.token,
          choices = Object.fromEntries(this.choices);
        if (token) run(async () => editor.reconcile(token, choices));
      },
    });
    this.follow = button(document, {
      label: m("放弃本地草稿并同步"),
      compact: true,
      onClick: () => run(() => editor.useExternal()),
    });
    this.retain = button(document, {
      label: m("返回本地工程并保留草稿"),
      compact: true,
      onClick: () => run(() => editor.retainContext()),
    });
    const actions = slot(document, "toolbar");
    actions.append(this.prepare, this.merge, this.retain, this.follow);
    this.body.append(
      this.summary,
      this.conflicts,
      actions,
      note(document, m("合并不会自动保存。未冲突的文件保留双方修改；冲突文件请显式选择，保存时仍会校验版本。")),
    );
    this.element.append(this.connection, this.reconnect, this.body);
  }
  status(value: Copy, state: ConnectionState) {
    copyText(this.connection, value);
    this.connectionState = state;
    this.connectionControls();
  }
  private connectionControls() {
    this.reconnect.hidden = this.connectionState !== "disconnected";
    this.reconnect.disabled = this.blocked;
  }
  update(blocked: boolean) {
    this.blocked = blocked;
    this.connectionControls();
    const incoming = this.editor.incoming,
      local = this.editor.project,
      remote = incoming?.project;
    this.body.hidden = !incoming;
    if (!incoming) {
      this.signature = "";
      this.choices.clear();
      this.selectors.clear();
      this.conflicts.replaceChildren();
      return;
    }
    const same = !!local && local.artifactId === remote?.artifactId && local.sessionId === remote?.sessionId;
    const native = !!this.editor.drafts?.dirty();
    const key = JSON.stringify([
      incoming.state.selection,
      remote?.revision,
      remote?.history.version,
      this.editor.sources,
      native,
    ]);
    if (key !== this.signature) {
      this.signature = key;
      this.invalid = false;
      this.choices.clear();
      this.selectors.clear();
      this.conflicts.replaceChildren();
      if (same && !native) {
        try {
          for (const conflict of mergeSources(local.files, this.editor.sources, remote.files).conflicts) {
            const document = this.element.ownerDocument,
              view = disclosure(document, conflict.path, false),
              select = document.createElement("select");
            attr(select, "aria-label", m("冲突选择 {0}", [conflict.path]));
            for (const [value, text] of [
              ["", m("请选择冲突内容")],
              ["local", m("保留本地内容")],
              ["remote", m("采用外部内容")],
            ] as const) {
              const option = document.createElement("option");
              option.value = value!;
              copyText(option, text!);
              select.append(option);
            }
            select.onchange = () => {
              if (select.value) this.choices.set(conflict.path, select.value as SourceChoice);
              else this.choices.delete(conflict.path);
              this.state(blocked, same, native);
            };
            this.selectors.set(conflict.path, select);
            for (const [label, content] of [
              [m("本地源码"), conflict.local],
              [m("外部源码"), conflict.remote],
            ] as const) {
              const source = codeEditor(document);
              source.readOnly = true;
              attr(source, "aria-label", m("{0} {1}", [label, conflict.path]));
              source.value = content ?? "";
              if (content === undefined) attr(source, "placeholder", m("（文件已删除）"));
              view.body.append(field(document, label!, source));
            }
            this.conflicts.append(field(document, conflict.path, select), view.element);
          }
        } catch (error) {
          this.invalid = true;
          this.conflicts.append(note(this.element.ownerDocument, (error as Error).message));
        }
      }
    }
    copyText(
      this.summary,
      same
        ? m("检测到其他调用方修改，当前内容与本地草稿仍保留。")
        : m("工作区已切换到另一上下文；当前工程与草稿仍保留，请选择后续操作。"),
    );
    this.state(blocked, same, native);
  }
  private state(blocked: boolean, same: boolean, native: boolean) {
    this.prepare.hidden = !same || !native;
    this.prepare.disabled = blocked;
    this.merge.hidden = !same || native;
    this.merge.disabled = blocked || this.invalid || this.choices.size !== this.selectors.size;
    this.retain.hidden = same || !this.editor.project;
    this.retain.disabled = blocked;
    this.follow.disabled = blocked;
    for (const select of this.selectors.values()) select.disabled = blocked;
  }
}
