// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, imageDifference } from "@odsuite/automation";
import { runtimeProtocolMetadata } from "@open-motion/motion/protocol";
import type { Project } from "@open-motion/workspace/contract";
import { build } from "esbuild";
import { expect, it } from "vitest";
import type { Client } from "@";
import type { NativePreview } from "@/lib/components/preview.js";

it("lets an unpresented candidate paint before its native handshake while retaining the confirmed frame", async () => {
  const repo = fileURLToPath(new URL("../../../../../", import.meta.url)),
    evidence = join(repo, ".artifacts", "preview-readiness", randomUUID());
  await mkdir(evidence, { recursive: true });
  const script = await build({
    entryPoints: [join(repo, "apps/web/src/lib/components/preview.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "PreviewSubject",
    write: false,
  });
  const compiled = script.outputFiles[0];
  if (!compiled) throw Error("preview fixture bundle is missing");
  const driver = await browser({ evidence, viewport: { width: 1000, height: 800 } }),
    page = driver.page,
    report: Record<string, unknown> = {};
  try {
    await page.route("https://preview.invalid/", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
    );
    await page.goto("https://preview.invalid/");
    // A protocol peer waits for three actual paints, as the native readiness inputs may do.
    // This is a browser/component regression, not separate native-engine or host acceptance.
    await page.route("https://preview.invalid/preview-probe/*", async (route) => {
      const revision = new URL(route.request().url()).pathname.split("/").at(-1);
      await route.fulfill({
        contentType: "text/html",
        body: `<p>${revision}</p><script>
let frames=0;function paint(){parent.postMessage({probe:true,revision:${JSON.stringify(revision)},frames:++frames},'*');if(frames<3)requestAnimationFrame(paint)}requestAnimationFrame(paint);
addEventListener('message',event=>{if(event.source!==parent||!event.data?.release)return;
parent.postMessage({source:'hf-preview',type:'timeline',durationSeconds:1,...${JSON.stringify(runtimeProtocolMetadata(30))}},'*');
parent.postMessage({source:'open-motion-fonts',protocolVersion:1,ready:!event.data.fail},'*');});
</script>`,
      });
    });
    await page.addStyleTag({ path: join(repo, "packages/theme/dist/style.css") });
    await page.addStyleTag({ path: join(repo, "packages/components/dist/style.css") });
    await page.addScriptTag({ content: compiled.text });
    await page.evaluate(() => {
      const { NativePreview: Preview } = Reflect.get(window, "PreviewSubject") as {
          NativePreview: typeof NativePreview;
        },
        host = document.createElement("div"),
        state = {
          frames: {} as Record<string, number>,
          ready: 0,
          failures: [] as string[],
          closed: [] as string[],
          scopes: 0,
        };
      host.className = "om-slot om-slot--stage";
      host.id = "preview-subject";
      document.body.append(host);
      let current: Project;
      const preview = new Preview(
        host,
        {
          preview: async (project: Project) => ({
            id: project.revision,
            revision: project.revision,
            url: `https://preview.invalid/preview-probe/${project.revision}`,
          }),
          closePreview: async (id: string) => {
            state.closed.push(id);
          },
          closePreviews: async () => {
            state.scopes++;
          },
        } as unknown as Client,
        () => current,
        {
          message: () => {},
          ready: () => {
            state.ready++;
          },
          time: () => {},
          select: () => {},
        },
      );
      window.addEventListener("message", (event) => {
        if (event.data?.probe) state.frames[event.data.revision] = event.data.frames;
      });
      Reflect.set(window, "previewProbe", {
        state,
        preview,
        start(revision: string, fonts: boolean) {
          current = {
            artifactId: "artifact",
            revision,
            resources: fonts ? [{ type: "font/ttf" }] : [],
          } as unknown as Project;
          void preview.open(current).catch((error) => state.failures.push(error.message));
        },
      });
    });
    const start = (revision: string, fonts = false) =>
      page.evaluate(
        ({ revision, fonts }) => {
          Reflect.get(window, "previewProbe").start(revision, fonts);
        },
        { revision, fonts },
      );
    const state = () => page.evaluate(() => Reflect.get(window, "previewProbe").state);
    const release = (fail = false) =>
      page.locator("iframe[hidden]").evaluate((node, fail) => {
        (node as HTMLIFrameElement).contentWindow?.postMessage({ release: true, fail }, "*");
      }, fail);
    const pending = () =>
      page.locator("iframe[hidden]").evaluate((node) => {
        const parent = node.closest<HTMLElement>(".om-preview__canvas");
        if (!parent) throw Error("candidate viewport is missing");
        return {
          opacity: getComputedStyle(parent).opacity,
          inert: parent.inert,
          ariaHidden: parent.getAttribute("aria-hidden"),
          display: getComputedStyle(node).display,
        };
      });
    await start("one");
    await expect.poll(async () => (await state()).frames.one, { timeout: 2000 }).toBe(3);
    expect(await state()).toMatchObject({ ready: 0, failures: [] });
    expect(await pending()).toEqual({ opacity: "0", inert: true, ariaHidden: "true", display: "block" });
    await release();
    await expect.poll(async () => (await state()).ready).toBe(1);
    const confirmed = page.locator("iframe:not([hidden])"),
      frame = await confirmed.screenshot();
    expect(await confirmed.evaluate((node) => node.closest<HTMLElement>(".om-preview__canvas")?.inert)).toBe(false);
    await start("two", true);
    await expect.poll(async () => (await state()).frames.two, { timeout: 2000 }).toBe(3);
    expect(await state()).toMatchObject({ ready: 1, failures: [] });
    expect(await pending()).toMatchObject({ opacity: "0", inert: true, ariaHidden: "true" });
    expect(imageDifference(frame, await confirmed.screenshot()).changed).toBe(0);
    await release(true);
    await expect.poll(async () => (await state()).failures).toEqual(["工程字体加载失败"]);
    expect(await state()).toMatchObject({ ready: 1, closed: ["two"] });
    expect(await page.locator("iframe").count()).toBe(1);
    expect(imageDifference(frame, await confirmed.screenshot()).changed).toBe(0);
    report.success = true;
  } catch (error) {
    await driver.capture("readiness-failure");
    throw error;
  } finally {
    try {
      report.state = await page.evaluate(async () => {
        const probe = Reflect.get(window, "previewProbe");
        if (!probe) return null;
        await probe.preview.dispose();
        return probe.state;
      });
    } finally {
      await driver.close();
      report.closed = true;
      report.errors = driver.errors;
      await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
    }
  }
  expect(report.errors).toEqual([]);
}, 30000);
