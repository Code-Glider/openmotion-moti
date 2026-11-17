import { Fault, type Input, type Operation, schemas } from "@open-motion/daemon/contract";

const operations = ["export_create", "export_cancel", "export_retry", "resource_import", "archive_import"] as const;
export type IoOperation = (typeof operations)[number];
export type Intent = { [K in IoOperation]: { operation: K; input: Omit<Input<K>, "uploadId"> } }[IoOperation];
const key = "openmotion.pending-io.v1";
const limit = 32;
const scope = ({ operation, input }: Intent) =>
  JSON.stringify([
    operation === "export_cancel" || operation === "export_retry" ? "export_control" : operation,
    input.sessionId,
    "artifactId" in input ? input.artifactId : null,
    "id" in input ? input.id : null,
  ]);

function parse(value: unknown): Intent {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "input,operation")
    throw Error("invalid pending I/O metadata");
  const record = value as Intent;
  if (!operations.includes(record.operation)) throw Error("unsupported pending I/O operation");
  const input = schemas[record.operation].parse(record.input);
  if ("uploadId" in input) throw Error("temporary uploads cannot be persisted");
  return { operation: record.operation, input } as Intent;
}

/** Tab/origin-scoped request metadata only. Server receipts remain the sole outcome authority. */
export class Receipts {
  private records: Intent[] = [];
  private storage?: Storage;
  readonly restored = new Set<string>();
  error?: string;
  constructor(window?: Window | null) {
    try {
      this.storage = window?.sessionStorage;
      this.read();
      for (const record of this.records) this.restored.add(record.input.requestId);
    } catch (error) {
      this.error = String(error);
    }
  }
  private read() {
    const text = this.storage?.getItem(key);
    if (text && text.length > 65536) throw Error("pending I/O metadata exceeds its bound");
    const records: unknown = text ? JSON.parse(text) : [];
    if (!Array.isArray(records) || records.length > limit) throw Error("invalid pending I/O inventory");
    const parsed = records.map(parse);
    if (new Set(parsed.map((record) => record.input.requestId)).size !== parsed.length)
      throw Error("duplicate pending I/O identity");
    this.records = parsed;
  }
  private write(records: Intent[]) {
    if (!this.storage || this.error)
      throw new Fault("invalid", "Browser session storage is required to retain manual I/O requests");
    const text = JSON.stringify(records);
    if (records.length > limit || text.length > 65536)
      throw new Fault("invalid", "Confirm pending manual I/O requests before starting more");
    // Persist before admission, and before forgetting a confirmed request. Failed writes retain the old inventory.
    this.storage.setItem(key, text);
    this.records = records;
  }
  list() {
    return this.records.filter((record) => this.restored.has(record.input.requestId));
  }
  blocks(operation: IoOperation, owner: { sessionId: string; artifactId?: string }) {
    return this.list().some(
      (record) =>
        record.operation === operation &&
        record.input.sessionId === owner.sessionId &&
        (!("artifactId" in record.input) || record.input.artifactId === owner.artifactId),
    );
  }
  begin(operation: Operation, raw: unknown): Intent | undefined {
    if (!operations.includes(operation as IoOperation)) return;
    this.read();
    const { uploadId: _, ...input } = raw as Record<string, unknown>;
    const record = parse({ operation, input });
    const prior = this.records.find((value) => value.input.requestId === record.input.requestId);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(record))
        throw new Fault("idempotency", "Pending I/O request payload changed");
      return prior;
    }
    if (this.records.some((value) => scope(value) === scope(record)))
      throw new Fault("invalid", "Confirm the original manual I/O request before starting another");
    this.write([...this.records, record]);
    return record;
  }
  confirm(record: Intent) {
    this.read();
    this.write(this.records.filter((value) => value.input.requestId !== record.input.requestId));
  }
  finish(record: Intent, result: unknown) {
    const value = result as { project?: unknown; artifact?: unknown };
    if (
      record.operation === "resource_import"
        ? value.project
        : record.operation === "archive_import"
          ? value.artifact
          : result
    )
      this.confirm(record);
  }
  reject(record: Intent, error: unknown) {
    if (error instanceof Fault && error.code !== "integrity") this.confirm(record);
  }
}
