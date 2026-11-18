import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { browser, imageDifference } from "@odsuite/automation";
import { open } from "@odsuite/installer";
import { channel, namespace } from "@odsuite/protocol";
import { observeProcesses, readDirectory } from "@odsuite/sidecar";
import type { Input, Operation, Output } from "@open-motion/daemon/contract";
import { nativeTools } from "@open-motion/render/tools";
import type { Status } from "@open-motion/standalone";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const source =
  '<html><body><main data-composition-id="main" data-width="160" data-height="90" data-duration="2"><p id="caption" data-hf-id="caption" data-start="0" data-duration="2">Round one</p><svg width="160" height="40"><rect id="box" width="24" height="24" fill="blue"/></svg></main><script>const tl=gsap.timeline({paused:true});tl.fromTo("#box",{attr:{x:0}},{attr:{x:100},duration:2,ease:"none"});window.__timelines={main:tl};</script></body></html>';

// Explicit native qualification includes cold public-tool preparation. Ordinary source CI must not imply it ran.
it.runIf(process.env.OPEN_MOTION_NATIVE_HANDOFF === "1")(
  "continues two installed SDK/Web film rounds and reads immutable MP4s through a real browser player",
  async () => {
    if (!nativeTools()) throw Error("native handoff requires the qualified macOS arm64 tool manifest");
    const repository = await realpath(resolve("../..")),
      evidence = join(repository, ".artifacts", "installed-handoff", randomUUID()),
      root = await realpath(await mkdtemp(join(tmpdir(), "openmotion-handoff-"))),
      home = join(root, "installation"),
      scope = { channel: channel("stable"), namespace: namespace("handoff") },
      data = join(root, "data", scope.channel, scope.namespace);
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "fixture.json"), JSON.stringify({ root, home, data, scope }));
    const pipeline = async (operation: "build" | "pack") => {
      const result = await execute("pnpm", ["exec", "odsuite", operation, "--channel", scope.channel], {
        cwd: repository,
        timeout: 120000,
        maxBuffer: 4 * 1024 ** 2,
      });
      await writeFile(join(evidence, `${operation}.log`), result.stdout + result.stderr);
      // The public build command forwards compiler logs before its final JSON receipt.
      return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "");
    };
    const built = await pipeline("build"),
      kit = await pipeline("pack"),
      archive = resolve(repository, kit.npm.path);
    expect(kit.source).toBe(built.source);
    expect(kit.fingerprint).toBe(built.fingerprint);
    expect(digest(await readFile(archive))).toBe(`sha256:${kit.npm.sha256}`);
    const command = async (args: string[], timeout = 60000) => {
      const result = await execute(
        "npm",
        [
          "exec",
          "--yes",
          "--ignore-scripts",
          "--cache",
          join(root, "npm-cache"),
          "--package",
          archive,
          "--",
          "odsuite",
          ...args,
          "--home",
          home,
          "--data",
          join(root, "data"),
          "--channel",
          scope.channel,
          "--namespace",
          scope.namespace,
        ],
        {
          cwd: root,
          timeout,
          maxBuffer: 1024 ** 2,
          env: { ...process.env, npm_config_update_notifier: "false" },
        },
      );
      const response = JSON.parse(result.stdout);
      if (!response.ok) throw Error("installed operator command failed");
      return response.result;
    };
    let driver: Awaited<ReturnType<typeof browser>> | undefined,
      client: Client | undefined,
      transport: StdioClientTransport | undefined,
      failure: unknown;
    const cleanupErrors: unknown[] = [],
      report: Record<string, unknown> = {
        source: kit.source,
        version: kit.version,
        kit: { digest: kit.npm.sha256, bytes: kit.npm.bytes },
        hostDisplay: "unverified; isolated SDK/headless browser harness only",
      };
    const attach = async (receipt: { path: string; requestId: string }) => {
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(receipt.path, "main.mjs")],
        cwd: root,
        env: {
          OPEN_MOTION_ROOT: data,
          OPEN_MOTION_CHANNEL: scope.channel,
          OPEN_MOTION_NAMESPACE: scope.namespace,
          OPEN_MOTION_INSTALLATION_HOME: home,
          OPEN_MOTION_INSTALLATION_PRODUCT: "io.openmotion.app",
          OPEN_MOTION_INSTALLATION_REQUEST: receipt.requestId,
          NODE_PATH: "",
        },
        stderr: "pipe",
      });
      transport.stderr?.on("data", () => {});
      client = new Client({ name: "installed-film-verifier", version: "1.0.0" });
      await client.connect(transport);
      expect(client.getServerVersion()?.version).toBe(kit.version);
    };
    const disconnect = async () => {
      try {
        await client?.close();
      } finally {
        await transport?.close();
      }
      client = undefined;
      transport = undefined;
    };
    const connected = () => {
      if (!client) throw Error("MCP fixture is disconnected");
      return client;
    };
    const call = async <K extends Operation>(name: K, input: Input<K>): Promise<Output<K>> => {
      const result = await connected().callTool({ name, arguments: input });
      if (result.isError) throw Error(`installed ${name} rejected`);
      return result.structuredContent as unknown as Output<K>;
    };
    try {
      const installed = await command(["setup", "--carrier", "standalone"]);
      // 160 MiB of three pinned cold archives plus tree verification; product loader deadlines are unchanged.
      expect((await command(["prepare"], 180000)).state).toBe("ready");
      expect((await readDirectory(data)).manager.phase).toBe("closed");
      expect(await observeProcesses(data)).toEqual([]);
      const started: { runtime: Status } = await command(["start"]);
      await attach(installed.receipts.codexplugin);
      const session = await call("session_create", {
          requestId: randomUUID(),
          title: "Two film rounds",
          mode: "motion",
        }),
        artifact = await call("artifact_create", {
          requestId: randomUUID(),
          sessionId: session.id,
          title: "Installed film",
          files: [{ path: "index.html", content: source }],
        }),
        owner = { sessionId: session.id, artifactId: artifact.id },
        initial = await call("project_read", owner);
      const entry = await connected().callTool({
        name: "project_entry",
        arguments: { ...owner, expectedRevision: initial.revision, expectedHistory: initial.history.version },
      });
      expect(entry.isError).not.toBe(true);
      const handoff = entry.structuredContent as { url: string; display: string };
      expect(handoff.display).toBe("unverified");
      expect(new URL(handoff.url).origin).toBe(new URL(started.runtime.web).origin);
      driver = await browser({ evidence, viewport: { width: 1440, height: 1000 } });
      const editor = driver.page;
      editor.setDefaultTimeout(10000);
      await editor.goto(handoff.url);
      const ready = () =>
        editor
          .locator("[aria-live]")
          .filter({ hasText: /^就绪$/ })
          .waitFor();
      await ready();
      await editor.getByLabel("预览状态", { exact: true }).filter({ hasText: "预览就绪" }).waitFor();
      await expect.poll(() => editor.frameLocator("iframe:not([hidden])").locator("p").textContent()).toBe("Round one");
      const film = async (revision: string, label: string) => {
        const input = { ...owner, revision, requestId: randomUUID(), fps: { num: 12, den: 1 } },
          created = await call("export_create", input);
        expect(await call("export_create", input)).toEqual(created);
        await expect
          .poll(async () => (await call("export_read", { ...owner, id: created.id })).state, { timeout: 90000 })
          .toBe("succeeded");
        const job = await call("export_read", { ...owner, id: created.id });
        expect(job.result?.verification.frames).toBe(24);
        const ticket = await call("export_download", { ...owner, id: job.id }),
          response = await fetch(ticket.url),
          bytes = Buffer.from(await response.arrayBuffer());
        expect(response.status).toBe(200);
        expect(bytes.length).toBe(ticket.bytes);
        expect(digest(bytes)).toBe(ticket.digest);
        expect(ticket.film).toEqual({ ...job.result, jobId: job.id, attempt: job.attempt });
        await writeFile(join(evidence, `${label}.mp4`), bytes);
        return { job, ticket };
      };
      const first = await film(initial.revision, "first"),
        player = await editor.context().newPage();
      const playerErrors: string[] = [];
      player.on("pageerror", (error) => playerErrors.push(error.name));
      await player.setContent('<main aria-label="Isolated media verification"></main>');
      expect(
        await player.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"')),
      ).not.toBe("");
      let allowMedia = false;
      await player.route("**/exports/files/**", (route) => (allowMedia ? route.continue() : route.abort("failed")));
      const mount = async (id: string, url: string) =>
        player.evaluate(
          ({ id, url }) => {
            const video = document.createElement("video");
            video.id = id;
            video.controls = true;
            video.muted = true;
            video.preload = "auto";
            document.body.append(video);
            video.src = url;
          },
          { id, url },
        );
      await mount("first", first.ticket.playbackUrl);
      await player.waitForFunction(() => !!(document.getElementById("first") as HTMLVideoElement).error);
      expect(await call("export_read", { ...owner, id: first.job.id })).toEqual(first.job);
      allowMedia = true;
      const renewed = await call("export_download", { ...owner, id: first.job.id });
      expect(renewed.film).toEqual(first.ticket.film);
      await player.evaluate((url) => {
        const video = document.getElementById("first") as HTMLVideoElement;
        video.src = url;
        video.load();
      }, renewed.playbackUrl);
      const playable = async (id: string) => {
        await player.waitForFunction((id) => {
          const v = document.getElementById(id) as HTMLVideoElement;
          return !v.error && v.readyState >= 2 && v.videoWidth === 160 && v.videoHeight === 90 && v.duration > 0;
        }, id);
        expect(
          await player.evaluate((id) => (document.getElementById(id) as HTMLVideoElement).duration, id),
        ).toBeCloseTo(2, 1);
      };
      const seek = async (id: string, time: number) => {
        await player.evaluate(
          ({ id, time }) => {
            const v = document.getElementById(id) as HTMLVideoElement;
            v.pause();
            v.currentTime = time;
          },
          { id, time },
        );
        await player.waitForFunction(
          ({ id, time }) => {
            const v = document.getElementById(id) as HTMLVideoElement;
            return !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - time) < 0.05;
          },
          { id, time },
        );
      };
      const replay = async (id: string) => {
        await seek(id, 0);
        await player.evaluate((id) => (document.getElementById(id) as HTMLVideoElement).play(), id);
        await player.waitForFunction((id) => (document.getElementById(id) as HTMLVideoElement).currentTime > 0.15, id);
        await player.evaluate((id) => (document.getElementById(id) as HTMLVideoElement).pause(), id);
      };
      const frame = async (id: string, label: string) => {
        await seek(id, 0.5);
        await player.evaluate((id) => {
          (document.getElementById(id) as HTMLVideoElement).controls = false;
        }, id);
        const bytes = await player.locator(`#${id}`).screenshot();
        await writeFile(join(evidence, `${label}.png`), bytes);
        await player.evaluate((id) => {
          (document.getElementById(id) as HTMLVideoElement).controls = true;
        }, id);
        return bytes;
      };
      await playable("first");
      await seek("first", 0.5);
      await seek("first", 1.5);
      await replay("first");
      const firstFrame = await frame("first", "first-frame");
      await editor.getByLabel("图层选择", { exact: true }).selectOption("caption");
      await ready();
      await editor.getByLabel("文本内容", { exact: true }).fill("Round two");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await ready();
      const secondSource = await call("project_read", owner);
      expect(secondSource.revision).not.toBe(initial.revision);
      expect(secondSource.files[0]?.content).toContain("Round two");
      await editor.reload();
      await ready();
      await expect.poll(() => editor.frameLocator("iframe:not([hidden])").locator("p").textContent()).toBe("Round two");
      const second = await film(secondSource.revision, "second");
      expect(second.ticket.digest).not.toBe(first.ticket.digest);
      await mount("second", second.ticket.playbackUrl);
      await playable("second");
      await seek("second", 1.5);
      await replay("second");
      const changedFrame = imageDifference(firstFrame, await frame("second", "second-frame"));
      expect(changedFrame.changed).toBeGreaterThan(0);
      await replay("first");
      const afterSecond = imageDifference(firstFrame, await frame("first", "first-after-second"));
      expect(afterSecond.changed).toBe(0);
      expect(digest(Buffer.from(await (await fetch(first.ticket.url)).arrayBuffer()))).toBe(first.ticket.digest);
      expect(await call("export_read", { ...owner, id: first.job.id })).toEqual(first.job);
      expect((await call("project_snapshot", { ...owner, revision: initial.revision })).files).toEqual(initial.files);
      expect((await call("export_list", owner)).jobs.map((j) => j.id).sort()).toEqual(
        [first.job.id, second.job.id].sort(),
      );
      await disconnect();
      await command(["stop"]);
      expect((await readDirectory(data)).manager.phase).toBe("closed");
      expect(await observeProcesses(data)).toEqual([]);
      await command(["start"]);
      await attach(installed.receipts.codexplugin);
      expect((await call("project_read", owner)).revision).toBe(secondSource.revision);
      expect(await call("export_read", { ...owner, id: first.job.id })).toEqual(first.job);
      const cold = await call("export_download", { ...owner, id: first.job.id });
      expect(cold.film).toEqual(first.ticket.film);
      expect(digest(Buffer.from(await (await fetch(cold.url)).arrayBuffer()))).toBe(first.ticket.digest);
      await player.evaluate((url) => {
        const v = document.getElementById("first") as HTMLVideoElement;
        v.src = url;
        v.load();
      }, cold.playbackUrl);
      await playable("first");
      await seek("first", 1.5);
      await replay("first");
      const retainedFrame = imageDifference(firstFrame, await frame("first", "first-after-cold"));
      expect(retainedFrame.changed).toBe(0);
      expect((await call("export_list", owner)).jobs).toHaveLength(2);
      expect(await call("export_read", { ...owner, id: second.job.id })).toEqual(second.job);
      expect(playerErrors).toEqual([]);
      expect(driver.errors).toEqual([]);
      Object.assign(report, {
        owner,
        revisions: [initial.revision, secondSource.revision],
        films: [first.ticket.film, second.ticket.film],
        browserPlayback: ["load", "seek", "replay", "explicit failed-read recovery", "cold renewal"],
        renders: 2,
        originalFilmPreserved: true,
        decodedFrames: { changedFrame, afterSecond, retainedFrame },
      });
    } catch (error) {
      failure = error;
      await driver?.capture("handoff-failure").catch(() => undefined);
    } finally {
      for (const result of await Promise.allSettled([driver?.close(), disconnect()]))
        if (result.status === "rejected") cleanupErrors.push(result.reason);
      try {
        await command(["stop"]);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        const installation = await open({ home, product: "io.openmotion.app", scope });
        try {
          expect((await installation.uses()).every((use) => use.state === "retired")).toBe(true);
        } finally {
          await installation.close();
        }
        expect(await observeProcesses(data)).toEqual([]);
        const authority = join(home, "authority", "io.openmotion.app");
        expect((await readDirectory(authority)).manager.phase).toBe("closed");
        expect(await observeProcesses(authority)).toEqual([]);
        report.closed = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
      report.success = !failure && cleanupErrors.length === 0;
      report.cleanupErrors = cleanupErrors.map((error) => (error instanceof Error ? error.name : "unknown"));
      await writeFile(join(evidence, "result.json"), JSON.stringify(report, null, 2));
    }
    if (failure || cleanupErrors.length)
      throw new AggregateError(
        [...(failure ? [failure] : []), ...cleanupErrors],
        "installed native handoff or drain failed",
      );
  },
  480000,
);
