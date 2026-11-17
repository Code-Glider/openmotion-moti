import type { Input } from "@open-motion/daemon/contract";
import type { Artifact } from "@open-motion/workspace/contract";
import type { Client } from "../../../api.js";
import type { Editor } from "../../editor.js";
import { attr, button, disclosure, display, field, m } from "../../locale/index.js";

export class Archives {
  readonly element: HTMLDetailsElement;
  private file: HTMLInputElement;
  private title: HTMLInputElement;
  private create: HTMLButtonElement;
  private download: HTMLButtonElement;
  constructor(
    document: Document,
    editor: Editor,
    private client: Client,
    run: (action: () => Promise<void>, next?: () => Promise<void>) => void,
  ) {
    const view = disclosure(document, m("工程 ZIP"));
    this.element = view.element;
    this.file = document.createElement("input");
    this.file.type = "file";
    this.file.accept = ".zip,application/zip";
    attr(this.file, "aria-label", m("导入 ZIP"));
    this.title = document.createElement("input");
    this.title.maxLength = 120;
    attr(this.title, "aria-label", m("ZIP 工程标题"));
    this.create = button(document, {
      label: m("导入 ZIP 工程"),
      onClick: () => {
        const file = this.file.files?.item(0);
        if (!file) return;
        const title =
          this.title.value.trim() ||
          file.name.replace(/\.zip$/i, "").slice(0, 120) ||
          display(this.title, m("导入工程"));
        let artifact: Artifact;
        run(
          async () => {
            artifact = await editor.createArchive(file, title);
            this.file.value = "";
            this.title.value = "";
          },
          () => editor.openArtifact(artifact),
        );
      },
    });
    this.download = button(document, {
      label: m("下载工程 ZIP"),
      onClick: () => {
        let input: Input<"archive_export"> | undefined;
        run(async () => {
          if (!input) {
            await editor.save();
            if (!editor.project) throw Error("先选择工程");
            input = {
              requestId: crypto.randomUUID(),
              sessionId: editor.project.sessionId,
              artifactId: editor.project.artifactId,
              revision: editor.project.revision,
            };
          }
          try {
            const ticket = await client.execute("archive_export", input),
              blob = await client.downloadArchive(ticket),
              url = URL.createObjectURL(blob),
              anchor = document.createElement("a");
            try {
              anchor.href = url;
              anchor.download = ticket.filename;
              anchor.click();
            } finally {
              URL.revokeObjectURL(url);
            }
          } finally {
            await client.execute("archive_release", { id: input.requestId });
          }
        });
      },
    });
    this.file.onchange = () => {
      this.create.disabled = this.file.disabled || !this.file.files?.length;
    };
    view.body.append(
      field(document, "ZIP", this.file),
      field(document, m("工程标题"), this.title),
      this.create,
      this.download,
    );
  }
  update(editor: Editor, blocked: boolean) {
    const importing =
      blocked ||
      !editor.session ||
      !!(editor.session && this.client.receipts?.blocks("archive_import", { sessionId: editor.session.id }));
    this.file.disabled = importing;
    this.title.disabled = importing;
    this.create.disabled = importing || !this.file.files?.length;
    this.download.disabled = blocked || !editor.project;
  }
  dispose() {
    this.element.remove();
  }
}
