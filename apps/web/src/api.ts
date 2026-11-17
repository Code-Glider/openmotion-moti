export type { Health, Transport } from "@open-motion/daemon/client";

import { Client as WireClient } from "@open-motion/daemon/client";
import { type Input, type Operation, type Output, schemas } from "@open-motion/daemon/contract";
import type { Intent, Receipts } from "./io.js";

/** Web resumption metadata never enters the shared wire client or server authority. */
export class Client extends WireClient {
  receipts?: Receipts;
  override async execute<K extends Operation>(operation: K, input: Input<K>, signal?: AbortSignal): Promise<Output<K>> {
    const record = this.receipts?.begin(operation, input);
    let result: Output<K>;
    try {
      result = await super.execute(operation, input, signal);
    } catch (error) {
      if (record) this.receipts?.reject(record, error);
      throw error;
    }
    if (record) this.receipts?.finish(record, result);
    return result;
  }
  /** Read only: import preflights omit uploadId, and export lookup cannot schedule a worker. */
  async lookupIo(record: Intent): Promise<boolean> {
    if (record.operation === "resource_import") return !!(await super.execute("resource_import", record.input)).project;
    if (record.operation === "archive_import") return !!(await super.execute("archive_import", record.input)).artifact;
    return !!(
      await super.execute(
        "export_lookup",
        schemas.export_lookup.parse({ ...record.input, operation: record.operation }),
      )
    ).job;
  }
}
