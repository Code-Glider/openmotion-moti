import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { writeBrandProject } from '../gateway/brand-package.ts';
import { catalogCapture, readBrandCatalog } from '../gateway/brand-catalog.ts';

test('brand showcase keeps content centered and palette labels clear across fonts and corner shapes', async t => {
  const executablePath = await browserExecutable().catch(() => undefined);
  if (!executablePath) return t.skip('Chrome is required for showcase layout checks');
  const browser = await puppeteer.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const directory = await mkdtemp(path.join(tmpdir(), 'brand-showcase-layout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const capture = catalogCapture((await readBrandCatalog()).entries[0]);
  for (const [radius, font, name] of [
    ['0px', 'Arial, sans-serif', 'Square'],
    ['24px', 'Georgia, serif', 'Rounded'],
    ['999px', 'Arial, sans-serif', 'Pill'],
    ['50%', 'Courier New, monospace', 'Circle'],
    ['999px', 'Courier New, monospace', 'W'.repeat(100)],
  ]) {
    capture.sample.name = name;
    Object.assign(capture.sample.style, { radius, headingFont: font, bodyFont: font });
    await writeBrandProject(directory, capture, path.resolve('.'));
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
    await page.evaluate(() => document.fonts.ready);
    // Backward seeks catch stale animation transforms and overlapping scenes too.
    for (const time of [1.5, 4.5, 7.5, 10.5, 7.5, 1.5]) {
      const layout = await page.evaluate(time => {
        (window as any).__timelines.main.seek(time);
        const visible = [...document.querySelectorAll<HTMLElement>('.scene')].filter(element => getComputedStyle(element).visibility === 'visible');
        const scene = visible[0];
        const content = scene.querySelector<HTMLElement>('.content-stack, .card')!;
        const bounds = content.getBoundingClientRect();
        const textRects: DOMRect[] = [];
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          textRects.push(...range.getClientRects());
        }
        return {
          visible: visible.map(element => element.id),
          center: [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
          overflow: textRects.filter(rect => rect.left < 64 || rect.right > 1216 || rect.top < 128 || rect.bottom > 592).map(rect => rect.toJSON()),
          palette: [...scene.querySelectorAll('.swatch')].map(swatch => {
            const color = swatch.querySelector('.swatch-color')!.getBoundingClientRect();
            const label = swatch.querySelector('figcaption')!.getBoundingClientRect();
            return { gap: label.top - color.bottom, offset: label.x + label.width / 2 - color.x - color.width / 2 };
          }),
        };
      }, time);
      const context = `${radius}, ${font}, ${name.length} chars, ${time}s`;
      assert.deepEqual(layout.visible, [['title', 'type', 'palette', 'finish'][Math.floor(time / 3)]], context);
      assert(Math.abs(layout.center[0] - 640) < 1 && Math.abs(layout.center[1] - 360) < 1, `center: ${context}`);
      assert.deepEqual(layout.overflow, [], `text stays within safe area: ${context}`);
      for (const label of layout.palette) {
        assert(label.gap >= 12, `color labels must not overlap rounded swatches: ${context}`);
        assert(Math.abs(label.offset) < 1, `color labels are centered: ${context}`);
      }
    }
  }
});
