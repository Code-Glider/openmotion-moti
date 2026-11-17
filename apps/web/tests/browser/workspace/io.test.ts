// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@odsuite/automation";
import { channel, digest, namespace } from "@odsuite/protocol";
import { source } from "@odsuite/serve";
import { managerEndpoint, observeProcesses, readDirectory, serve } from "@odsuite/sidecar";
import { Client } from "@open-motion/daemon/client";
import { entryFragment } from "@open-motion/daemon/contract";
import type { Tools } from "@open-motion/render";
import { host } from "@open-motion/render/host";
import { expect, it } from "vitest";
import type { Config } from "@";

it("recovers explicit I/O after reload without resubmitting on lookup, rewinding content or uploading confirmed bytes", async () => {
  const evidence = fileURLToPath(new URL(`../../../../../.artifacts/io-browser/${randomUUID()}/`, import.meta.url)),
    root = join(evidence, "sidecar"),
    report: Record<string, unknown> = {};
  await mkdir(evidence, { recursive: true });
  const manager = await serve(managerEndpoint(root), { root }),
    factory = manager.factory({ channel: channel("dev"), namespace: namespace("io-recovery") });
  let driver: Awaited<ReturnType<typeof browser>> | undefined,
    daemon: Awaited<ReturnType<typeof factory.start>> | undefined,
    config: Config | undefined;
  // Real renderer/journal, deliberately unavailable tools. This tests recovery, not native film execution.
  const tool = (name: string): Tools["browser"] => ({
    resource: { type: "directory", artifact: { kind: "blob", slot: name, digest: digest(name), bytes: name.length } },
    executable: "unavailable",
    load: async () => {
      throw Error("fixture tool is deliberately unavailable");
    },
  });
  try {
    const renderer = await host(factory, {
      generation: digest("io renderer"),
      tools: {
        browser: tool("browser"),
        ffmpeg: tool("ffmpeg"),
        ffprobe: tool("ffprobe"),
      },
    });
    const web = await source(factory, {
      name: "web",
      directory: fileURLToPath(new URL("../../../dist/", import.meta.url)),
      documents: {
        "/bootstrap.json": () => {
          if (!config) throw Error("fixture not ready");
          return { type: "application/json", body: JSON.stringify(config) };
        },
      },
    });
    await factory.expose({
      identity: { service: "browserhost", generation: digest("io daemon host") },
      handlers: {},
      lifecycle: {
        initialize: async (context) => {
          const socket = await context.allocate({ kind: "socket", name: "daemon" }),
            port = await context.allocate({ kind: "port", name: "daemon", scheme: "http" });
          daemon = await factory.start({
            service: "daemon",
            generation: digest("io daemon"),
            command: process.execPath,
            args: [fileURLToPath(new URL("../../../../daemon/dist/main.mjs", import.meta.url))],
            ready: "ready",
            env: {
              HYPERFRAMES_NO_TELEMETRY: "1",
              ODSUITE_RUNTIME_DATA: context.roots.data,
              ODSUITE_RUNTIME_ORIGIN: web.endpoint.url,
              ODSUITE_RUNTIME_SOCKET: socket.value,
              ODSUITE_RUNTIME_ENDPOINT: port.value,
              ODSUITE_RUNTIME_TOKEN: "io-browser-fixture",
              ODSUITE_RUNTIME_RENDERER: JSON.stringify({ root: renderer.root, connection: renderer.connection }),
            },
          });
          await context.forward(port.value, socket.value);
          config = {
            daemon: port.value,
            token: "io-browser-fixture",
            environment: {
              schema: 1,
              carrier: "browser-fixture",
              system: { platform: process.platform, arch: process.arch, release: "test" },
              runtime: { name: "node", version: process.versions.node },
            },
          };
        },
        stop: async () => {
          if (daemon) {
            const result = await factory.release(daemon);
            expect(result.status).toBe("stopped");
            expect(result.survivors).toEqual([]);
          }
        },
      },
    });
    if (!config) throw Error("missing bootstrap");
    const client = new Client(config.daemon, config.token),
      session = await client.execute("session_create", {
        requestId: randomUUID(),
        title: "I/O recovery",
        mode: "motion",
      }),
      template = (await client.execute("template_list", {})).templates.find((template) => template.id === "nyt-graph");
    if (!template) throw Error("missing template");
    const artifact = await client.execute("template_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        id: template.id,
        contentHash: template.contentHash,
        title: "Recovery project",
      }),
      owner = { sessionId: session.id, artifactId: artifact.id },
      project = await client.execute("project_read", owner),
      entry = await client.execute("project_entry", {
        ...owner,
        expectedRevision: project.revision,
        expectedHistory: project.history.version,
      });
    driver = await browser({ evidence, viewport: { width: 1600, height: 1000 } });
    const page = driver.page;
    page.setDefaultTimeout(8000);
    const ready = () =>
      page
        .locator("[aria-live]")
        .filter({ hasText: /^就绪$/ })
        .waitFor();
    const sourceMode = async () => {
      const button = page.getByRole("button", { name: "源码", exact: true });
      if ((await button.getAttribute("aria-pressed")) !== "true") {
        await button.click();
        await ready();
      }
    };
    const recovery = page.getByLabel("待确认的手动操作", { exact: true });
    await page.goto(new URL(entryFragment(entry), web.endpoint.url).href);
    await ready();
    const exports: unknown[] = [];
    let lost = false;
    await page.route("**/api/export_create", async (route) => {
      exports.push(route.request().postDataJSON());
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .locator("summary")
      .filter({ hasText: /^影片导出$/ })
      .click();
    await page.getByRole("button", { name: "导出 MP4（30fps）", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled()).toBe(true);
    const accepted = (await client.execute("export_list", owner)).jobs[0];
    if (!accepted) throw Error("missing durable export");
    await page.reload();
    await ready();
    await sourceMode();
    const sourceInput = page.getByRole("textbox", { name: "index.html", exact: true }),
      draft = `${await sourceInput.inputValue()}\n<!-- unsaved after reload -->`;
    await sourceInput.fill(draft);
    await recovery.getByRole("button", { name: "检查原操作", exact: true }).click();
    await ready();
    expect(exports).toHaveLength(1);
    expect(await sourceInput.inputValue()).toBe(draft);
    expect((await client.execute("export_list", owner)).jobs).toHaveLength(1);
    expect((await client.execute("export_read", { ...owner, id: accepted.id })).attempt).toBe(accepted.attempt);
    await page.unroute("**/api/export_create");
    await page.getByRole("button", { name: "放弃本地修改并刷新", exact: true }).click();
    await ready();
    const unaccepted: unknown[] = [];
    let blockedSubmit = true;
    await page.route("**/api/export_create", async (route) => {
      unaccepted.push(route.request().postDataJSON());
      if (blockedSubmit) await route.abort("failed");
      else await route.continue();
    });
    await page
      .locator("summary")
      .filter({ hasText: /^影片导出$/ })
      .click();
    await page.getByRole("button", { name: "导出 MP4（30fps）", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled()).toBe(true);
    await page.reload();
    await ready();
    await recovery.getByRole("button", { name: "检查原操作", exact: true }).click();
    await ready();
    expect(unaccepted).toHaveLength(1);
    expect((await client.execute("export_list", owner)).jobs).toHaveLength(1);
    await sourceMode();
    await sourceInput.fill(draft);
    blockedSubmit = false;
    await recovery.getByRole("button", { name: "继续原操作", exact: true }).click();
    await ready();
    expect(unaccepted).toHaveLength(2);
    expect(unaccepted[1]).toEqual(unaccepted[0]);
    expect((await client.execute("export_list", owner)).jobs).toHaveLength(2);
    expect(await sourceInput.inputValue()).toBe(draft);
    expect((await client.execute("project_read", owner)).revision).toBe(project.revision);
    await page.unroute("**/api/export_create");
    await page.getByRole("button", { name: "放弃本地修改并刷新", exact: true }).click();
    await ready();
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await ready();
    await page.getByRole("tab", { name: "媒体", exact: true }).click();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAAPklEQVR4AcXBMQEAIAzAsK5CuPEvChtMRpN5535CEpOYxCQmMYlJTGISk5jEJCYxiUlMYhKTmMQkJjGJSWwBYl8CWwMRvGQAAAAASUVORK5CYII=",
      "base64",
    );
    const imports: { requestId: string; uploadId?: string }[] = [];
    let importLost = false,
      uploads = 0;
    await page.route("**/api/resource_upload", async (route) => {
      uploads++;
      await route.continue();
    });
    await page.route("**/api/resource_import", async (route) => {
      const input = route.request().postDataJSON();
      imports.push(input);
      if (input.uploadId && !importLost) {
        importLost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByLabel("导入媒体", { exact: true })
      .setInputFiles({ name: "same.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled()).toBe(true);
    const imported = await client.execute("project_read", owner);
    expect(imported.resources).toHaveLength(1);
    const later = await client.execute("project_save", {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: imported.revision,
      files: imported.files.map((file) =>
        file.path === "index.html" ? { ...file, content: `${file.content}\n<!-- later committed edit -->` } : file,
      ),
    });
    // Reload the stale bound entry: recovery must remain available even though exact admission rejects.
    await page.reload();
    await expect.poll(() => recovery.getByRole("button", { name: "检查原操作", exact: true }).isEnabled()).toBe(true);
    await recovery.getByRole("button", { name: "检查原操作", exact: true }).click();
    await ready();
    expect(uploads).toBe(1);
    expect(imports.filter((input) => input.uploadId)).toHaveLength(1);
    expect(new Set(imports.map((input) => input.requestId)).size).toBe(1);
    expect(await client.execute("project_read", owner)).toEqual(later);
    const fresh = await client.execute("project_entry", {
      ...owner,
      expectedRevision: later.revision,
      expectedHistory: later.history.version,
    });
    await page.goto(new URL(entryFragment(fresh), web.endpoint.url).href);
    await ready();
    await sourceMode();
    expect(await sourceInput.inputValue()).toContain("later committed edit");
    await driver.capture("confirmed-import-after-stale-entry");
    // A pre-commit interruption retains metadata but no File. Wrong reselected bytes make no request.
    await page.unroute("**/api/resource_import");
    let beforeCommit = true;
    const restaged: { requestId: string; uploadId?: string }[] = [];
    await page.route("**/api/resource_import", async (route) => {
      const input = route.request().postDataJSON();
      restaged.push(input);
      if (input.uploadId && beforeCommit) await route.abort("failed");
      else await route.continue();
    });
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await ready();
    await page.getByRole("tab", { name: "媒体", exact: true }).click();
    await page
      .getByLabel("导入媒体", { exact: true })
      .setInputFiles({ name: "again.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled()).toBe(true);
    await page.reload();
    await ready();
    const reselect = recovery.getByLabel("重新选择原文件", { exact: true });
    const requestsBeforeWrongFile = restaged.length,
      uploadsBeforeWrongFile = uploads;
    await reselect.setInputFiles({ name: "wrong.png", mimeType: "image/png", buffer: Buffer.from("wrong bytes") });
    await expect.poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled()).toBe(true);
    expect(restaged).toHaveLength(requestsBeforeWrongFile);
    expect(uploads).toBe(uploadsBeforeWrongFile);
    beforeCommit = false;
    await reselect.setInputFiles({ name: "original.png", mimeType: "image/png", buffer: png });
    await ready();
    expect(new Set(restaged.map((input) => input.requestId)).size).toBe(1);
    const twice = await client.execute("project_read", owner);
    expect(twice.resources).toHaveLength(2);
    expect(twice.files).toEqual(later.files);
    await page.unroute("**/api/resource_import");
    // ZIP creation confirmation must not select the created artifact or repeat upload.
    const ticket = await client.execute("archive_export", {
      ...owner,
      requestId: randomUUID(),
      revision: twice.revision,
    });
    const zip = Buffer.from(await (await client.downloadArchive(ticket)).arrayBuffer());
    await client.execute("archive_release", { id: ticket.id });
    const currentEntry = await client.execute("project_entry", {
      ...owner,
      expectedRevision: twice.revision,
      expectedHistory: twice.history.version,
    });
    await page.goto(new URL(entryFragment(currentEntry), web.endpoint.url).href);
    await ready();
    let archiveLost = false,
      archiveUploads = 0;
    const archives: { requestId: string; uploadId?: string }[] = [];
    await page.route("**/api/archive_upload", async (route) => {
      archiveUploads++;
      await route.continue();
    });
    await page.route("**/api/archive_import", async (route) => {
      const input = route.request().postDataJSON();
      archives.push(input);
      if (input.uploadId && !archiveLost) {
        archiveLost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .locator("summary")
      .filter({ hasText: /^工程 ZIP$/ })
      .click();
    await page.getByLabel("ZIP 工程标题", { exact: true }).fill("Recovered ZIP");
    await page
      .getByLabel("导入 ZIP", { exact: true })
      .setInputFiles({ name: "project.zip", mimeType: "application/zip", buffer: zip });
    await page.getByRole("button", { name: "导入 ZIP 工程", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled()).toBe(true);
    const selection = (await client.execute("workspace_state", {})).selection;
    expect((await client.execute("session_get", { sessionId: session.id })).artifacts).toHaveLength(2);
    await page.reload();
    await ready();
    const reloadedSelection = (await client.execute("workspace_state", {})).selection;
    expect(reloadedSelection.artifactId).toBe(selection.artifactId);
    await recovery.getByRole("button", { name: "检查原操作", exact: true }).click();
    await ready();
    expect(archiveUploads).toBe(1);
    expect(archives.filter((input) => input.uploadId)).toHaveLength(1);
    expect(new Set(archives.map((input) => input.requestId)).size).toBe(1);
    expect((await client.execute("workspace_state", {})).selection).toEqual(reloadedSelection);
    expect((await client.execute("session_get", { sessionId: session.id })).artifacts).toHaveLength(2);
    expect(await client.execute("project_read", owner)).toEqual(twice);
    await driver.capture("confirmed-zip-with-original-selection");
    report.reselection = { requests: restaged.length, sameIdentity: true, wrongBytesSent: false };
    report.archive = { uploads: archiveUploads, selectionPreserved: true, artifactCount: 2 };
    report.acceptance = {
      exportId: accepted.id,
      exportAttempt: accepted.attempt,
      exportSubmissions: exports.length,
      resourceUploads: uploads,
      originalImportIdentity: true,
      laterRevision: later.revision,
    };
    expect(driver.errors).toEqual([]);
  } catch (error) {
    report.failure = String(error);
    report.errors = driver?.errors;
    report.visible = await driver?.page.locator("body").innerText();
    await driver?.capture("failure").catch(() => {});
    throw error;
  } finally {
    await driver?.page.unrouteAll({ behavior: "wait" });
    await driver?.close();
    await manager.close();
    report.phase = (await readDirectory(root)).manager.phase;
    report.processes = await observeProcesses(root);
    await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
    expect(report.phase).toBe("closed");
    expect(report.processes).toEqual([]);
  }
}, 60000);
