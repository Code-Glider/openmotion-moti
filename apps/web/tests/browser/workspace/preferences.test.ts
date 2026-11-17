// @vitest-environment node
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@odsuite/automation";
import { channel, digest, namespace } from "@odsuite/protocol";
import { source } from "@odsuite/serve";
import { serve as manage, managerEndpoint, observeProcesses, readDirectory } from "@odsuite/sidecar";
import { serve as daemonServe } from "@open-motion/daemon";
import { Client } from "@open-motion/daemon/client";
import { entryFragment } from "@open-motion/daemon/contract";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { Config } from "@";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url)),
  evidence = join(repo, ".artifacts", "view-preferences", randomUUID()),
  root = join(evidence, "sidecar"),
  report: Record<string, unknown> = { reference: "d25ff0b0cd35314455ab3cf21bb638efc4059bdc" };
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
  const factory = manager.factory({ channel: channel("dev"), namespace: namespace("view-preferences") });
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
    identity: { service: "daemon", generation: digest("view-preferences") },
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

it("retains drafts, frame identity and unknown project receipts through view changes, then persists across a new origin", async () => {
  const page = driver.page;
  let config = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config;
  let client = new Client(config.daemon, config.token);
  const template = (await client.execute("template_list", {})).templates.find((t) => t.id === "nyt-graph")!;
  const session = await client.execute("session_create", {
    requestId: randomUUID(),
    title: "View preferences",
    mode: "motion",
  });
  const artifact = await client.execute("template_create", {
    requestId: randomUUID(),
    sessionId: session.id,
    title: "Persistent view",
    id: template.id,
    contentHash: template.contentHash,
  });
  const owner = { sessionId: session.id, artifactId: artifact.id };
  const created = await client.execute("project_read", owner);
  const edited = await client.editMotion({
    html: created.files.find((f) => f.path === "index.html")!.content,
    action: "addText",
    fontSize: 96,
    text: "Preference draft",
  });
  const textId = edited.clips.find((c) => c.text === "Preference draft")!.id;
  const initial = await client.execute("project_save", {
    ...owner,
    requestId: randomUUID(),
    expectedRevision: created.revision,
    files: created.files.map((f) => (f.path === "index.html" ? { ...f, content: edited.html } : f)),
  });
  const entry = await client.execute("project_entry", {
    ...owner,
    expectedRevision: (await client.execute("project_read", owner)).revision,
    expectedHistory: initial.history.version,
  });
  await page.goto(new URL(entryFragment(entry), url).href);
  await ready();
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  const frame = page.locator("iframe");
  const frameSource = await frame.getAttribute("src");
  await frame.evaluate((node) => Reflect.set(window, "retainedPreferenceFrame", node));
  const settings = page.getByRole("dialog", { name: "界面设置", exact: true });
  async function open() {
    await page.getByRole("button", { name: "界面设置", exact: true }).click();
  }
  async function apply(theme: string, layout: string) {
    await open();
    await settings.getByRole("combobox", { name: "主题", exact: true }).selectOption(theme);
    await settings.getByRole("combobox", { name: "布局", exact: true }).selectOption(layout);
    await settings.getByRole("button", { name: "应用并保存界面", exact: true }).click();
    await settings.getByRole("status").filter({ hasText: "界面设置已保存并同步" }).waitFor();
    await page.keyboard.press("Escape");
  }
  const before = {
    state: await client.execute("workspace_state", {}),
    project: await client.execute("project_read", owner),
    versions: await client.execute("project_versions", owner),
  };
  await stage("source draft and focused layout");
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await click("index.html");
  const source = page.getByRole("textbox", { name: "index.html", exact: true });
  const draft = (await source.inputValue()).replace("</body>", "<!--retained source draft--></body>");
  await source.fill(draft);
  await source.evaluate((node) => node.setAttribute("data-view-probe", "source"));
  await apply("dark", "preview");
  await driver.capture("focused-dark-source-draft");
  expect(await source.inputValue()).toBe(draft);
  expect(await source.getAttribute("data-view-probe")).toBe("source");
  expect(await page.getByRole("region", { name: "图层与文件", exact: true }).isVisible()).toBe(false);
  expect(await frame.getAttribute("src")).toBe(frameSource);
  expect(
    await page.evaluate(() => Reflect.get(window, "retainedPreferenceFrame") === document.querySelector("iframe")),
  ).toBe(true);
  expect(await client.execute("project_read", owner)).toEqual(before.project);
  expect(await client.execute("project_versions", owner)).toEqual(before.versions);
  expect(await client.execute("workspace_state", {})).toEqual(before.state);
  await apply("light", "edit");
  await click("放弃本地修改并刷新");
  await click("预览");
  await page.getByRole("tab", { name: "图层", exact: true }).click();
  const track = page.locator(`[data-clip-id="${textId}"]`);
  await track.click();
  await ready();
  await page.getByText("外观与静态位移", { exact: true }).click();
  const native = page.getByLabel("不透明度", { exact: true });
  await native.fill("0.37");
  await native.evaluate((node) => node.setAttribute("data-view-probe", "native"));
  await apply("system", "preview");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.locator("#app").getAttribute("data-om-theme")).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.locator("#app").getAttribute("data-om-theme")).toBe("light");
  await apply("light", "edit");
  expect(await native.inputValue()).toBe("0.37");
  expect(await native.getAttribute("data-view-probe")).toBe("native");
  expect(await client.execute("project_versions", owner)).toEqual(before.versions);
  await click("保存");
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  await frame.evaluate((node) => Reflect.set(window, "retainedPreferenceFrame", node));
  await stage("unknown project receipt remains independent of view changes");
  await click("源码");
  await source.fill((await source.inputValue()).replace("</body>", "<!--unknown project receipt--></body>"));
  const projectRequests: unknown[] = [];
  let projectLost = false,
    projectCommitted = false;
  await page.route("**/api/project_save", async (route) => {
    projectRequests.push(route.request().postDataJSON());
    if (!projectLost) {
      projectLost = true;
      await route.fetch();
      projectCommitted = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => projectCommitted, { timeout: 8000 }).toBe(true);
  await expect
    .poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled(), { timeout: 8000 })
    .toBe(true);
  const savedUnknown = await client.execute("project_versions", owner);
  await apply("dark", "preview");
  expect(projectRequests).toHaveLength(1);
  expect(await client.execute("project_versions", owner)).toEqual(savedUnknown);
  await click("重试");
  expect(projectRequests).toHaveLength(2);
  expect(projectRequests[1]).toEqual(projectRequests[0]);
  await page.unroute("**/api/project_save");
  await apply("light", "edit");
  await click("预览");
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  await frame.evaluate((node) => Reflect.set(window, "retainedPreferenceFrame", node));
  await stage("lost preference receipt and competing writer");
  let lost = false;
  const requests: unknown[] = [];
  await page.route("**/api/workspace_configure", async (route) => {
    requests.push(route.request().postDataJSON());
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await open();
  await settings.getByRole("combobox", { name: "主题", exact: true }).selectOption("dark");
  await settings.getByRole("combobox", { name: "布局", exact: true }).selectOption("preview");
  await settings.getByRole("button", { name: "应用并保存界面", exact: true }).click();
  await settings.getByRole("status").filter({ hasText: "保存结果未确认" }).waitFor();
  const committed = await client.execute("workspace_preferences", {});
  await client.execute("workspace_configure", {
    requestId: randomUUID(),
    expectedVersion: committed.version,
    value: { theme: "system", layout: "edit" },
  });
  await page.keyboard.press("Escape");
  await open();
  await settings.getByRole("button", { name: "确认原界面保存", exact: true }).click();
  await settings.getByRole("status").filter({ hasText: "界面设置已保存并同步" }).waitFor();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(await settings.getByRole("combobox", { name: "主题", exact: true }).inputValue()).toBe("system");
  await page.keyboard.press("Escape");
  await page.unroute("**/api/workspace_configure");
  await stage("responsive frames and hidden panel focus");
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await driver.capture(`width-${width}`);
    expect(
      await page.evaluate(() => Reflect.get(window, "retainedPreferenceFrame") === document.querySelector("iframe")),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await apply("dark", "preview");
  const persisted = await client.execute("workspace_preferences", {});
  const content = await client.execute("project_read", owner);
  const versions = await client.execute("project_versions", owner);
  const oldOrigin = new URL(url).origin;
  await page.goto("about:blank");
  await manager.close();
  expect((await readDirectory(root)).manager.phase).toBe("closed");
  expect(await observeProcesses(root)).toEqual([]);
  await start();
  config = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config;
  client = new Client(config.daemon, config.token);
  expect(new URL(url).origin).not.toBe(oldOrigin);
  const coldEntry = await client.execute("project_entry", {
    ...owner,
    expectedRevision: content.revision,
    expectedHistory: content.history.version,
  });
  await page.goto(new URL(entryFragment(coldEntry), url).href);
  await ready();
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  expect(await page.locator("#app").getAttribute("data-om-theme")).toBe("dark");
  expect(await page.getByRole("region", { name: "图层与文件", exact: true }).isVisible()).toBe(false);
  expect(await client.execute("workspace_preferences", {})).toEqual(persisted);
  expect(await client.execute("project_read", owner)).toEqual(content);
  expect(await client.execute("project_versions", owner)).toEqual(versions);
  await page.goto(`${url}?page=templates&embed=1`);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.locator("#app").getAttribute("data-om-theme")).toBe("light");
  await open();
  expect(await settings.getByRole("combobox", { name: "主题", exact: true }).isEnabled()).toBe(false);
  expect((await client.execute("workspace_preferences", {})).value.theme).toBe("dark");
  await driver.capture("embedded-system-light");
  report.preferences = persisted;
  report.coldOriginChanged = true;
  report.requestsReplayed = requests.length;
  report.contentRevision = content.revision;
  report.versionId = versions.current.id;
  expect(driver.errors).toEqual([]);
}, 90000);
