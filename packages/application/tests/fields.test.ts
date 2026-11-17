import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { browser } from "@odsuite/automation";
import { open } from "@odsuite/installer";
import { inspect, npm } from "@odsuite/pack";
import { channel, namespace } from "@odsuite/protocol";
import { bundle, resolve as release, releaseChannel } from "@odsuite/release";
import { observeProcesses, readDirectory } from "@odsuite/sidecar";
import { Client } from "@open-motion/daemon/client";
import { expect, it } from "vitest";
import { hash } from "@/contract.js";

const run = promisify(execFile);
async function fixture() {
  const evidence = resolve("../../.artifacts/installed-fields", randomUUID()),
    root = await realpath(await mkdtemp(join(tmpdir(), "openmotion-fields-")));
  await mkdir(evidence, { recursive: true });
  const files: Record<string, string | Uint8Array> = {},
    carriers: Record<string, unknown> = {};
  let version = "",
    lane = "";
  for (const carrier of ["standalone", "codexplugin"]) {
    const bytes = await bundle(resolve(`../../carriers/${carrier}/dist/runtime`)),
      identity = inspect(bytes);
    if (version && identity.version !== version) throw Error("carrier version mismatch");
    version = identity.version;
    lane = identity.channel;
    files[`payload/${carrier}.bundle`] = bytes;
    carriers[carrier] = { file: `${carrier}.bundle`, bytes: bytes.length, sha256: hash(bytes) };
  }
  const product = { appid: "io.openmotion.app", name: "open-motion", scheme: "open-motion" };
  files["payload/manifest.json"] = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      product,
      release: release({}, { version, channel: releaseChannel(lane) }, product),
      namespace: "journey",
      carriers,
    }),
  );
  for (const name of ["main.mjs", "codex-worker.mjs", "LICENSE", "NOTICE"])
    files[`dist/${name}`] = resolve("dist", name);
  const archive = await npm({
    name: "@openmotion/app",
    version,
    license: "Apache-2.0",
    bin: { odsuite: "dist/main.mjs" },
    files,
    output: join(evidence, "application.tgz"),
  });
  const home = join(root, "installation"),
    data = join(root, "data", lane, "journey"),
    scope = { channel: channel(lane), namespace: namespace("journey") };
  const command = async (args: string[]) => {
    const result = await run(
      "npm",
      [
        "exec",
        "--yes",
        "--ignore-scripts",
        "--cache",
        join(root, "npm-cache"),
        "--package",
        archive.path,
        "--",
        "odsuite",
        ...args,
        "--home",
        home,
        "--data",
        join(root, "data"),
        "--channel",
        lane,
        "--namespace",
        "journey",
      ],
      { cwd: root, timeout: 60000, maxBuffer: 1024 ** 2, env: { ...process.env, npm_config_update_notifier: "false" } },
    );
    const response = JSON.parse(result.stdout);
    if (!response.ok) throw Error(result.stdout);
    return response.result;
  };
  await writeFile(
    join(evidence, "fixture.json"),
    JSON.stringify({ root, home, data, scope, version, archive }, null, 2),
  );
  return { root, evidence, archive, home, data, scope, version, command };
}

/** Exercise the installed Web's actual validation boundary, then discard its uncommitted draft by reload. */
async function invalidFields(driver: Awaited<ReturnType<typeof browser>>, read: () => Promise<unknown>) {
  const page = driver.page,
    before = await read(),
    writes: string[] = [];
  const observe = (request: { url(): string }) => {
    if (/\/(motion\/patch|api\/project_save)$/.test(request.url())) writes.push(request.url().split("/").at(-1) ?? "");
  };
  const ready = () =>
    page
      .locator("[aria-live]")
      .filter({ hasText: /^就绪$/ })
      .waitFor();
  const select = page.getByLabel("图层选择", { exact: true });
  const value = await select.locator("option").last().getAttribute("value");
  if (!value) throw Error("missing installed editable layer");
  await select.selectOption(value);
  await ready();
  page.on("request", observe);
  try {
    const duration = page.getByLabel("持续秒", { exact: true });
    await duration.fill("0");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page
      .locator("[aria-live]")
      .filter({ hasText: /^请检查标记的字段。$/ })
      .waitFor();
    expect(await duration.getAttribute("aria-invalid")).toBe("true");
    const error = page.locator(`[id="${await duration.getAttribute("aria-errormessage")}"]`);
    expect(await error.innerText()).toBe("请输入大于 0 的数值。");
    expect(await read()).toEqual(before);
    expect(writes).toEqual([]);
    await driver.capture("installed-invalid-field");
  } finally {
    page.off("request", observe);
  }
  await page.reload();
  await ready();
  expect(await read()).toEqual(before);
}

it("rejects invalid fields in the actual relocated npm kit before transforms or writes and preserves the committed project on reload", async () => {
  const f = await fixture();
  let driver: Awaited<ReturnType<typeof browser>> | undefined;
  try {
    await f.command(["setup", "--carrier", "standalone"]);
    const started: { runtime: { web: string } } = await f.command(["start"]),
      config = (await (await fetch(new URL("bootstrap.json", started.runtime.web))).json()) as {
        daemon: string;
        token: string;
      },
      client = new Client(config.daemon, config.token),
      session = await client.execute("session_create", {
        requestId: randomUUID(),
        title: "Installed fields",
        mode: "motion",
      }),
      artifact = await client.execute("artifact_create", {
        requestId: randomUUID(),
        sessionId: session.id,
        title: "Committed fields",
        files: [
          {
            path: "index.html",
            content:
              '<html><body><main data-composition-id="main" data-width="160" data-height="90" data-duration="5"><p data-hf-id="title" data-start="0" data-duration="4">Committed</p></main><script>window.__timelines={main:gsap.timeline({paused:true}).to({},{duration:5})};</script></body></html>',
          },
        ],
      }),
      owner = { sessionId: session.id, artifactId: artifact.id };
    await client.execute("artifact_open", {
      ...owner,
      requestId: randomUUID(),
      expectedSelection: 0,
      expectedCurrent: null,
    });
    driver = await browser({ evidence: f.evidence, viewport: { width: 1440, height: 1000 } });
    await driver.page.goto(started.runtime.web);
    await driver.page.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
    await invalidFields(driver, () => client.execute("project_read", owner));
    expect(driver.errors).toEqual([]);
    await writeFile(
      join(f.evidence, "result.json"),
      JSON.stringify(
        {
          version: f.version,
          archive: f.archive,
          originalRevision: (await client.execute("project_read", owner)).revision,
          invalidWrites: 0,
          reloaded: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await driver?.close();
    await f.command(["stop"]);
  }
  expect((await readDirectory(f.data)).manager.phase).toBe("closed");
  expect(await observeProcesses(f.data)).toEqual([]);
  const installation = await open({ home: f.home, product: "io.openmotion.app", scope: f.scope });
  try {
    expect((await installation.uses()).every((use) => use.state === "retired")).toBe(true);
  } finally {
    await installation.close();
  }
  const authority = join(f.home, "authority", "io.openmotion.app");
  expect((await readDirectory(authority)).manager.phase).toBe("closed");
  expect(await observeProcesses(authority)).toEqual([]);
}, 120000);
