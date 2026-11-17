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
  evidence = join(repo, ".artifacts", "field-validation", randomUUID()),
  root = join(evidence, "sidecar"),
  report: Record<string, unknown> = { reference: "8402d42d8d1b4f6d27b12daa010ec7960d075b3e" };
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
  const factory = manager.factory({ channel: channel("dev"), namespace: namespace("field-validation") });
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
    identity: { service: "daemon", generation: digest("field-validation") },
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

it("keeps numeric/color drafts and localized adjacent errors until explicit correction, without issuing invalid writes", async () => {
  const page = driver.page,
    config = (await (await fetch(new URL("/bootstrap.json", url))).json()) as Config;
  const client = new Client(config.daemon, config.token),
    session = await client.execute("session_create", {
      requestId: randomUUID(),
      title: "Field validation",
      mode: "motion",
    }),
    artifact = await client.execute("artifact_create", {
      requestId: randomUUID(),
      sessionId: session.id,
      title: "Draft fields",
      files: [
        {
          path: "index.html",
          content:
            '<html><body><main data-composition-id="main" data-width="160" data-height="90" data-duration="5"><p data-hf-id="title" data-start="0" data-duration="4">Original</p></main><script>window.__timelines={main:gsap.timeline({paused:true}).to({},{duration:5})};</script></body></html>',
        },
      ],
    }),
    owner = { sessionId: session.id, artifactId: artifact.id },
    original = await client.execute("project_read", owner),
    entry = await client.execute("project_entry", {
      ...owner,
      expectedRevision: original.revision,
      expectedHistory: original.history.version,
    });
  await page.goto(new URL(entryFragment(entry), url).href);
  await ready();
  await page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
  await page.getByLabel("图层选择", { exact: true }).selectOption("title");
  await ready();
  const writes: string[] = [];
  const observe = (request: { url(): string }) => {
    if (/\/(motion\/(patch|animation)|api\/project_save)$/.test(request.url()))
      writes.push(request.url().split("/").at(-1) ?? "");
  };
  page.on("request", observe);
  const duration = page.getByLabel("持续秒", { exact: true });
  const errorOf = async (field: typeof duration) =>
    page.locator(`[id="${await field.getAttribute("aria-errormessage")}"]`);
  const invalidSave = async (name: string, summary: string, expected = original) => {
    await page.getByRole("button", { name, exact: true }).click();
    await page.locator("[aria-live]").filter({ hasText: summary }).waitFor();
    expect(writes).toEqual([]);
    expect(await client.execute("project_read", owner)).toEqual(expected);
    expect(await page.getByRole("button", { name: /^(重试|Retry)$/, exact: true }).count()).toBe(0);
  };
  await duration.fill("0");
  expect(await duration.getAttribute("aria-invalid")).toBe("true");
  expect(await (await errorOf(duration)).innerText()).toBe("请输入大于 0 的数值。");
  await invalidSave("应用更改", "请检查标记的字段。");
  expect(await duration.evaluate((node) => document.activeElement === node)).toBe(true);
  const durationNode = await duration.elementHandle(),
    frame = page.locator("iframe");
  await frame.evaluate((node) => Reflect.set(window, "validationFrame", node));
  await page.getByRole("button", { name: "界面设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "界面设置", exact: true });
  const settingsId = await settings.getAttribute("id");
  const scoped = page.locator(`[id="${settingsId}"]`);
  await scoped.locator('select[name="locale"]').selectOption("en");
  await scoped.locator("button.om-button--primary").click();
  await scoped.getByRole("status").filter({ hasText: "Interface settings saved and synchronized" }).waitFor();
  await page.keyboard.press("Escape");
  // Stable native input is identified by the held node rather than translated label assumptions.
  if (!durationNode) throw Error("missing retained duration input");
  expect(await durationNode.inputValue()).toBe("0");
  expect(await durationNode.getAttribute("aria-invalid")).toBe("true");
  const durationError = page.locator(`[id="${await durationNode.getAttribute("aria-errormessage")}"]`);
  expect(await durationError.innerText()).toBe("Enter a number greater than 0.");
  expect(await page.evaluate(() => Reflect.get(window, "validationFrame") === document.querySelector("iframe"))).toBe(
    true,
  );
  await invalidSave("Apply changes", "Check the marked fields.");
  await durationNode.fill("");
  await invalidSave("Save", "Check the marked fields.");
  expect(await durationError.innerText()).toBe("Enter a valid number.");
  await durationNode.fill("3");
  await page.getByLabel("Font size", { exact: true }).fill("0");
  await invalidSave("Apply changes", "Check the marked fields.");
  const englishFont = page.getByLabel("Font size", { exact: true });
  await englishFont.fill("48");
  await page.getByText("Appearance and static transform", { exact: true }).click();
  const color = page.getByLabel("Text color", { exact: true });
  await color.fill("red");
  await invalidSave("Apply changes", "Check the marked fields.");
  expect(await (await errorOf(color)).innerText()).toBe("Enter a color in #RRGGBB format.");
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await color.scrollIntoViewIfNeeded();
  await driver.capture("english-narrow-invalid-color");
  await color.fill("#123456");
  await page.getByLabel("Opacity", { exact: true }).fill("1.2");
  await invalidSave("Apply changes", "Check the marked fields.");
  await page.getByLabel("Opacity", { exact: true }).fill("0.5");
  page.off("request", observe);
  await page.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page
    .locator("[aria-live]")
    .filter({ hasText: /^Ready$/ })
    .waitFor();
  const saved = await client.execute("project_read", owner);
  expect(saved.revision).not.toBe(original.revision);
  expect(saved.files[0]?.content).toContain("#123456");
  expect(saved.files[0]?.content).toContain('data-duration="3"');
  expect(saved.history.version).toBe(original.history.version + 1);
  expect(await durationError.isVisible()).toBe(false);
  await page.reload();
  await page
    .locator("[aria-live]")
    .filter({ hasText: /^Ready$/ })
    .waitFor();
  expect(await client.execute("project_read", owner)).toEqual(saved);
  page.on("request", observe);
  await page.getByLabel("Select layer", { exact: true }).selectOption("title");
  await page
    .locator("[aria-live]")
    .filter({ hasText: /^Ready$/ })
    .waitFor();
  await page.getByText("Keyframe animation", { exact: true }).click();
  await page.getByLabel("Animation property", { exact: true }).selectOption("x");
  const animationDuration = page.getByLabel("Animation duration seconds", { exact: true });
  await animationDuration.fill("0");
  await invalidSave("Save animation", "Check the marked fields.", saved);
  expect(await (await errorOf(animationDuration)).innerText()).toBe("Enter a number greater than 0.");
  await animationDuration.fill("2");
  const frameValue = page.getByLabel("Keyframe 2 value", { exact: true });
  await frameValue.fill("70000");
  await invalidSave("Save animation", "Check the marked fields.", saved);
  expect(await (await errorOf(frameValue)).innerText()).toContain("65,536");
  await page.getByRole("button", { name: "Discard animation draft", exact: true }).click();
  page.off("request", observe);
  expect(driver.errors).toEqual([]);
  report.acceptance = {
    invalidWrites: writes,
    originalRevision: original.revision,
    savedRevision: saved.revision,
    historySteps: 1,
    retainedFrame: true,
    reloaded: true,
  };
}, 60000);
