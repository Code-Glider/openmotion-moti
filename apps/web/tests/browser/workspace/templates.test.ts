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
  evidence = join(repo, ".artifacts", "template-detail", randomUUID()),
  root = join(evidence, "sidecar"),
  report: Record<string, unknown> = { reference: "7d91cab72988c0b1db7c05376abce33e7f1bba0b" };
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
  const factory = manager.factory({ channel: channel("dev"), namespace: namespace("template-detail") });
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
    identity: { service: "daemon", generation: digest("template-detail") },
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

it("previews verified source without a project, creates independently with exact retries and retains the editor view on return", async () => {
  const page = driver.page,
    config = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config,
    client = new Client(config.daemon, config.token),
    catalog = await client.execute("template_list", {}),
    selected = catalog.templates[0]!;
  const original = await client.execute("template_read", { id: selected.id, contentHash: selected.contentHash });
  const reads: string[] = [];
  page.on("request", (request) => {
    const op = new URL(request.url()).pathname.split("/api/")[1];
    if (op) reads.push(op);
  });
  await page.goto(`${url}?page=templates&embed=1`);
  const nav = page.getByRole("navigation", { name: "工作区导航", exact: true }),
    detail = page.getByRole("region", { name: "模板详情", exact: true }),
    card = () => page.locator(`[data-template-id="${selected.id}"]`),
    previewReady = () => detail.getByLabel("模板预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  await card().getByRole("button", { name: "查看模板详情", exact: true }).click();
  await previewReady();
  expect(new URL(page.url()).searchParams.get("templateHash")).toBe(selected.contentHash);
  expect(
    await detail
      .getByRole("heading", { name: selected.title, exact: true })
      .evaluate((node) => node.ownerDocument.activeElement === node),
  ).toBe(true);
  expect((await client.execute("workspace_state", {})).sessions).toEqual([]);
  expect(reads.every((op) => ["template_list", "template_read"].includes(op))).toBe(true);
  expect(await detail.getByLabel("模板源码", { exact: true }).inputValue()).toBe(
    original.files.find((f) => f.path === "index.html")?.content,
  );
  const frame = detail.frameLocator("iframe"),
    fontFacts = await frame.locator("body").evaluate(() => ({
      status: document.fonts.status,
      faces: [...document.fonts].map((face) => ({ family: face.family, status: face.status })),
    }));
  expect(fontFacts.status).toBe("loaded");
  expect(fontFacts.faces.length).toBeGreaterThan(0);
  expect(fontFacts.faces.every((face) => face.status === "loaded")).toBe(true);
  const seek = async (time: number) => {
    await detail.getByLabel("模板定位秒", { exact: true }).fill(String(time));
    await detail.getByRole("button", { name: "定位模板预览", exact: true }).click();
    await expect
      .poll(() => frame.locator("body").evaluate(() => Reflect.get(window, "__timelines").main.time()))
      .toBeCloseTo(time, 2);
  };
  await driver.capture("template-detail");
  await seek(1);
  const before = await detail
    .locator("iframe")
    .screenshot({ path: join(evidence, "template-source-early.png"), animations: "disabled" });
  await seek(selected.duration / 2);
  const middle = await detail
    .locator("iframe")
    .screenshot({ path: join(evidence, "template-source-middle.png"), animations: "disabled" });
  expect(imageDifference(before, middle).ratio).toBeGreaterThan(0.001);
  await seek(selected.duration - 0.1);
  await detail
    .locator("iframe")
    .screenshot({ path: join(evidence, "template-source-late.png"), animations: "disabled" });
  await detail.locator("summary").click();
  await detail.getByLabel("模板源文件", { exact: true }).selectOption("licenses/fonts.txt");
  expect(await detail.getByRole("textbox", { name: "模板源码", exact: true }).isEditable()).toBe(false);
  expect(await detail.getByRole("textbox", { name: "模板源码", exact: true }).inputValue()).toContain(
    "SIL OPEN FONT LICENSE",
  );
  // Back/Forward within the library never admits a project and re-verifies the same identity.
  await nav.getByRole("button", { name: "后退", exact: true }).click();
  await card().waitFor();
  await nav.getByRole("button", { name: "前进", exact: true }).click();
  await previewReady();
  expect((await client.execute("workspace_state", {})).selection.artifactId).toBeNull();
  const ids: string[] = [];
  let lost = true;
  await page.route("**/api/template_create", async (route) => {
    ids.push(route.request().postDataJSON().requestId);
    if (lost) {
      lost = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await detail.getByLabel("独立项目标题", { exact: true }).fill("Verified independent project");
  await detail.getByRole("button", { name: "从此模板创建独立项目", exact: true }).click();
  const creator = page.getByRole("dialog", { name: "新建项目", exact: true });
  await expect.poll(() => creator.getByRole("button", { name: "继续创建", exact: true }).isEnabled()).toBe(true);
  expect((await client.execute("workspace_state", {})).selection.artifactId).toBeNull();
  expect((await client.execute("project_list", {})).projects).toHaveLength(1);
  await page.keyboard.press("Escape");
  await detail.getByRole("button", { name: "继续上次创建", exact: true }).click();
  expect(await creator.getByLabel("项目标题", { exact: true }).inputValue()).toBe("Verified independent project");
  await click("继续创建");
  await page.unroute("**/api/template_create");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(new URL(page.url()).searchParams.has("template")).toBe(false);
  expect(new URL(page.url()).searchParams.get("embed")).toBe("1");
  const state = await client.execute("workspace_state", {}),
    owner = { sessionId: state.selection.sessionId!, artifactId: state.selection.artifactId! },
    project = await client.execute("project_read", owner);
  expect(project.files).toEqual([...original.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  await click("源码");
  const code = page.getByRole("textbox", { name: "index.html", exact: true }),
    draft = (await code.inputValue()) + "\n<!-- Independent browser edit -->";
  await code.fill(draft);
  await click("保存");
  await click("预览");
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  const editorFrame = page.locator('iframe[title="影片预览"]'),
    editorURL = await editorFrame.getAttribute("src");
  await editorFrame.evaluate((node) => (node.dataset.retained = "editor"));
  const held = (await client.execute("workspace_state", {})).selection;
  await nav.getByRole("button", { name: "模板库", exact: true }).click();
  await card().getByRole("button", { name: "查看模板详情", exact: true }).click();
  await previewReady();
  const templateURL = await detail.locator("iframe").getAttribute("src");
  expect(templateURL).not.toBe(editorURL);
  await detail.getByLabel("模板源文件", { exact: true }).selectOption("index.html");
  expect(await detail.getByRole("textbox", { name: "模板源码", exact: true }).inputValue()).not.toContain(
    "Independent browser edit",
  );
  await nav.getByRole("button", { name: "编辑工作区", exact: true }).click();
  await expect.poll(() => page.locator('iframe[title="模板预览"]').count()).toBe(0);
  expect(await editorFrame.getAttribute("data-retained")).toBe("editor");
  expect((await page.request.get(editorURL!)).status()).toBe(200);
  expect((await page.request.get(templateURL!)).status()).toBe(404);
  expect((await client.execute("workspace_state", {})).selection).toEqual(held);
  expect((await client.execute("template_read", { id: selected.id, contentHash: selected.contentHash })).files).toEqual(
    original.files,
  );
  // A second explicit creation is fresh source; an unknown entry response replays the same intent.
  await nav.getByRole("button", { name: "模板库", exact: true }).click();
  await card().getByRole("button", { name: "查看模板详情", exact: true }).click();
  await previewReady();
  const entryIds: string[] = [];
  let loseEntry = true;
  await page.route("**/api/artifact_open", async (route) => {
    entryIds.push(route.request().postDataJSON().requestId);
    if (loseEntry) {
      loseEntry = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await detail.getByLabel("独立项目标题", { exact: true }).fill("Second independent copy");
  await detail.getByRole("button", { name: "从此模板创建独立项目", exact: true }).click();
  await expect.poll(() => creator.getByRole("button", { name: "继续创建", exact: true }).isEnabled()).toBe(true);
  await click("继续创建");
  await page.unroute("**/api/artifact_open");
  expect(entryIds).toHaveLength(2);
  expect(entryIds[0]).toBe(entryIds[1]);
  const secondState = await client.execute("workspace_state", {}),
    second = { sessionId: secondState.selection.sessionId!, artifactId: secondState.selection.artifactId! };
  expect(second.artifactId).not.toBe(owner.artifactId);
  expect((await client.execute("project_read", second)).files).toEqual(project.files);
  expect((await client.execute("project_read", owner)).files.find((f) => f.path === "index.html")?.content).toBe(draft);
  const fragment = new URL(page.url()).hash;
  await manager.close();
  await start();
  const restarted = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config,
    reopened = new Client(restarted.daemon, restarted.token);
  reads.length = 0;
  await page.goto(
    `${url}?page=templates&template=${selected.id}&templateHash=${encodeURIComponent(selected.contentHash)}${fragment}`,
  );
  await previewReady();
  expect(reads).toEqual(["template_read"]);
  expect((await reopened.execute("workspace_state", {})).selection.artifactId).toBe(second.artifactId);
  await driver.capture("template-cold-detail");
  await nav.getByRole("button", { name: "编辑工作区", exact: true }).click();
  await ready();
  await click("源码");
  expect(await code.inputValue()).not.toContain("Independent browser edit");
  expect((await reopened.execute("project_read", owner)).files.find((f) => f.path === "index.html")?.content).toBe(
    draft,
  );
  report.sourcePreview = {
    id: selected.id,
    contentHash: selected.contentHash,
    fontFacts,
    frameDifference: imageDifference(before, middle),
    noProjectWhileBrowsing: true,
    exactCreateRetry: ids[0] === ids[1],
    exactEntryRetry: entryIds[0] === entryIds[1],
    independentCopies: true,
    editorViewRetained: true,
    coldReopen: true,
  };
  expect(driver.errors).toEqual([]);
}, 90000);

it("rejects malformed and stale template links without falling back to creation or project admission", async () => {
  const page = driver.page,
    operations: string[] = [];
  const listener = (request: import("playwright").Request) => {
    const op = new URL(request.url()).pathname.split("/api/")[1];
    if (op) operations.push(op);
  };
  page.on("request", listener);
  try {
    await page.goto(`${url}?page=templates&template=product-promo&templateHash=bad`);
    await page.getByLabel("模板预览状态", { exact: true }).filter({ hasText: "模板链接无效" }).waitFor();
    expect(operations).toEqual([]);
    await page.goto(
      `${url}?page=templates&template=product-promo&templateHash=${encodeURIComponent(`sha256:${"0".repeat(64)}`)}`,
    );
    await page.getByLabel("模板预览状态", { exact: true }).filter({ hasText: "模板预览不可用" }).waitFor();
    expect(operations).toEqual(["template_read"]);
    expect(await page.getByRole("button", { name: "从此模板创建独立项目", exact: true }).isEnabled()).toBe(false);
    await page.getByRole("button", { name: "返回模板目录", exact: true }).click();
    await page.locator("[data-template-id]").first().waitFor();
    report.invalidLinks = { malformedRejectedWithoutRead: true, staleRejectedWithoutFallback: true };
  } finally {
    page.off("request", listener);
  }
}, 30000);

it("loads the other finite templates with offline fonts and a responsive read-only detail", async () => {
  const page = driver.page,
    config = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config,
    client = new Client(config.daemon, config.token),
    catalog = await client.execute("template_list", {}),
    before = await client.execute("workspace_state", {});
  const facts = [];
  for (const template of catalog.templates.slice(1)) {
    await page.goto(
      `${url}?page=templates&template=${template.id}&templateHash=${encodeURIComponent(template.contentHash)}`,
    );
    const detail = page.getByRole("region", { name: "模板详情", exact: true });
    await detail.getByLabel("模板预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
    const frame = detail.frameLocator("iframe");
    const fonts = await frame.locator("body").evaluate(() => [...document.fonts].map((face) => face.status));
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((status) => status === "loaded")).toBe(true);
    await detail.getByLabel("模板定位秒", { exact: true }).fill(String(template.duration / 2));
    await detail.getByRole("button", { name: "定位模板预览", exact: true }).click();
    await expect
      .poll(() => frame.locator("body").evaluate(() => Reflect.get(window, "__timelines").main.time()))
      .toBeCloseTo(template.duration / 2, 2);
    facts.push({ id: template.id, contentHash: template.contentHash, fonts });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await detail.getByRole("button", { name: "从此模板创建独立项目", exact: true }).isVisible()).toBe(true);
    expect(await page.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await driver.capture(`template-${template.id}-mobile`);
    await page.getByRole("button", { name: "返回模板目录", exact: true }).click();
    await page.locator("[data-template-id]").first().waitFor();
    await page.setViewportSize({ width: 1600, height: 1000 });
  }
  expect((await client.execute("workspace_state", {})).selection).toEqual(before.selection);
  expect((await client.execute("workspace_state", {})).sessions).toEqual(before.sessions);
  report.otherTemplates = facts;
}, 30000);
