import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { initialFiles, Workspace } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { Previews } from "@/content/preview.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "motion-preview-stream-")),
    workspace = new Workspace(root),
    views = new Previews(workspace);
  const session = workspace.execute("session_create", { requestId: randomUUID(), title: "Preview", mode: "motion" }),
    artifact = workspace.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Stream",
      files: initialFiles(),
    }),
    owner = { sessionId: session.id, artifactId: artifact.id },
    before = workspace.execute("project_read", owner),
    bytes = Buffer.alloc(16 * 65536);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(192000, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let at = 44; at < bytes.length; at++) bytes[at] = at % 251;
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    project = workspace.importResource(
      {
        ...owner,
        requestId: randomUUID(),
        expectedRevision: before.revision,
        path: "assets/stream.wav",
        name: "Stream",
        digest,
        bytes: bytes.length,
      },
      bytes,
    );
  const open = () => views.open({ ...owner, id: randomUUID(), expectedRevision: project.revision });
  return {
    root,
    workspace,
    views,
    bytes,
    digest,
    open,
    finish() {
      views.close();
      workspace.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function parked() {
  const chunks: Buffer[] = [];
  let release: (() => void) | undefined;
  const output = Object.assign(
    new Writable({
      highWaterMark: 65536,
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        if (!release) release = done;
        else done();
      },
    }),
    { writeHead() {} },
  );
  return {
    output,
    chunks,
    resume() {
      const done = release;
      release = () => {};
      done?.();
    },
  };
}
function start(f: ReturnType<typeof fixture>, id: string, out: ReturnType<typeof parked>) {
  // Attach a rejection handler before any abort/corruption to preserve the actual stream outcome.
  return Promise.resolve(
    f.views.serve(`/preview/${id}/assets/stream.wav`, out.output as unknown as ServerResponse, "127.0.0.1:48000"),
  ).then(
    () => "complete",
    () => "aborted",
  );
}
it("applies backpressure without buffered resource reads and rejects changed future chunks before output", async () => {
  const f = fixture(),
    out = parked(),
    raw = new DatabaseSync(join(f.root, "workspace.sqlite"));
  let work: Promise<string> | undefined;
  try {
    const execute = f.workspace.execute.bind(f.workspace);
    vi.spyOn(f.workspace, "execute").mockImplementation((operation, input) => {
      if (operation === "resource_read") throw Error("buffered preview read");
      return execute(operation, input);
    });
    let emitted = 0;
    const read = f.workspace.readResource.bind(f.workspace);
    vi.spyOn(f.workspace, "readResource").mockImplementation((input) => {
      const reader = read(input);
      return {
        resource: reader.resource,
        *chunks(interval) {
          for (const chunk of reader.chunks(interval)) {
            emitted++;
            yield chunk;
          }
        },
      };
    });
    work = start(f, f.open().id, out);
    await expect.poll(() => out.chunks.length).toBe(1);
    await setImmediate();
    expect(emitted).toBeLessThanOrEqual(4);
    expect(out.chunks[0]).toEqual(f.bytes.subarray(0, 65536));
    const changed = Buffer.from(f.bytes.subarray(8 * 65536, 9 * 65536));
    changed[0] = changed[0]! ^ 1;
    raw.prepare("UPDATE resource_chunks SET bytes=? WHERE digest=? AND position=8").run(changed, f.digest);
    out.resume();
    expect(await work).toBe("aborted");
    expect(out.chunks.length).toBeLessThanOrEqual(8);
    expect(Buffer.concat(out.chunks)).toEqual(f.bytes.subarray(0, out.chunks.length * 65536));
  } finally {
    out.output.destroy();
    await work;
    raw.close();
    vi.restoreAllMocks();
    f.finish();
  }
});
it.each(["release", "disconnect", "shutdown"])(
  "drains a backpressured preview on %s without revoking unrelated views",
  async (action) => {
    const f = fixture(),
      first = parked(),
      second = parked(),
      a = f.open(),
      b = f.open();
    const one = start(f, a.id, first),
      two = start(f, b.id, second);
    try {
      await expect.poll(() => first.chunks.length + second.chunks.length).toBe(2);
      if (action === "release") f.views.release({ id: a.id });
      else if (action === "disconnect") first.output.destroy();
      else f.views.quiesce();
      expect(await one).toBe("aborted");
      if (action !== "shutdown") {
        expect(second.output.destroyed).toBe(false);
        second.resume();
        expect(await two).toBe("complete");
        expect(Buffer.concat(second.chunks)).toEqual(f.bytes);
      } else {
        expect(await two).toBe("aborted");
        expect(() => f.open()).toThrow("closing");
      }
      f.views.close();
    } finally {
      first.output.destroy();
      second.output.destroy();
      await Promise.all([one, two]);
      f.finish();
    }
  },
);
