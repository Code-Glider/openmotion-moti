// @vitest-environment node
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, imageDifference } from "@odsuite/automation";
import { channel, digest, namespace } from "@odsuite/protocol";
import { source } from "@odsuite/serve";
import { serve as manage, managerEndpoint, observeProcesses, readDirectory } from "@odsuite/sidecar";
import { serve as daemonServe } from "@open-motion/daemon";
import { Client } from "@open-motion/daemon/client";
import { entryFragment, parseEntry } from "@open-motion/daemon/contract";
import { initialFiles } from "@open-motion/workspace/contract";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { Config } from "@";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url)),
  evidence = join(repo, ".artifacts", "content-versions", randomUUID()),
  root = join(evidence, "sidecar"),
  report: Record<string, unknown> = { reference: "cc3011158216a4d66351166f8abb0ea49a910d94" };
let manager: Awaited<ReturnType<typeof manage>>,
  driver: Awaited<ReturnType<typeof browser>>,
  url = "";
const stages: { name: string; elapsed: number }[] = [],
  began = Date.now();
async function stage(name: string) {
  report.stage = name;
  stages.push({ name, elapsed: Date.now() - began });
  report.stages = stages;
  console.info(`[workspace] ${name}`);
  await writeFile(join(evidence, "progress.json"), JSON.stringify(report, null, 2));
}
const ready = async () => {
  await driver.page
    .locator("[aria-live]")
    .filter({ hasText: /^就绪$/ })
    .waitFor();
};
async function click(name: string) {
  await stage(`click ${name}`);
  await driver.page.getByRole("button", { name, exact: true }).click();
  await ready();
  await stage(`ready after ${name}`);
}
async function start() {
  manager = await manage(managerEndpoint(root), { root });
  const factory = manager.factory({ channel: channel("dev"), namespace: namespace("content-versions") });
  let bootstrap: Config | undefined,
    daemon: Awaited<ReturnType<typeof daemonServe>> | undefined,
    capability: Awaited<ReturnType<typeof factory.issue>> | undefined;
  const web = await source(factory, {
    name: "web",
    directory: fileURLToPath(new URL("../../../dist/", import.meta.url)),
    documents: {
      "/bootstrap.json": () => {
        if (!bootstrap) throw Error("fixture not ready");
        return { type: "application/json", body: JSON.stringify(bootstrap) };
      },
    },
  });
  url = web.endpoint.url;
  await factory.expose({
    identity: { service: "daemon", generation: digest("content-versions") },
    handlers: {},
    lifecycle: {
      initialize: async (context) => {
        const socket = await context.allocate({ kind: "socket", name: "daemon" }),
          port = await context.allocate({ kind: "port", name: "daemon", scheme: "http" });
        capability = await factory.issue({ owner: `n${context.incarnation.replaceAll("-", "")}`, service: "daemon" });
        daemon = await daemonServe({
          data: context.roots.data,
          origin: url,
          socket: socket.value,
          token: capability.token,
          endpoint: port.value,
        });
        await context.forward(port.value, socket.value);
        bootstrap = {
          daemon: port.value,
          token: capability.token,
          environment: {
            schema: 1,
            carrier: "browser-fixture",
            system: { platform: process.platform, release: "test", arch: process.arch },
            runtime: { name: "node", version: process.versions.node },
          },
        };
      },
      quiesce: async () => daemon?.quiesce(),
      stop: async () => {
        await daemon?.close();
        if (capability) await factory.retire(capability);
      },
    },
  });
}
beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  await start();
  driver = await browser({ evidence, viewport: { width: 1600, height: 1000 } });
  driver.page.setDefaultTimeout(8000);
  await access(chromium.executablePath());
  expect(driver.page.context().browser()?.browserType().executablePath()).toBe(chromium.executablePath());
  report.browser = {
    version: driver.page.context().browser()?.version(),
    installedExecutable: chromium.executablePath(),
    viewport: driver.page.viewportSize(),
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    locale: "zh-CN",
  };
}, 30000);
afterAll(async () => {
  const failures: unknown[] = [];
  try {
    await driver?.page.unrouteAll({ behavior: "wait" });
  } catch (error) {
    failures.push(error);
  }
  try {
    await driver?.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await manager?.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    report.phase = (await readDirectory(root)).manager.phase;
    report.processes = await observeProcesses(root);
  } catch (error) {
    failures.push(error);
  }
  report.closed = report.phase === "closed";
  report.errors = driver?.errors ?? [];
  report.cleanupErrors = failures.map(String);
  await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
  expect(failures).toEqual([]);
  expect(report.phase).toBe("closed");
  expect(report.processes).toEqual([]);
}, 30000);

afterEach(async (context) => {
  if (context.task.result?.state === "fail" && driver) {
    await writeFile(
      join(evidence, "failure.txt"),
      context.task.result.errors?.map((error) => error.message).join("\n") ?? "failed",
    );
    try {
      await driver.capture("failure");
    } catch (error) {
      report.captureFailure = String(error);
      await writeFile(join(evidence, "progress.json"), JSON.stringify(report, null, 2));
    }
  }
});

it("restores complete native source/fonts/media as a new version, saves drafts, retries one lost receipt and cold-reopens actual paint", async () => {
  const page = driver.page,
    config = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config,
    client = new Client(config.daemon, config.token),
    template = (await client.execute("template_list", {})).templates.find((t) => t.id === "nyt-graph")!,
    session = await client.execute("session_create", {
      requestId: randomUUID(),
      title: "Content versions",
      mode: "motion",
    }),
    artifact = await client.execute("template_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Versioned graph",
      id: template.id,
      contentHash: template.contentHash,
    }),
    owner = { sessionId: session.id, artifactId: artifact.id };
  const read = () => client.execute("project_read", owner),
    save = async (
      transform: (
        files: import("@open-motion/workspace/contract").SourceFile[],
      ) => import("@open-motion/workspace/contract").SourceFile[],
    ) => {
      const current = await read();
      return client.execute("project_save", {
        ...owner,
        requestId: randomUUID(),
        expectedRevision: current.revision,
        files: transform(current.files),
      });
    },
    png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAAPklEQVR4AcXBMQEAIAzAsK5CuPEvChtMRpN5535CEpOYxCQmMYlJTGISk5jEJCYxiUlMYhKTmMQkJjGJSWwBYl8CWwMRvGQAAAAASUVORK5CYII=",
      "base64",
    );
  await client.importResource(
    {
      ...owner,
      requestId: randomUUID(),
      expectedRevision: (await read()).revision,
      path: "assets/picture.png",
      name: "Retained image",
      digest: digest(png),
      bytes: png.length,
    },
    new Blob([png]),
  );
  const image =
    '<img id="history-picture" class="clip" src="assets/picture.png" data-start="0" data-duration="15" data-track-index="1" style="position:absolute;left:60px;top:320px;width:32px;height:24px" />';
  const nativeCaption =
    '<h1 id="native-draft-label" class="clip" data-start="0" data-duration="15" data-track-index="2" style="position:absolute;left:60px;top:100px;font-family:Libre Franklin;font-size:40px;color:#222">Native base</h1>';
  await save((files) =>
    files.map((f) =>
      f.path === "index.html"
        ? {
            ...f,
            content: f.content.replace(
              '<div\n        id="nyt-chart-comp"',
              image + nativeCaption + '<div\n        id="nyt-chart-comp"',
            ),
          }
        : f,
    ),
  );
  const original = await read(),
    target = (await client.execute("project_versions", owner)).current;
  expect(original.files.find((f) => f.path === "index.html")?.content).toContain("history-picture");
  for (let i = 0; i < 7; i++)
    await save((files) =>
      files.map((f) =>
        f.path === "compositions/nyt-chart.html"
          ? {
              ...f,
              content: f.content.replace(/Monthly Revenue vs\. Conversion Rate|Graph edit \d+/, `Graph edit ${i}`),
            }
          : f,
      ),
    );
  await save((files) =>
    files.map((f) => (f.path === "index.html" ? { ...f, content: f.content.replace(image, "") } : f)),
  );
  await client.execute("resource_remove", {
    ...owner,
    requestId: randomUUID(),
    expectedRevision: (await read()).revision,
    path: "assets/picture.png",
  });
  const head = await read(),
    entry = await client.execute("project_entry", {
      ...owner,
      expectedRevision: head.revision,
      expectedHistory: head.history.version,
    }),
    first = await client.execute("project_versions", owner),
    retainedIds: string[] = [];
  let part = first;
  for (;;) {
    retainedIds.push(...part.versions.map((v) => v.id));
    if (!part.nextCursor) break;
    part = await client.execute("project_versions", { ...owner, cursor: part.nextCursor });
  }
  await page.goto(url + entryFragment(entry));
  await ready();
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  await click("源码");
  const code = page.getByRole("textbox", { name: "index.html", exact: true });
  await code.fill((await code.inputValue()) + "\n<!-- saved before explicit restore -->");
  const beforeBrowse = await read();
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "版本历史", exact: true }),
    readyVersions = () => modal.getByLabel("版本读取状态", { exact: true }).filter({ hasText: "版本已就绪" }).waitFor();
  await readyVersions();
  expect(await modal.getByRole("listitem").count()).toBe(5);
  expect(await code.inputValue()).toContain("saved before explicit restore");
  expect(await read()).toEqual(beforeBrowse);
  while (!(await modal.getByRole("button", { name: `v${target.number}`, exact: true }).count())) {
    await modal.getByRole("button", { name: "下一页版本", exact: true }).click();
    await readyVersions();
  }
  await modal.getByRole("button", { name: `v${target.number}`, exact: true }).click();
  await driver.capture("content-versions-before-restore");
  const requests: string[] = [];
  let lost = true;
  await page.route("**/api/project_restore", async (route) => {
    requests.push(route.request().postDataJSON().requestId);
    if (lost) {
      lost = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await modal.getByRole("button", { name: "保存当前修改并恢复为新版本", exact: true }).click();
  await modal.getByRole("button", { name: "继续上次恢复", exact: true }).waitFor();
  await expect.poll(() => modal.getByRole("button", { name: "继续上次恢复", exact: true }).isEnabled()).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await readyVersions();
  await modal.getByRole("button", { name: "继续上次恢复", exact: true }).click();
  await ready();
  await readyVersions();
  await page.unroute("**/api/project_restore");
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  const restored = await read(),
    versions = await client.execute("project_versions", owner);
  expect(restored.files).toEqual(original.files);
  expect(restored.resources).toEqual(original.resources);
  expect(versions.current.kind).toBe("restore");
  expect(versions.current.restoredFromVersionId).toBe(target.id);
  const all = [...versions.versions];
  part = versions;
  while (part.nextCursor) {
    part = await client.execute("project_versions", { ...owner, cursor: part.nextCursor });
    all.push(...part.versions);
  }
  expect(all).toHaveLength(retainedIds.length + 2);
  expect(retainedIds.every((id) => all.some((v) => v.id === id))).toBe(true);
  const saved = all.find((v) => v.kind === "edit" && v.number === versions.current.number - 1)!;
  expect(
    (await client.execute("project_snapshot", { ...owner, revision: saved.revision })).files.find(
      (f) => f.path === "index.html",
    )?.content,
  ).toContain("saved before explicit restore");
  await page.keyboard.press("Escape");
  await click("预览");
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  await page.getByLabel("定位秒", { exact: true }).fill("3");
  await click("定位");
  const frame = page.frameLocator('iframe[title="影片预览"]');
  await expect
    .poll(() =>
      frame.locator("#history-picture").evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth),
    )
    .toBe(32);
  await frame.getByText("Monthly Revenue vs. Conversion Rate", { exact: true }).waitFor({ state: "visible" });
  await driver.capture("content-versions-restored-paint");
  const fragment = new URL(page.url()).hash;
  await page.goto("about:blank");
  await manager.close();
  await start();
  await page.goto(url + fragment);
  await ready();
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  const restarted = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config,
    cold = new Client(restarted.daemon, restarted.token);
  expect(await cold.execute("project_read", owner)).toEqual(restored);
  expect((await cold.execute("project_versions", owner)).current).toEqual(versions.current);
  expect(
    (await cold.execute("resource_read", { ...owner, revision: restored.revision, path: "assets/picture.png" }))
      .resource.digest,
  ).toBe(digest(png));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await readyVersions();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
  await driver.capture("content-versions-cold-mobile");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByLabel("图层选择", { exact: true }).selectOption({ label: "Native base" });
  await ready();
  const text = page.getByLabel("文本内容", { exact: true });
  await expect.poll(() => text.isEditable()).toBe(true);
  await text.fill("Native draft retained before restore");
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await readyVersions();
  while (!(await modal.getByRole("button", { name: `v${target.number}`, exact: true }).count())) {
    await modal.getByRole("button", { name: "下一页版本", exact: true }).click();
    await readyVersions();
  }
  await modal.getByRole("button", { name: `v${target.number}`, exact: true }).click();
  await modal.getByRole("button", { name: "保存当前修改并恢复为新版本", exact: true }).click();
  await ready();
  await readyVersions();
  const nativeHistory = await cold.execute("project_versions", owner),
    nativeSaved = nativeHistory.versions.find((v) => v.number === nativeHistory.current.number - 1)!;
  expect(nativeHistory.current.number).toBe(versions.current.number + 2);
  expect(
    (await cold.execute("project_snapshot", { ...owner, revision: nativeSaved.revision })).files.find(
      (f) => f.path === "index.html",
    )?.content,
  ).toContain("Native draft retained before restore");
  expect((await cold.execute("project_read", owner)).files).toEqual(original.files);
  await page.keyboard.press("Escape");
  await driver.capture("content-versions-native-draft-saved");
  report.versions = {
    target: target.id,
    restored: versions.current.id,
    sourceExact: true,
    retainedLaterIds: retainedIds,
    savedDraftVersion: saved.id,
    exactRetry: requests[0] === requests[1],
    actualImageWidth: 32,
    coldReopen: true,
    nativeDraftSaved: nativeSaved.id,
  };
  expect(driver.errors).toEqual([]);
}, 90000);
