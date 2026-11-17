import { archiveLimits } from "@open-motion/daemon/contract";
import { Fault } from "@open-motion/workspace/contract";
import type { Client } from "../../../../api.js";
import type { Intent } from "../../../../io.js";
import { attr, button, text as copyText, disclosure, field, m, note, slot } from "../../../locale/index.js";

/** Resumption is explicit; reading a receipt neither uploads bytes nor repeats a render. */
export class Recovery {
  readonly element: HTMLDetailsElement;
  private rows: HTMLElement;
  private status: HTMLElement;
  private key = "";
  constructor(
    private document: Document,
    private client: Client,
    private run: (action: () => Promise<void>) => void,
  ) {
    const view = disclosure(document, m("待确认的手动操作"), true);
    this.element = view.element;
    attr(this.element, "aria-label", m("待确认的手动操作"));
    this.rows = slot(document, "content");
    this.status = note(document, "");
    this.status.setAttribute("role", "status");
    view.body.append(note(document, m("检查不会上传文件或启动导出；未找到回执仍不代表失败。")), this.rows, this.status);
  }
  update(blocked: boolean) {
    const receipts = this.client.receipts;
    // Exact project entry can fail after a committed import advanced its revision.
    // Recovery must remain available; the server validates each original owner.
    const records = receipts?.list() ?? [];
    this.element.hidden = !records.length && !receipts?.error && !this.status.textContent;
    if (receipts?.error) copyText(this.status, m("恢复记录不可用：{0}", [receipts.error]));
    const key = JSON.stringify(records);
    if (key !== this.key) {
      this.key = key;
      this.rows.replaceChildren(...records.map((record) => this.row(record)));
    }
    for (const control of this.rows.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button"))
      control.disabled = blocked;
  }
  private row(record: Intent) {
    const row = slot(this.document, "content");
    row.dataset.ioRequest = record.input.requestId;
    const label =
      record.operation === "archive_import"
        ? m("导入 ZIP 工程")
        : record.operation === "resource_import"
          ? m("导入媒体")
          : record.operation === "export_cancel"
            ? m("取消导出")
            : record.operation === "export_retry"
              ? m("重试此导出")
              : m("影片导出");
    row.append(note(this.document, label));
    const input = record.input;
    row.append(
      note(
        this.document,
        "name" in input
          ? input.name
          : "title" in input
            ? input.title
            : "revision" in input
              ? input.revision.slice(7, 19)
              : "",
      ),
    );
    row.append(
      button(this.document, {
        label: m("检查原操作"),
        onClick: () =>
          this.run(async () => {
            copyText(this.status, m("正在检查原操作"));
            if (await this.client.lookupIo(record)) {
              this.client.receipts?.confirm(record);
              copyText(this.status, m("原操作已确认；保留当前草稿与选择。"));
            } else copyText(this.status, m("检查不会上传文件或启动导出；未找到回执仍不代表失败。"));
          }),
      }),
    );
    if (record.operation === "resource_import" || record.operation === "archive_import") {
      const file = this.document.createElement("input");
      file.type = "file";
      file.accept = record.operation === "archive_import" ? ".zip" : `.${record.input.path.split(".").at(-1)}`;
      attr(file, "aria-label", m("重新选择原文件"));
      file.onchange = () => {
        const selected = file.files?.item(0);
        if (selected)
          this.run(async () => {
            await this.import(record, selected);
            file.value = "";
            copyText(this.status, m("原操作已确认；保留当前草稿与选择。"));
          });
      };
      row.append(field(this.document, m("重新选择原文件"), file));
    } else
      row.append(
        button(this.document, {
          label: m("继续原操作"),
          onClick: () =>
            this.run(async () => {
              await this.client.execute(record.operation, record.input);
              copyText(this.status, m("原操作已确认；保留当前草稿与选择。"));
            }),
        }),
      );
    return row;
  }
  private async import(record: Extract<Intent, { operation: "resource_import" | "archive_import" }>, file: File) {
    const limit = record.operation === "resource_import" ? record.input.bytes : archiveLimits.bytes;
    if (!file.size || file.size > limit) throw new Fault("invalid", "Selected file does not match the original import");
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    const digest = `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (digest !== record.input.digest) throw new Fault("invalid", "Selected file does not match the original import");
    if (record.operation === "resource_import") {
      await this.client.importResource(record.input, file);
      return;
    }
    if (!(await this.client.execute("archive_import", record.input)).artifact) {
      const upload = await this.client.execute("archive_upload", {
        requestId: crypto.randomUUID(),
        digest,
        bytes: file.size,
      });
      try {
        await this.client.uploadArchive(upload, file);
        const result = await this.client.execute("archive_import", { ...record.input, uploadId: upload.id });
        if (!result.artifact) throw Error("archive import receipt missing");
      } finally {
        await this.client.execute("archive_release", { id: upload.id }).catch(() => {});
      }
    }
  }
}
