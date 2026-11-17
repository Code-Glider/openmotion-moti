import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "@odsuite/protocol";
import { expect, it } from "vitest";
import { Store } from "@/jobs/store.js";

it("bounds retried intent as well as new submissions and preserves unknown receipts across journal reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-journal-")),
    owner = { sessionId: randomUUID(), artifactId: randomUUID() },
    input = {
      ...owner,
      requestId: randomUUID(),
      revision: digest("fixed source"),
      fps: { num: 30, den: 1 },
      projection: { digest: digest("frozen source"), bytes: 100 },
    };
  let store = new Store(root);
  try {
    const original = store.create(input),
      cancel = { ...owner, id: original.id, requestId: randomUUID(), expectedVersion: original.version },
      cancelled = store.control("export_cancel", cancel),
      retry = { ...owner, id: original.id, requestId: randomUUID(), expectedVersion: cancelled.version };
    for (let n = 0; n < 32; n++) store.create({ ...input, requestId: randomUUID() });
    expect(() => store.control("export_retry", retry)).toThrow("queue is full");
    expect(store.owned({ ...owner, id: original.id }).job).toEqual(cancelled);
    // A rejected transaction must not consume the request identity.
    const queued = store.list({ ...owner, limit: 1 }).jobs[0]!;
    store.control("export_cancel", {
      ...owner,
      id: queued.id,
      requestId: randomUUID(),
      expectedVersion: queued.version,
    });
    const accepted = store.control("export_retry", retry);
    expect(accepted.state).toBe("queued");
    expect(accepted.attempt).not.toBe(original.attempt);
    expect(() => store.create({ ...input, requestId: randomUUID() })).toThrow("queue is full");
    store.close();
    store = new Store(root);
    expect(store.control("export_retry", retry)).toEqual(accepted);
    expect(store.create(input)).toEqual(original);
    const record = store.owned({ ...owner, id: original.id });
    record.diagnostic = join(root, "private failure path");
    record.job.error = "Export execution failed; inspect renderer journal diagnostics";
    store.write(record);
    expect(JSON.stringify(store.list(owner))).not.toContain(root);
    expect(store.read(original.id).diagnostic).toContain(root);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("looks up exact durable receipts without replaying controls or changing the journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-lookup-")),
    owner = { sessionId: randomUUID(), artifactId: randomUUID() },
    input = { ...owner, requestId: randomUUID(), revision: digest("source"), fps: { num: 30, den: 1 } },
    projection = { digest: digest("projection"), bytes: 100 };
  let store = new Store(root);
  try {
    expect(store.lookup({ operation: "export_create", ...input })).toEqual({ job: null });
    expect(store.scan(["queued"])).toEqual([]);
    const created = store.create({ ...input, projection }),
      cancel = { ...owner, id: created.id, requestId: randomUUID(), expectedVersion: created.version },
      cancelled = store.control("export_cancel", cancel),
      retry = { ...cancel, requestId: randomUUID(), expectedVersion: cancelled.version },
      retried = store.control("export_retry", retry);
    store.close();
    store = new Store(root);
    for (const request of [
      { operation: "export_create" as const, ...input },
      { operation: "export_cancel" as const, ...cancel },
      { operation: "export_retry" as const, ...retry },
    ])
      expect(store.lookup(request)).toEqual({ job: retried });
    expect(store.create({ ...input, projection })).toEqual(created);
    expect(store.control("export_cancel", cancel)).toEqual(cancelled);
    expect(store.control("export_retry", retry)).toEqual(retried);
    expect(() => store.lookup({ operation: "export_create", ...input, fps: { num: 60, den: 1 } })).toThrow(
      "identity reused",
    );
    expect(() => store.lookup({ operation: "export_retry", ...cancel })).toThrow("identity reused");
    expect(() => store.lookup({ operation: "export_create", ...input, artifactId: randomUUID() })).toThrow(
      "does not belong",
    );
    expect(store.scan(["queued"])).toHaveLength(1);
    expect(store.read(created.id).job).toEqual(retried);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
