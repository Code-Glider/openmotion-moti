// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@odsuite/automation";
import { channel, digest, namespace } from "@odsuite/protocol";
import { source } from "@odsuite/serve";
import { serve as manage, managerEndpoint, observeProcesses, readDirectory } from "@odsuite/sidecar";
import { serve as daemonServe } from "@open-motion/daemon";
import { Client } from "@open-motion/daemon/client";
import { entryFragment } from "@open-motion/daemon/contract";
import { initialFiles } from "@open-motion/workspace/contract";
import { expect, it } from "vitest";
import type { Config } from "@";

it("keeps embedded theme choices separate through media changes, unknown receipts and a cold new-origin reopen", async () => {
  const repo = fileURLToPath(new URL("../../../../", import.meta.url)),
    evidence = join(repo, ".artifacts", "embedded-theme", randomUUID()),
    root = join(evidence, "sidecar"),
    report: Record<string, unknown> = { reference: "cb33185d1f7d66e3f406b14b0e1054365d29aa70" };
  await mkdir(evidence, { recursive: true });
  let manager: Awaited<ReturnType<typeof manage>> | undefined, driver: Awaited<ReturnType<typeof browser>> | undefined;
  const start = async () => {
    manager = await manage(managerEndpoint(root), { root });
    const factory = manager.factory({ channel: channel("dev"), namespace: namespace("embedded-theme") });
    let bootstrap: Config | undefined,
      daemon: Awaited<ReturnType<typeof daemonServe>> | undefined,
      capability: Awaited<ReturnType<typeof factory.issue>> | undefined;
    const web = await source(factory, {
      name: "web",
      directory: join(repo, "apps/web/dist"),
      documents: {
        "/bootstrap.json": () => {
          if (!bootstrap) throw Error("fixture not ready");
          return { type: "application/json", body: JSON.stringify(bootstrap) };
        },
      },
    });
    await factory.expose({
      identity: { service: "daemon", generation: digest("embedded-theme") },
      handlers: {},
      lifecycle: {
        initialize: async (context) => {
          const socket = await context.allocate({ kind: "socket", name: "daemon" }),
            port = await context.allocate({ kind: "port", name: "daemon", scheme: "http" });
          capability = await factory.issue({ owner: `n${context.incarnation.replaceAll("-", "")}`, service: "daemon" });
          daemon = await daemonServe({
            data: context.roots.data,
            origin: web.endpoint.url,
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
    if (!bootstrap) throw Error("bootstrap missing");
    return { url: web.endpoint.url, client: new Client(bootstrap.daemon, bootstrap.token) };
  };
  try {
    let { url, client } = await start();
    const initial = await client.execute("workspace_preferences", {});
    expect(initial.value).toMatchObject({ theme: "light", embeddedTheme: "system" });
    await client.execute("workspace_configure", {
      requestId: randomUUID(),
      expectedVersion: initial.version,
      value: { theme: "dark", layout: "edit", locale: "zh-CN" },
    });
    const session = await client.execute("session_create", {
        requestId: randomUUID(),
        title: "Embedded themes",
        mode: "motion",
      }),
      artifact = await client.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Embedded themes",
        files: initialFiles(),
      }),
      owner = { sessionId: session.id, artifactId: artifact.id },
      content = await client.execute("project_read", owner),
      entry = await client.execute("project_entry", {
        ...owner,
        expectedRevision: content.revision,
        expectedHistory: content.history.version,
      });
    driver = await browser({ evidence, viewport: { width: 1440, height: 1000 } });
    const page = driver.page;
    page.setDefaultTimeout(10000);
    const ready = () =>
        page
          .locator("[aria-live]")
          .filter({ hasText: /^就绪$/ })
          .waitFor(),
      previewReady = () => page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor(),
      settings = page.getByRole("dialog", { name: "界面设置", exact: true }),
      theme = settings.getByRole("combobox", { name: "主题", exact: true }),
      open = () => page.getByRole("button", { name: "界面设置", exact: true }).click(),
      save = async () => {
        await settings.getByRole("button", { name: "应用并保存界面", exact: true }).click();
        await settings.getByRole("status").filter({ hasText: "界面设置已保存并同步" }).waitFor();
      },
      shown = (value: string) => expect.poll(() => page.locator("#app").getAttribute("data-om-theme")).toBe(value);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${url}?embed=1${entryFragment(entry)}`);
    await ready();
    await previewReady();
    await shown("light");
    const frame = page.locator("iframe:not([hidden])");
    await frame.evaluate((node) => Reflect.set(window, "embeddedPreferenceFrame", node));
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const code = page.getByRole("textbox", { name: "index.html", exact: true }),
      draft = `${await code.inputValue()}\n<!-- unsaved embedded draft -->`,
      before = await client.execute("workspace_observe", {}),
      versions = await client.execute("project_versions", owner);
    await code.fill(draft);
    await open();
    await expect.poll(() => theme.isEnabled()).toBe(true);
    expect(await theme.inputValue()).toBe("system");
    for (const [choice, media, expected] of [
      ["dark", "light", "dark"],
      ["light", "dark", "light"],
      ["system", "dark", "dark"],
    ] as const) {
      await theme.selectOption(choice);
      await save();
      await page.emulateMedia({ colorScheme: media });
      await shown(expected);
      expect((await client.execute("workspace_preferences", {})).value).toMatchObject({
        theme: "dark",
        embeddedTheme: choice,
      });
      expect(await code.inputValue()).toBe(draft);
      expect(await frame.evaluate((node) => Reflect.get(window, "embeddedPreferenceFrame") === node)).toBe(true);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await shown("light");
    await page.keyboard.press("Escape");
    await driver.capture("embedded-system-light");
    let lose = true;
    const requests: unknown[] = [];
    await page.route("**/api/workspace_configure", async (route) => {
      requests.push(route.request().postDataJSON());
      if (lose) {
        lose = false;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await open();
    await theme.selectOption("dark");
    await settings.getByRole("button", { name: "应用并保存界面", exact: true }).click();
    await settings.getByRole("status").filter({ hasText: "保存结果未确认" }).waitFor();
    const committed = await client.execute("workspace_preferences", {});
    const later = await client.execute("workspace_configure", {
      requestId: randomUUID(),
      expectedVersion: committed.version,
      value: { theme: "light", layout: "edit", locale: "zh-CN" },
    });
    expect(later.value.embeddedTheme).toBe("dark");
    await page.keyboard.press("Escape");
    await open();
    await settings.getByRole("button", { name: "确认原界面保存", exact: true }).click();
    await settings.getByRole("status").filter({ hasText: "界面设置已保存并同步" }).waitFor();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await page.unroute("**/api/workspace_configure");
    await shown("dark");
    expect(await theme.inputValue()).toBe("dark");
    await page.keyboard.press("Escape");
    expect(await code.inputValue()).toBe(draft);
    expect(await frame.evaluate((node) => Reflect.get(window, "embeddedPreferenceFrame") === node)).toBe(true);
    expect(await client.execute("workspace_observe", {})).toEqual(before);
    expect(await client.execute("project_read", owner)).toEqual(content);
    expect(await client.execute("project_versions", owner)).toEqual(versions);
    await driver.capture("embedded-explicit-dark");
    const oldOrigin = new URL(url).origin;
    await page.goto("about:blank");
    await manager?.close();
    expect((await readDirectory(root)).manager.phase).toBe("closed");
    expect(await observeProcesses(root)).toEqual([]);
    ({ url, client } = await start());
    expect(new URL(url).origin).not.toBe(oldOrigin);
    await page.goto(`${url}?embed=1${entryFragment(entry)}`);
    await ready();
    await previewReady();
    await shown("dark");
    expect(await client.execute("workspace_preferences", {})).toEqual(later);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(new URL(entryFragment(entry), url).href);
    await ready();
    await previewReady();
    await shown("light");
    await open();
    await expect.poll(() => theme.isEnabled()).toBe(true);
    expect(await theme.inputValue()).toBe("light");
    expect(await client.execute("workspace_preferences", {})).toEqual(later);
    expect(await client.execute("project_read", owner)).toEqual(content);
    report.success = true;
    report.preferences = later;
    report.exactRetry = requests.length;
    report.coldOriginChanged = true;
    report.contentRevision = content.revision;
    report.versionId = versions.current.id;
  } catch (error) {
    report.failure = String(error)
      .replace(/https?:\/\/\S+/g, "[url]")
      .slice(0, 2000);
    await driver?.capture("embedded-theme-failure").catch(() => undefined);
    throw error;
  } finally {
    try {
      await driver?.close();
    } finally {
      await manager?.close();
    }
    report.manager = (await readDirectory(root)).manager.phase;
    report.processes = await observeProcesses(root);
    report.errors = driver?.errors ?? [];
    await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
    expect(report.manager).toBe("closed");
    expect(report.processes).toEqual([]);
    expect(report.errors).toEqual([]);
  }
}, 90000);
