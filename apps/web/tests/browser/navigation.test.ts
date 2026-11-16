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
import { entryFragment, parseEntry } from "@open-motion/daemon/contract";
import { initialFiles } from "@open-motion/workspace/contract";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { Config } from "@";

const repo = fileURLToPath(new URL("../../../../", import.meta.url)),
  evidence = join(repo, ".artifacts", "workspace-navigation", randomUUID()),
  root = join(evidence, "sidecar"),
  report: Record<string, unknown> = { reference: "ac94aed11edd15e12a5cf12033ef55fd3b5391f2" };
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
  const factory = manager.factory({ channel: channel("dev"), namespace: namespace("navigation") });
  let bootstrap: Config | undefined,
    daemon: Awaited<ReturnType<typeof daemonServe>> | undefined,
    capability: Awaited<ReturnType<typeof factory.issue>> | undefined;
  const web = await source(factory, {
    name: "web",
    directory: fileURLToPath(new URL("../../dist/", import.meta.url)),
    documents: {
      "/bootstrap.json": () => {
        if (!bootstrap) throw Error("fixture not ready");
        return { type: "application/json", body: JSON.stringify(bootstrap) };
      },
    },
  });
  url = web.endpoint.url;
  await factory.expose({
    identity: { service: "daemon", generation: digest("workspace-navigation") },
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

it("browses without a project, retains drafts through page history and keeps acknowledged project intent on forward/reload", async () => {
  const page = driver.page,
    operations: string[] = [];
  page.on("request", (request) => {
    const op = new URL(request.url()).pathname.split("/api/")[1];
    if (op) operations.push(op);
  });
  const config = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config,
    client = new Client(config.daemon, config.token);
  await page.goto(`${url}?page=templates&embed=1`);
  const library = page.getByRole("region", { name: "模板库", exact: true }),
    nav = page.getByRole("navigation", { name: "工作区导航", exact: true }),
    cards = library.locator("[data-template-id]");
  await expect.poll(() => cards.count()).toBe(3);
  expect(operations).toEqual(["template_list"]);
  expect((await client.execute("workspace_state", {})).sessions).toEqual([]);
  expect(await nav.getByRole("button", { name: "后退", exact: true }).isEnabled()).toBe(false);
  await library.getByLabel("搜索模板", { exact: true }).fill("missing-template");
  await library.getByText("没有匹配的模板", { exact: true }).waitFor();
  await library.getByLabel("搜索模板", { exact: true }).fill("");
  await page.route("**/api/template_list", (route) => route.abort("failed"));
  await library.getByRole("button", { name: "刷新模板库", exact: true }).click();
  await expect.poll(() => library.textContent()).toContain("保留上次目录");
  expect(await cards.count()).toBe(3);
  await page.unroute("**/api/template_list");
  await library.getByRole("button", { name: "刷新模板库", exact: true }).click();
  await expect.poll(() => library.textContent()).not.toContain("保留上次目录");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await nav.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(100);
  expect(await library.evaluate((node) => node.getBoundingClientRect().width)).toBe(390);
  await driver.capture("project-free-library-mobile");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await driver.capture("project-free-library");
  const session = await client.execute("session_create", {
    requestId: randomUUID(),
    title: "Navigation",
    mode: "motion",
  });
  const make = async (title: string) => {
    const artifact = await client.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title,
      files: initialFiles(),
    });
    const project = await client.execute("project_read", { sessionId: session.id, artifactId: artifact.id });
    return {
      artifact,
      fragment: entryFragment({
        sessionId: session.id,
        artifactId: artifact.id,
        revision: project.revision,
        historyVersion: project.history.version,
      }),
    };
  };
  const intended = await make("Intended"),
    other = await make("Other");
  const linked = `${url}?page=templates&embed=1${intended.fragment}`;
  operations.length = 0;
  await page.goto(linked);
  await expect.poll(() => cards.count()).toBe(3);
  operations.length = 0;
  await page.reload();
  await expect.poll(() => cards.count()).toBe(3);
  expect(operations).toEqual(["template_list"]);
  expect((await client.execute("workspace_state", {})).selection.artifactId).toBeNull();
  await nav.getByRole("button", { name: "编辑工作区", exact: true }).click();
  await ready();
  expect(await page.locator("#app").getAttribute("data-artifact-id")).toBe(intended.artifact.id);
  await click("源码");
  const code = page.getByRole("textbox", { name: "index.html", exact: true }),
    edited = `${await code.inputValue()}\n<!-- Navigation draft -->`;
  await code.fill(edited);
  await code.evaluate((node) => {
    node.dataset.retained = "draft";
    (node as HTMLTextAreaElement).setSelectionRange(5, 15);
  });
  const before = await client.execute("workspace_state", {});
  operations.length = 0;
  await nav.getByRole("button", { name: "模板库", exact: true }).click();
  await cards.first().waitFor();
  await page.keyboard.press("Control+s");
  await nav.getByRole("button", { name: "后退", exact: true }).click();
  await code.waitFor();
  expect(await code.inputValue()).toBe(edited);
  expect(await code.getAttribute("data-retained")).toBe("draft");
  expect(await code.evaluate((node) => (node as HTMLTextAreaElement).selectionStart)).toBe(5);
  // The retained editor may observe durable task metadata; page navigation must not write or load source.
  const reads = ["template_list", "workspace_observe", "export_list", "generation_list"];
  expect(operations.filter((op) => !reads.includes(op))).toEqual([]);
  expect((await client.execute("workspace_state", {})).selection).toEqual(before.selection);
  // Save in an earlier page-history entry, then forward through an older URL.
  await click("保存");
  const fresh = new URL(page.url()).hash;
  expect(fresh).not.toBe(intended.fragment);
  await nav.getByRole("button", { name: "前进", exact: true }).click();
  await cards.first().waitFor();
  expect(new URL(page.url()).hash).toBe(fresh);
  expect(new URL(page.url()).searchParams.get("embed")).toBe("1");
  const acknowledged = (await client.execute("workspace_state", {})).selection;
  operations.length = 0;
  await page.reload();
  await cards.first().waitFor();
  expect(operations).toEqual(["template_list"]);
  expect((await client.execute("workspace_state", {})).selection).toEqual(acknowledged);
  expect(await nav.getByRole("button", { name: "后退", exact: true }).isEnabled()).toBe(true);
  await nav.getByRole("button", { name: "后退", exact: true }).click();
  await ready();
  await click("源码");
  expect(await code.inputValue()).toBe(edited);
  expect(new URL(page.url()).hash).toBe(fresh);
  // A copied URL starts a bounded visit and does not select its project while browsing.
  const current = (await client.execute("workspace_state", {})).selection;
  await client.execute("artifact_open", {
    sessionId: session.id,
    artifactId: other.artifact.id,
    requestId: randomUUID(),
    expectedSelection: current.revision,
    expectedCurrent: { artifactId: current.artifactId!, revision: parseEntry(fresh).revision },
  });
  const external = (await client.execute("workspace_state", {})).selection;
  const copied = await page.context().newPage();
  try {
    await copied.goto(`${url}?page=templates${fresh}`);
    await copied.locator("[data-template-id]").first().waitFor();
    expect(await copied.getByRole("button", { name: "后退", exact: true }).isEnabled()).toBe(false);
    expect((await client.execute("workspace_state", {})).selection).toEqual(external);
  } finally {
    await copied.close();
  }
  await driver.capture("history-restored-source");
  report.navigation = {
    projectFree: true,
    copiedLinkReadOnly: true,
    retainedDraft: true,
    acknowledgedHash: fresh,
    forwardAndReload: true,
  };
  expect(driver.errors).toEqual([]);
}, 60000);

it("keeps native drafts, preview identity and an unknown save receipt across library navigation", async () => {
  const page = driver.page;
  await page.goto(url);
  await ready();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目标题", { exact: true }).fill("Native navigation");
  await click("创建空白项目");
  await click("添加文本");
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  const text = page.getByLabel("文本内容", { exact: true });
  await text.fill("Retained native draft");
  await text.evaluate((node) => {
    node.dataset.retained = "native";
  });
  const frame = page.locator("iframe:not([hidden])");
  await frame.evaluate((node) => {
    node.dataset.retained = "preview";
  });
  await click("播放");
  const nav = page.getByRole("navigation", { name: "工作区导航", exact: true });
  await nav.getByRole("button", { name: "模板库", exact: true }).click();
  await page.locator("[data-template-id]").first().waitFor();
  await expect
    .poll(() =>
      frame
        .contentFrame()
        .locator("body")
        .evaluate(() => Reflect.get(window, "__timelines").main.paused()),
    )
    .toBe(true);
  await nav.getByRole("button", { name: "后退", exact: true }).click();
  await text.waitFor();
  expect(await text.inputValue()).toBe("Retained native draft");
  expect(await text.getAttribute("data-retained")).toBe("native");
  expect(await frame.getAttribute("data-retained")).toBe("preview");
  const ids: string[] = [];
  let lose = true;
  await page.route("**/api/project_save", async (route) => {
    ids.push(route.request().postDataJSON().requestId);
    if (!lose) return route.continue();
    lose = false;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "应用更改", exact: true }).click();
  await expect.poll(() => page.getByRole("button", { name: "重试", exact: true }).isEnabled()).toBe(true);
  await nav.getByRole("button", { name: "模板库", exact: true }).click();
  await nav.getByRole("button", { name: "编辑工作区", exact: true }).click();
  expect(ids).toHaveLength(1);
  expect(await text.inputValue()).toBe("Retained native draft");
  await click("重试");
  await page.unroute("**/api/project_save");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await click("源码");
  expect(await page.getByRole("textbox", { name: "index.html", exact: true }).inputValue()).toContain(
    "Retained native draft",
  );
  report.nativeNavigation = {
    draftRetained: true,
    previewRetained: true,
    pausedWhileHidden: true,
    exactSaveRetry: ids[0] === ids[1],
  };
  await driver.capture("native-receipt-confirmed");
}, 60000);

it("continues page history when presentation storage is unavailable", async () => {
  const page = await driver.page.context().newPage();
  try {
    await page.addInitScript(() =>
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw Error("Storage denied");
        },
      }),
    );
    await page.goto(`${url}?page=templates`);
    await page.locator("[data-template-id]").first().waitFor();
    const nav = page.getByRole("navigation", { name: "工作区导航", exact: true });
    await nav.getByRole("button", { name: "编辑工作区", exact: true }).click();
    await page.getByRole("region", { name: "项目编辑器", exact: true }).waitFor();
    await nav.getByRole("button", { name: "后退", exact: true }).click();
    await page.locator("[data-template-id]").first().waitFor();
    expect(await nav.getByRole("button", { name: "后退", exact: true }).isEnabled()).toBe(false);
    expect(await nav.getByRole("button", { name: "前进", exact: true }).isEnabled()).toBe(true);
  } finally {
    await page.close();
  }
}, 30000);
