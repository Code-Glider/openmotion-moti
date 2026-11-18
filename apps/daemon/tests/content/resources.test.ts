import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readdir, writeFile } from "node:fs/promises";
import { type IncomingMessage, request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { channel, digest, namespace } from "@odsuite/protocol";
import { managerEndpoint, observeProcesses, readDirectory, serve } from "@odsuite/sidecar";
import { initialFiles, resourceLimit } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { serve as daemonServe } from "@/service.js";
import { Client } from "@/transport/client.js";

const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function wave() {
  const b = Buffer.alloc(resourceLimit);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(192000, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
async function fixture() {
  const evidence = fileURLToPath(new URL(`../../../../.artifacts/resource-transfer/${randomUUID()}/`, import.meta.url)),
    root = join(evidence, "sidecar"),
    token = "resource-fixture-authority";
  let manager = await serve(managerEndpoint(root), { root });
  const host = async () => {
    let daemon: Awaited<ReturnType<typeof daemonServe>> | undefined,
      api: Client | undefined,
      endpoint = "",
      stagingRoot = "";
    await manager.factory({ channel: channel("dev"), namespace: namespace("resources") }).expose({
      identity: { service: "daemon", generation: digest("resource-transfer") },
      handlers: {},
      lifecycle: {
        initialize: async (context) => {
          const socket = await context.allocate({ kind: "socket", name: "daemon" }),
            port = await context.allocate({ kind: "port", name: "daemon", scheme: "http" });
          endpoint = port.value;
          stagingRoot = context.roots.runtime;
          daemon = await daemonServe({
            data: context.roots.data,
            staging: context.roots.runtime,
            socket: socket.value,
            token,
            origin: "http://fixture.invalid",
            endpoint,
          });
          await context.forward(port.value, socket.value);
          api = new Client(endpoint, token);
        },
        quiesce: async () => daemon?.quiesce(),
        stop: async () => daemon?.close(),
      },
    });
    if (!api) throw Error("missing fixture");
    return { api: api as Client, endpoint, staging: stagingRoot, closeDaemon: () => daemon!.close() };
  };
  return {
    root,
    evidence,
    token,
    host,
    close: () => manager.close(),
    restart: async () => {
      await manager.close();
      manager = await serve(managerEndpoint(root), { root });
    },
  };
}

it("imports 16 MiB through raw bytes and confirms original receipts before restaging, later edits or cold restart", async () => {
  const f = await fixture();
  const report: Record<string, unknown> = {};
  try {
    const { api, endpoint, staging } = await f.host(),
      session = await api.execute("session_create", {
        requestId: randomUUID(),
        title: "Raw resources",
        mode: "motion",
      }),
      artifact = await api.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Large media",
        files: initialFiles(),
      }),
      owner = { sessionId: session.id, artifactId: artifact.id },
      before = await api.execute("project_read", owner),
      bytes = wave(),
      file = new Blob([Uint8Array.from(bytes)]),
      input = {
        ...owner,
        requestId: randomUUID(),
        expectedRevision: before.revision,
        path: "assets/maximum.wav",
        name: "Maximum WAV",
        digest: hash(bytes),
        bytes: bytes.length,
      };
    let lose = true,
      uploads = 0;
    const controls: string[] = [];
    const lossy = new Client(endpoint, f.token, async (url, init) => {
      if (String(url).includes("/resources/upload/")) {
        uploads++;
        if (!(init?.body instanceof Blob)) throw Error("expected a binary upload body");
        expect(init.body.size).toBe(resourceLimit);
      }
      if (String(url).endsWith("/api/resource_import")) controls.push(String(init?.body));
      const response = await fetch(url, init);
      if (String(url).endsWith("/api/resource_import") && JSON.parse(String(init?.body)).uploadId && lose) {
        lose = false;
        expect(response.status).toBe(200);
        await response.arrayBuffer();
        throw Error("response lost after resource commit");
      }
      return response;
    });
    await expect(lossy.importResource(input, file)).rejects.toThrow("response lost");
    const committed = await api.execute("project_read", owner);
    expect(committed.history.version).toBe(1);
    expect(await readdir(staging)).toEqual([]);
    expect(committed.resources[0]).toMatchObject({ bytes: resourceLimit, digest: input.digest, type: "audio/wav" });
    expect(await lossy.importResource(input, new Blob(["receipt must precede bytes"]))).toEqual({ project: committed });
    expect(uploads).toBe(1);
    expect(controls).toHaveLength(3);
    expect(controls.every((value) => value.length < 1024 && !value.includes('"data"'))).toBe(true);
    const saved = await api.execute("project_save", {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: committed.revision,
      files: [{ path: "index.html", content: committed.files[0]!.content + "\n<!-- retained later edit -->" }],
    });
    expect(await api.execute("resource_import", input)).toEqual({ project: committed });
    expect(await api.execute("project_read", owner)).toEqual(saved);
    const read = await api.readResource({ ...owner, revision: committed.revision, path: input.path });
    expect(hash(Buffer.from(await read.data.arrayBuffer()))).toBe(input.digest);
    const readOnly = await api.execute("resource_read", { ...owner, revision: committed.revision, path: input.path });
    await expect(
      api.execute("resource_import", {
        ...input,
        requestId: randomUUID(),
        expectedRevision: saved.revision,
        path: "assets/copy.wav",
        uploadId: readOnly.id,
      }),
    ).rejects.toMatchObject({ code: "missing" });
    await api.execute("resource_release", { id: readOnly.id });
    const preview = await api.preview(saved),
      asset = new URL(input.path, preview.url).href,
      range = await fetch(asset, { headers: { range: "bytes=0-43" } });
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(0, 44));
    for (const [requested, start, end] of [
      ["bytes=65530-65542", 65530, 65542],
      ["bytes=-17", bytes.length - 17, bytes.length - 1],
    ] as const) {
      const part = await fetch(asset, { headers: { range: requested } });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe(`bytes ${start}-${end}/${bytes.length}`);
      expect(Buffer.from(await part.arrayBuffer())).toEqual(bytes.subarray(start, end + 1));
    }
    const metadata = await fetch(asset, { method: "HEAD", headers: { range: "bytes=0-43" } });
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get("content-length")).toBe(String(bytes.length));
    expect(await metadata.arrayBuffer()).toHaveProperty("byteLength", 0);
    expect(hash(Buffer.from(await (await fetch(asset)).arrayBuffer()))).toBe(input.digest);
    await api.closePreviews();
    await expect(api.execute("resource_import", { ...input, digest: digest("different") })).rejects.toMatchObject({
      code: "idempotency",
    });
    await expect(api.execute("resource_import", { ...input, data: "obsolete" } as never)).rejects.toMatchObject({
      code: "invalid",
    });
    await f.restart();
    const cold = await f.host();
    expect(await cold.api.execute("resource_import", { ...input, uploadId: randomUUID() })).toEqual({
      project: committed,
    });
    expect(await cold.api.execute("project_read", owner)).toEqual(saved);
    expect(
      hash(
        new Uint8Array(
          await (
            await cold.api.readResource({ ...owner, revision: committed.revision, path: input.path })
          ).data.arrayBuffer(),
        ),
      ) === input.digest,
    ).toBe(true);
    Object.assign(report, {
      bytes: bytes.length,
      digest: input.digest,
      rawUploads: uploads,
      controlBytes: controls.map((value) => value.length),
      sameRequest: controls.every((value) => JSON.parse(value).requestId === input.requestId),
      coldRestart: true,
      preview: { fullDigest: input.digest, range: true, crossChunkRange: true, suffix: true, head: true },
      history: saved.history,
    });
  } finally {
    await f.close();
    report.phase = (await readDirectory(f.root)).manager.phase;
    report.processes = await observeProcesses(f.root);
    await writeFile(join(f.evidence, "report.json"), JSON.stringify(report, null, 2));
  }
  expect(report.phase).toBe("closed");
  expect(report.processes).toEqual([]);
}, 60000);

it("bounds upload capacity and size, rejects bad digests/formats atomically and drains a partial upload on shutdown", async () => {
  const f = await fixture();
  try {
    const { api, staging, closeDaemon } = await f.host(),
      bytes = Buffer.from("test"),
      intent = { digest: hash(bytes), bytes: bytes.length },
      first = await api.execute("resource_upload", { requestId: randomUUID(), ...intent }),
      second = await api.execute("resource_upload", { requestId: randomUUID(), ...intent });
    await expect(api.execute("resource_upload", { requestId: randomUUID(), ...intent })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      api.execute("resource_upload", { requestId: randomUUID(), digest: intent.digest, bytes: resourceLimit + 1 }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(api.uploadResource(first, new Blob(["best"]))).rejects.toMatchObject({ code: "invalid" });
    expect(await readdir(staging)).toEqual([]);
    await api.uploadResource(first, new Blob([bytes]));
    expect(await readdir(staging)).toHaveLength(1);
    const session = await api.execute("session_create", { requestId: randomUUID(), title: "Invalid", mode: "motion" }),
      artifact = await api.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Project",
        files: initialFiles(),
      }),
      owner = { sessionId: session.id, artifactId: artifact.id },
      before = await api.execute("project_read", owner),
      input = {
        ...owner,
        requestId: randomUUID(),
        expectedRevision: before.revision,
        path: "assets/bad.wav",
        name: "Invalid",
        ...intent,
      };
    await expect(api.execute("resource_import", { ...input, uploadId: first.id })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(await api.execute("resource_import", input)).toEqual({ project: null });
    expect(await api.execute("project_read", owner)).toEqual(before);
    await api.execute("resource_release", { id: first.id });
    expect(await readdir(staging)).toEqual([]);
    expect(
      (await fetch(first.url, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes }))
        .status,
    ).toBe(404);
    const partial = await api.execute("resource_upload", { requestId: randomUUID(), ...intent }),
      req = request(partial.url, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "content-length": bytes.length, expect: "100-continue" },
      });
    req.on("error", () => {});
    req.flushHeaders();
    await once(req, "continue");
    req.write(bytes.subarray(0, 1));
    await api.execute("resource_release", { id: partial.id });
    await expect(api.execute("resource_upload", { requestId: randomUUID(), ...intent })).rejects.toMatchObject({
      code: "conflict",
    });
    const closed = new Promise<void>((done) => req.once("close", done));
    await closeDaemon();
    expect(await readdir(staging)).toEqual([]);
    await f.close();
    await closed;
    await expect(api.uploadResource(second, new Blob([bytes]))).rejects.toThrow();
  } finally {
    await f.close();
  }
  expect((await readDirectory(f.root)).manager.phase).toBe("closed");
  expect(await observeProcesses(f.root)).toEqual([]);
}, 30000);

it("retains a released slow download slot until abort, then drains another active reader before shutdown", async () => {
  const f = await fixture();
  const paused: IncomingMessage[] = [];
  try {
    const { api } = await f.host(),
      session = await api.execute("session_create", { requestId: randomUUID(), title: "Readers", mode: "motion" }),
      artifact = await api.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Slow download",
        files: initialFiles(),
      }),
      owner = { sessionId: session.id, artifactId: artifact.id },
      before = await api.execute("project_read", owner),
      bytes = wave(),
      project = (
        await api.importResource(
          {
            ...owner,
            requestId: randomUUID(),
            expectedRevision: before.revision,
            path: "assets/slow.wav",
            name: "Slow WAV",
            digest: hash(bytes),
            bytes: bytes.length,
          },
          new Blob([Uint8Array.from(bytes)]),
        )
      ).project;
    if (!project) throw Error("missing imported resource");
    const input = { ...owner, revision: project.revision, path: "assets/slow.wav" },
      first = await api.execute("resource_read", input),
      second = await api.execute("resource_read", input),
      head = await fetch(first.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(resourceLimit));
    const pause = async (url: string) => {
      const req = request(url);
      req.on("error", () => {});
      req.end();
      const [response] = (await once(req, "response")) as [IncomingMessage];
      response.on("error", () => {});
      const firstChunk = await new Promise<Buffer>((done) =>
        response.once("data", (data: Buffer) => {
          response.pause();
          done(data);
        }),
      );
      expect(firstChunk).toEqual(bytes.subarray(0, firstChunk.length));
      paused.push(response);
      return response;
    };
    const active = await pause(first.url);
    await api.execute("resource_release", { id: first.id });
    await expect(api.execute("resource_read", input)).rejects.toMatchObject({ code: "conflict" });
    const closed = new Promise<void>((done) => active.once("close", done));
    active.destroy();
    await closed;
    // Only conflict is retryable: a reclaimed slot succeeds once, without changing source data.
    let replacement: typeof first | undefined;
    await expect
      .poll(
        async () => {
          try {
            replacement = await api.execute("resource_read", input);
            return true;
          } catch (error) {
            if ((error as { code?: string }).code !== "conflict") throw error;
            return false;
          }
        },
        { timeout: 5000 },
      )
      .toBe(true);
    if (!replacement) throw Error("missing replacement ticket");
    expect((await fetch(first.url)).status).toBe(404);
    await api.execute("resource_release", { id: second.id });
    const draining = await pause(replacement.url),
      drained = new Promise<void>((done) => draining.once("close", done));
    await f.close();
    draining.destroy();
    await drained;
  } finally {
    for (const response of paused) response.destroy();
    await f.close();
  }
  expect((await readDirectory(f.root)).manager.phase).toBe("closed");
  expect(await observeProcesses(f.root)).toEqual([]);
}, 30000);

it("revokes a slow preview response and drains another media reader during actual daemon shutdown", async () => {
  const f = await fixture(),
    paused: IncomingMessage[] = [];
  try {
    const { api } = await f.host(),
      session = await api.execute("session_create", {
        requestId: randomUUID(),
        title: "Preview streams",
        mode: "motion",
      }),
      artifact = await api.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Media",
        files: initialFiles(),
      }),
      owner = { sessionId: session.id, artifactId: artifact.id },
      before = await api.execute("project_read", owner),
      bytes = wave(),
      result = await api.importResource(
        {
          ...owner,
          requestId: randomUUID(),
          expectedRevision: before.revision,
          path: "assets/slow.wav",
          name: "Slow",
          digest: hash(bytes),
          bytes: bytes.length,
        },
        new Blob([Uint8Array.from(bytes)]),
      );
    if (!result.project) throw Error("missing imported resource");
    const first = await api.preview(result.project, "first"),
      second = await api.preview(result.project, "second");
    const pause = async (url: string) => {
      const req = request(url);
      req.on("error", () => {});
      req.end();
      const [response] = (await once(req, "response")) as [IncomingMessage];
      response.on("error", () => {});
      expect(response.statusCode).toBe(200);
      const initial = await new Promise<Buffer>((done) =>
        response.once("data", (chunk) => {
          response.pause();
          done(chunk);
        }),
      );
      expect(initial).toEqual(bytes.subarray(0, initial.length));
      paused.push(response);
      return response;
    };
    const active = await pause(new URL("assets/slow.wav", first.url).href);
    const retired = new Promise<void>((done) => active.once("close", done));
    await api.closePreview(first.id);
    // Resume the client only to observe EOF/reset; the server must not finish the full representation.
    let received = active.readableLength;
    active.on("data", (chunk) => {
      received += chunk.length;
    });
    active.resume();
    await retired;
    expect(active.complete).toBe(false);
    expect(received).toBeLessThan(bytes.length);
    expect((await fetch(new URL("assets/slow.wav", first.url))).status).toBe(404);
    const surviving = await fetch(new URL("assets/slow.wav", second.url), { headers: { range: "bytes=65530-65542" } });
    expect(surviving.status).toBe(206);
    expect(Buffer.from(await surviving.arrayBuffer())).toEqual(bytes.subarray(65530, 65543));
    const draining = await pause(new URL("assets/slow.wav", second.url).href);
    const closed = new Promise<void>((done) => draining.once("close", done));
    await f.close();
    draining.resume();
    await closed;
    expect(draining.complete).toBe(false);
  } finally {
    for (const response of paused) response.destroy();
    await f.close();
  }
  expect((await readDirectory(f.root)).manager.phase).toBe("closed");
  expect(await observeProcesses(f.root)).toEqual([]);
}, 30000);

it("removes expired idle staging and drains ready staging before the attempt grant retires", async () => {
  const f = await fixture();
  try {
    const { api, staging, closeDaemon } = await f.host(),
      bytes = Buffer.from("idle staging"),
      intent = { bytes: bytes.length, digest: hash(bytes) },
      first = await api.execute("resource_upload", { requestId: randomUUID(), ...intent });
    await api.uploadResource(first, new Blob([bytes]));
    expect(await readdir(staging)).toHaveLength(1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600001);
    try {
      await expect(api.uploadResource(first, new Blob([bytes]))).rejects.toMatchObject({ code: "missing" });
      expect(await readdir(staging)).toEqual([]);
      const next = await api.execute("resource_upload", { requestId: randomUUID(), ...intent });
      await api.uploadResource(next, new Blob([bytes]));
      expect(await readdir(staging)).toHaveLength(1);
      await closeDaemon();
      expect(await readdir(staging)).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  } finally {
    await f.close();
  }
  expect((await readDirectory(f.root)).manager.phase).toBe("closed");
  expect(await observeProcesses(f.root)).toEqual([]);
}, 15000);
