import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { channel, digest, namespace } from "@odsuite/protocol";
import { managerEndpoint, observeProcesses, readDirectory, serve } from "@odsuite/sidecar";
import { readProjection } from "@open-motion/render";
import type { Job, RenderMethods } from "@open-motion/render/contract";
import { initialFiles } from "@open-motion/workspace";
import { expect, it } from "vitest";
import { serve as daemonServe } from "@/service.js";
import { Client } from "@/transport/client.js";

it("stages exact historical inputs through HTTP, reuses an existing inbox after restart and refuses changed files before delegation", async () => {
  // A capturing renderer proves adapter/projection transport, never native film execution.
  const evidence = fileURLToPath(new URL(`../../../../.artifacts/render-projection/${randomUUID()}/`, import.meta.url)),
    root = join(evidence, "sidecar"),
    calls: RenderMethods["export_create"]["input"][] = [],
    id = randomUUID(),
    attempt = randomUUID();
  let manager = await serve(managerEndpoint(root), { root }),
    rendererRoot = "",
    api: Client | undefined;
  const host = async () => {
    const factory = manager.factory({ channel: channel("dev"), namespace: namespace("projection") }),
      generation = digest("captured projection");
    await factory.expose<Pick<RenderMethods, "export_create">>({
      identity: { service: "renderer", generation },
      handlers: {
        export_create: async (input) => {
          const snapshot = await readProjection(
            join(rendererRoot, "inbox", `${input.projection.digest.slice(7)}.json`),
            input.projection,
          );
          expect(snapshot.project).toMatchObject({
            sessionId: input.sessionId,
            artifactId: input.artifactId,
            revision: input.revision,
          });
          let total = 0;
          for await (const chunk of snapshot.assets[0]!.chunks()) total += chunk.length;
          expect(total).toBe(1024 * 1024);
          calls.push(input);
          const value: Job = {
            id,
            attempt,
            sessionId: input.sessionId,
            artifactId: input.artifactId,
            revision: input.revision,
            fps: input.fps,
            state: "queued",
            version: 0,
            createdAt: 1,
            updatedAt: 1,
          };
          return { ok: true, value };
        },
      },
      lifecycle: {
        initialize: async (context) => {
          rendererRoot = context.roots.data;
        },
        stop: async () => {},
      },
    });
    const peer = await factory.connect({ service: "renderer", generation });
    let daemon: Awaited<ReturnType<typeof daemonServe>> | undefined;
    await factory.expose({
      identity: { service: "daemon", generation: digest("projection daemon") },
      handlers: {},
      lifecycle: {
        initialize: async (context) => {
          const socket = await context.allocate({ kind: "socket", name: "daemon" }),
            port = await context.allocate({ kind: "port", name: "daemon", scheme: "http" });
          daemon = await context.background(() =>
            daemonServe({
              data: context.roots.data,
              staging: context.roots.runtime,
              socket: socket.value,
              token: "projection-fixture",
              origin: "http://fixture.invalid",
              endpoint: port.value,
              renderer: { root: rendererRoot, connection: peer.connection() },
            }),
          );
          await context.forward(port.value, socket.value);
          api = new Client(port.value, "projection-fixture");
        },
        quiesce: async () => daemon?.quiesce(),
        stop: async () => daemon?.close(),
      },
    });
    if (!api) throw Error("missing API");
    return api;
  };
  let report: Record<string, unknown> = {};
  try {
    const client = await host(),
      session = await client.execute("session_create", {
        requestId: randomUUID(),
        mode: "motion",
        title: "Projection",
      }),
      artifact = await client.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Snapshot",
        files: initialFiles(),
      }),
      owner = { sessionId: session.id, artifactId: artifact.id },
      before = await client.execute("project_read", owner);
    const bytes = Buffer.alloc(1024 * 1024);
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
    const imported = await client.importResource(
      {
        ...owner,
        requestId: randomUUID(),
        expectedRevision: before.revision,
        path: "assets/tone.wav",
        name: "Frozen audio",
        digest: digest(bytes),
        bytes: bytes.length,
      },
      new Blob([Uint8Array.from(bytes)]),
    );
    const project = imported.project;
    if (!project) throw Error("missing imported audio");
    const input = { ...owner, requestId: randomUUID(), revision: project.revision, fps: { num: 30, den: 1 } };
    const original = await client.execute("export_create", input);
    expect(JSON.stringify(original)).not.toContain(root);
    expect(calls).toHaveLength(1);
    const inbox = join(rendererRoot, "inbox"),
      files = await readdir(inbox);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    const accepted = Buffer.from(await readFile(join(inbox, files[0]!)));
    expect(digest(accepted)).toBe(calls[0]!.projection.digest);
    const later = await client.execute("project_save", {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: project.revision,
      files: [...project.files, { path: "later.txt", content: "Preserve later edit" }],
    });
    expect(await client.execute("export_create", input)).toEqual(original);
    expect(calls[1]).toEqual(calls[0]);
    await manager.close();
    manager = await serve(managerEndpoint(root), { root });
    const cold = await host();
    expect(await cold.execute("export_create", input)).toEqual(original);
    expect(calls[2]).toEqual(calls[0]);
    expect(await cold.execute("project_read", owner)).toEqual(later);
    const path = join(rendererRoot, "inbox", files[0]!);
    await writeFile(path, "corrupt existing input");
    await expect(cold.execute("export_create", input)).rejects.toMatchObject({ code: "integrity" });
    expect(calls).toHaveLength(3);
    expect(await readdir(join(rendererRoot, "inbox"))).toEqual(files);
    report = {
      projection: calls[0]!.projection,
      identicalDelegations: calls.length,
      laterRevisionPreserved: true,
      coldExistingInbox: true,
      changedInputRefused: true,
      temporaryFiles: 0,
      nativeExecution: false,
    };
  } finally {
    await manager.close();
    report.phase = (await readDirectory(root)).manager.phase;
    report.processes = await observeProcesses(root);
    await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
  }
  expect(report.phase).toBe("closed");
  expect(report.processes).toEqual([]);
}, 15000);
