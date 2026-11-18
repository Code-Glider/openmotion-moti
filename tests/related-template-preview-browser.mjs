import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { WorkspaceStore } from '../workspace.ts';
import { handler } from '../server.ts';
import { pluginRoot } from '../hyperframes.ts';

const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Pass an absolute evidence directory');
assert(process.env.CI || process.env.D4_LANE && process.env.PLAYWRIGHT_WEB_PORT, 'Run with browser-lock.sh locally');
await mkdir(output, { recursive: true });
const data = await mkdtemp(path.join(tmpdir(), 'motion-related-preview-'));
const store = new WorkspaceStore(data), context = { nativeRoot: pluginRoot };
const posterUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="gray"/></svg>');
const items = Array.from({ length: 7 }, (_, index) => ({ id: `fixture-${index}`, title: `Preview ${index}`, author: 'Fixture author',
  kind: 'prism', hasHtmlProject: false, styles: ['UI'], uses: ['Product launch'], tags: ['clean'], sortOrder: index,
  description: 'Synthetic template for related preview regression.', posterUrl, previewUrl: '/fixture-preview.mp4' }));
let requests = 0, browser;
const results = [];
const server = createServer((req, res) => {
  if (req.url.startsWith('/motion-api/template-catalog')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ items, total: items.length, next: null, catalogVersion: 'fixture' }));
  } else if (req.url === '/fixture-preview.mp4') {
    requests++; res.writeHead(503); res.end();
  } else void handler(req, res, store, context);
});
const detail = 'dialog[aria-label="Template preview"]';
const trigger = `${detail} button[aria-label="Preview template Preview 1"]`;
const popup = `${detail} div[aria-label="Preview 1"]`;
try {
  await store.initialize(pluginRoot);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PLAYWRIGHT_WEB_PORT || 0), '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[640, 360], [390, 844], [1440, 900]]) {
      await page.setViewport({ width, height });
      await page.evaluateOnNewDocument(theme => {
        localStorage.setItem('motion.studio.locale', 'en');
        localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme }));
        sessionStorage.removeItem('motion.template-handoff.preview');
      }, theme);
      // The normal entry now uses the same masonry cards as the library. Keep
      // the legacy popup regression below as explicit rollback-path coverage.
      await page.goto(`${origin}/?page=settings&templates=1&template=fixture-0`, { waitUntil: 'domcontentloaded' });
      const shelf = `${detail} section[aria-label="Similar templates"]`;
      await page.waitForSelector(`${shelf} .om-gallery-masonry .om-gallery-card`);
      await page.$eval(trigger, element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.hover(trigger);
      const cards = await page.$eval(shelf, element => {
        const masonry = element.querySelector('.om-gallery-masonry');
        const card = element.querySelector('.om-gallery-card');
        const button = card.querySelector('button');
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { columns: Number.parseInt(getComputedStyle(masonry).columnCount, 10),
          count: masonry.children.length, reachable: button.contains(hit),
          card: rect.toJSON(), caption: Boolean(button.querySelector('.om-gallery-card-caption')),
          players: element.querySelectorAll('video[src]').length,
          modals: document.querySelectorAll('dialog:modal').length };
      });
      assert.equal(cards.count, Math.min(items.length - 1, cards.columns * 2), 'Only matching cards fill up to two complete masonry rows');
      assert(cards.reachable && cards.caption && cards.card.width > cards.card.height, 'The shared gallery card, hover caption and landscape ratio remain usable');
      assert(cards.players <= 2, 'Related cards share a two-player budget');
      assert.equal(cards.modals, 1, 'The detail is the only active modal');
      assert.equal(await page.$(popup), null, 'The masonry hover does not create a separate preview popup');
      results.push({ mode: 'masonry', theme, width, height, ...cards });
      await page.screenshot({ path: path.join(output, `masonry-${theme}-${width}x${height}.png`) });
      await page.click(trigger);
      await page.waitForFunction(selector => document.querySelector(`${selector} h2`)?.textContent === 'Preview 1', {}, detail);
      assert.equal(await page.$$eval('dialog:modal', elements => elements.length), 1, 'Selecting a related card replaces the same detail');
      await page.keyboard.press('Escape');
      await page.waitForSelector(`${detail}[open]`, { hidden: true });
      assert(await page.$('dialog[aria-label="Template library"][open]'), 'Escape returns to the library');

      await page.goto(`${origin}/?page=settings&templates=1&template=fixture-0&templateHandoffPreview=0`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(trigger);
      await page.$eval(trigger, element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.evaluate(() => document.activeElement?.blur());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.hover(trigger);
      await page.waitForSelector(`${popup} [role=status] button`);
      await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(animation => {
        const timing = animation.effect?.getTiming(); return timing && timing.iterations !== Infinity && Number(timing.duration) < 1000;
      }).map(animation => animation.finished)); });
      const geometry = await page.$eval(popup, element => {
        const rect = element.getBoundingClientRect(), button = element.querySelector('button'), caption = element.lastElementChild;
        const retry = button.getBoundingClientRect(), hit = document.elementFromPoint(retry.x + retry.width / 2, retry.y + retry.height / 2);
        return { popup: rect.toJSON(), retry: retry.toJSON(), reachable: button.contains(hit), captionHidden: getComputedStyle(caption).display === 'none' };
      });
      results.push({ mode: 'legacy', theme, width, height, ...geometry });
      await page.screenshot({ path: path.join(output, `${theme}-${width}x${height}.png`) });
      assert(geometry.popup.top >= 15 && geometry.popup.bottom <= height - 15 && geometry.popup.left >= 15 && geometry.popup.right <= width - 15,
        `${theme} ${width}x${height}: preview must fit the viewport: ${JSON.stringify(geometry)}`);
      assert(geometry.reachable && geometry.captionHidden, 'Retry must be clickable without the caption covering its status');
      const before = requests;
      const retried = page.waitForResponse(response => response.url() === `${origin}/fixture-preview.mp4`);
      await page.click(`${popup} button`);
      await retried;
      await page.waitForFunction(selector => Boolean(document.querySelector(`${selector} [role=status] button`)), {}, popup);
      assert(requests > before, 'Retry must request the preview again');
      await page.keyboard.press('Escape');
      await page.waitForSelector(popup, { hidden: true });
      assert(await page.$(`${detail}[open]`), 'Escape must keep the detail dialog open');
      await page.click(trigger);
      await page.waitForFunction(selector => document.querySelector(`${selector} h2`)?.textContent === 'Preview 1', {}, detail);
    }
  }
  console.log('PASS default masonry cards, player budget and same-dialog selection; legacy popup bounds, Retry and Escape in both themes at 640x360, 390x844 and 1440x900');
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
  await browser?.close(); server.closeAllConnections(); server.close();
  await rm(data, { recursive: true, force: true });
}
