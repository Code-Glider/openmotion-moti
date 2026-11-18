import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { initialFiles, Workspace } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { Archives } from "@/content/archives.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "motion-archive-stream-")),
    workspace = new Workspace(root),
    archives = new Archives(workspace, "http://127.0.0.1:48000");
  const session = workspace.execute("session_create", { requestId: randomUUID(), title: "ZIP", mode: "motion" }),
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
  let produced = 0;
  const read = workspace.readResource.bind(workspace),
    spy = vi.spyOn(workspace, "readResource").mockImplementation((input) => {
      const reader = read(input);
      return {
        resource: reader.resource,
        *chunks(interval) {
          for (const chunk of reader.chunks(interval)) {
            produced++;
            yield chunk;
          }
        },
      };
    });
  const execute = workspace.execute.bind(workspace),
    buffered = vi.spyOn(workspace, "execute").mockImplementation((operation, input) => {
      if (operation === "resource_read") throw Error("buffered archive read");
      return execute(operation, input);
    });
  return {
    root,
    workspace,
    archives,
    bytes,
    digest,
    owner,
    project,
    produced: () => produced,
    reset() {
      produced = 0;
    },
    ticket: () => archives.execute("archive_export", { ...owner, requestId: randomUUID(), revision: project.revision }),
    finish() {
      spy.mockRestore();
      buffered.mockRestore();
      archives.close();
      workspace.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function output() {
  let resume: (() => void) | undefined;
  const chunks: Buffer[] = [],
    response = Object.assign(
      new Writable({
        highWaterMark: 65536,
        write(chunk, _encoding, done) {
          chunks.push(Buffer.from(chunk));
          if (!resume) resume = done;
          else done();
        },
      }),
      { writeHead() {} },
    );
  return {
    response,
    chunks,
    resume() {
      const done = resume;
      resume = () => {};
      done?.();
    },
  };
}
function transfer(f: ReturnType<typeof fixture>, url: string, out: ReturnType<typeof output>) {
  const request = Object.assign(new Readable({ read() {} }), {
    url: new URL(url).pathname,
    method: "GET",
    headers: {},
  });
  request.on("error", () => {});
  return f.archives.transfer(request as unknown as IncomingMessage, out.response as unknown as ServerResponse).then(
    () => "complete",
    () => "aborted",
  );
}
it("streams retained history without buffered reads, applies backpressure and refuses later corruption before media output", async () => {
  const f = fixture(),
    out = output(),
    raw = new DatabaseSync(join(f.root, "workspace.sqlite"));
  let work: Promise<string> | undefined;
  try {
    const ticket = f.ticket();
    f.workspace.execute("resource_remove", {
      ...f.owner,
      requestId: randomUUID(),
      expectedRevision: f.project.revision,
      path: "assets/stream.wav",
    });
    f.reset();
    work = transfer(f, ticket.url, out);
    await expect.poll(() => out.chunks.length).toBe(1);
    await setImmediate();
    expect(f.produced()).toBeLessThanOrEqual(4);
    const changed = Buffer.from(f.bytes.subarray(8 * 65536, 9 * 65536));
    changed[0] = 1;
    raw.prepare("UPDATE resource_chunks SET bytes=? WHERE digest=? AND position=8").run(changed, f.digest);
    out.resume();
    expect(await work).toBe("aborted");
    expect(f.produced()).toBeLessThanOrEqual(8);
    expect(() => f.ticket()).toThrow("corrupt");
  } finally {
    out.response.destroy();
    await work;
    raw.close();
    f.finish();
  }
});
it.each(["disconnect", "shutdown"])("retains a released download slot until %s drains it", async (action) => {
  const f = fixture(),
    out = output();
  let work: Promise<string> | undefined;
  try {
    const ticket = f.ticket(),
      second = f.ticket();
    f.reset();
    work = transfer(f, ticket.url, out);
    await expect.poll(() => out.chunks.length).toBe(1);
    f.archives.execute("archive_release", { id: ticket.id });
    expect(() => f.ticket()).toThrow("capacity");
    if (action === "disconnect") out.response.destroy();
    else f.archives.quiesce();
    expect(await work).toBe("aborted");
    if (action === "disconnect") {
      f.archives.execute("archive_release", { id: second.id });
      expect(f.ticket().digest).toBe(ticket.digest);
    } else expect(() => f.ticket()).toThrow("closing");
  } finally {
    out.response.destroy();
    await work;
    f.finish();
  }
});
