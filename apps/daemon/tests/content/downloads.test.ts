import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channel, digest, namespace } from "@odsuite/protocol";
import { managerEndpoint, observeProcesses, serve } from "@odsuite/sidecar";
import type { Job, RenderMethods } from "@open-motion/render/contract";
import { initialFiles } from "@open-motion/workspace";
import { expect, it, vi } from "vitest";
import { serve as daemonServe } from "@/service.js";
import { Client } from "@/transport/client.js";

vi.mock("node:crypto", async (load) => {
  const actual = await load<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});

it("reads fixed film ranges after later edits, renews links and never submits or retries an export", async () => {
  // Synthetic bytes qualify binary transport only, never native encoding or player playback.
  const root = await mkdtemp(join(tmpdir(), "film-download-")),
    manager = await serve(managerEndpoint(root), { root }),
    factory = manager.factory({ channel: channel("dev"), namespace: namespace("film") }),
    jobs = new Map<string, Job>(),
    reads: string[] = [];
  let rendererRoot = "",
    endpoint = "",
    api!: Client,
    daemon: Awaited<ReturnType<typeof daemonServe>> | undefined;
  try {
    const generation = digest("read-only film fixture");
    await factory.expose<Pick<RenderMethods, "export_read">>({
      identity: { service: "renderer", generation },
      handlers: {
        export_read: async (input) => {
          reads.push(input.id);
          const job = jobs.get(input.id);
          return job && job.sessionId === input.sessionId && job.artifactId === input.artifactId
            ? { ok: true, value: job }
            : { ok: false, error: { code: "ownership", message: "export owner mismatch" } };
        },
      },
      lifecycle: {
        initialize: async (context) => {
          rendererRoot = context.roots.data;
          await mkdir(join(rendererRoot, "exports"));
        },
        stop: async () => {},
      },
    });
    const peer = await factory.connect({ service: "renderer", generation });
    await factory.expose({
      identity: { service: "daemon", generation: digest("film daemon") },
      handlers: {},
      lifecycle: {
        initialize: async (context) => {
          const socket = await context.allocate({ kind: "socket", name: "daemon" }),
            port = await context.allocate({ kind: "port", name: "daemon", scheme: "http" });
          endpoint = port.value;
          daemon = await context.background(() =>
            daemonServe({
              data: context.roots.data,
              origin: "http://fixture.invalid",
              socket: socket.value,
              token: "film-fixture",
              endpoint,
              renderer: { root: rendererRoot, connection: peer.connection() },
            }),
          );
          await context.forward(port.value, socket.value);
          api = new Client(endpoint, "film-fixture");
        },
        quiesce: async () => daemon?.quiesce(),
        stop: async () => daemon?.close(),
      },
    });
    const session = await api.execute("session_create", { requestId: randomUUID(), title: "Film", mode: "motion" }),
      artifact = await api.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Two rounds",
        files: initialFiles(),
      }),
      owner = { sessionId: session.id, artifactId: artifact.id };
    const round = async (bytes: Buffer) => {
      const project = await api.execute("project_read", owner),
        id = randomUUID(),
        filmId = randomUUID(),
        spec = { width: 160, height: 90, fps: { num: 12, den: 1 }, duration: 1, frames: 12, audio: "silent" as const },
        job: Job = {
          ...owner,
          id,
          revision: project.revision,
          fps: spec.fps,
          version: 1,
          attempt: randomUUID(),
          state: "succeeded",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          result: {
            ...owner,
            id: filmId,
            revision: project.revision,
            spec,
            toolchain: { fixture: "synthetic" },
            verification: {
              digest: digest(bytes),
              bytes: bytes.length,
              frames: 12,
              duration: 1,
              audio: false,
              seek: [0, 0.5, 0.9],
            },
          },
        };
      jobs.set(id, job);
      await writeFile(join(rendererRoot, "exports", `${filmId}.mp4`), bytes);
      return { job, ticket: await api.execute("export_download", { ...owner, id }) };
    };
    const bytes = Buffer.from("first immutable film transport fixture"),
      first = await round(bytes),
      etag = `"${digest(bytes)}"`;
    expect(first.ticket.film).toEqual({ ...first.job.result, jobId: first.job.id, attempt: first.job.attempt });
    expect(JSON.stringify(first.ticket)).not.toContain(rendererRoot);
    const head = await fetch(first.ticket.playbackUrl, { method: "HEAD", headers: { range: "bytes=0-3" } });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(bytes.length));
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(head.headers.get("content-disposition")).toContain("inline;");
    expect(head.headers.get("etag")).toBe(etag);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const attachment = await fetch(first.ticket.url, { method: "HEAD" });
    expect(attachment.headers.get("content-disposition")).toContain("attachment;");
    expect(attachment.headers.get("etag")).toBe(etag);
    const verifiedHashCount = vi.mocked(createHash).mock.calls.length;
    for (const [range, start, end] of [
      ["bytes=0-3", 0, 4],
      ["bytes=4-", 4, bytes.length],
      ["bytes=-5", bytes.length - 5, bytes.length],
      ["bytes=1-999999", 1, bytes.length],
      ["bytes=-999999", 0, bytes.length],
    ] as const) {
      const response = await fetch(first.ticket.url, { headers: { range, "if-range": etag } });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end - 1}/${bytes.length}`);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(start, end));
    }
    expect(vi.mocked(createHash).mock.calls.length).toBe(verifiedHashCount);
    for (const range of [
      "bytes=",
      "bytes=-0",
      "bytes=9-2",
      "bytes=999-",
      "bytes=0-1,3-4",
      "items=0-1",
      "bytes=9007199254740992-",
    ]) {
      const response = await fetch(first.ticket.url, { headers: { range } });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
      expect((await response.arrayBuffer()).byteLength).toBe(0);
    }
    const mismatched = await fetch(first.ticket.url, { headers: { range: "bytes=0-1", "if-range": '"another-film"' } });
    expect(mismatched.status).toBe(200);
    expect(Buffer.from(await mismatched.arrayBuffer())).toEqual(bytes);
    const before = await api.execute("project_read", owner);
    await api.execute("project_save", {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: before.revision,
      files: before.files.map((file) => ({ ...file, content: `${file.content}\n<!-- second round -->` })),
    });
    const second = await round(Buffer.from("second immutable film"));
    expect(second.ticket.film.revision).not.toBe(first.ticket.film.revision);
    expect(Buffer.from(await (await fetch(first.ticket.url)).arrayBuffer())).toEqual(bytes);
    expect(Buffer.from(await (await fetch(first.ticket.url)).arrayBuffer())).toEqual(bytes);
    const renewed = await api.execute("export_download", { ...owner, id: first.job.id });
    expect(renewed.url).not.toBe(first.ticket.url);
    expect(renewed.film).toEqual(first.ticket.film);
    expect(reads).toEqual([first.job.id, second.job.id, first.job.id]);
    expect(jobs.size).toBe(2);
    const beforeWarmRead = vi.mocked(createHash).mock.calls.length;
    expect((await fetch(renewed.url, { method: "HEAD" })).status).toBe(200);
    expect(vi.mocked(createHash).mock.calls.length).toBe(beforeWarmRead + 1);
    // Corrupt an already verified ticket: same-size writes must invalidate its memo before any range bytes.
    const beforeCorruption = vi.mocked(createHash).mock.calls.length;
    await writeFile(join(rendererRoot, "exports", `${first.ticket.film.id}.mp4`), Buffer.alloc(bytes.length));
    const corrupt = await fetch(renewed.url, { headers: { range: "bytes=0-1" } });
    expect(corrupt.status).not.toBe(206);
    expect(await corrupt.text()).not.toContain(rendererRoot);
    expect(vi.mocked(createHash).mock.calls.length).toBe(beforeCorruption + 1);
    await writeFile(join(rendererRoot, "exports", `${first.ticket.film.id}.mp4`), bytes);
    const recovered = await fetch(renewed.url, { headers: { range: "bytes=0-1" } });
    expect(recovered.status).toBe(206);
    expect(Buffer.from(await recovered.arrayBuffer())).toEqual(bytes.subarray(0, 2));
    expect(vi.mocked(createHash).mock.calls.length).toBe(beforeCorruption + 2);
    expect(reads).toHaveLength(3);
    await manager.close();
    expect(await observeProcesses(root)).toEqual([]);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
