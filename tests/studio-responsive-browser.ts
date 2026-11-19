// Run after build:studio with node --experimental-strip-types --test tests/studio-responsive-browser.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import puppeteer, { type Page } from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { gatewayFor } from '../gateway/service.ts';
import { startServer } from '../server.ts';
import { fixture } from './fixtures.ts';

async function checkCreator(page: Page, stacked: boolean) {
  const geometry = await page.$eval('.om-creator-pane', pane => {
    const button = pane.querySelector<HTMLButtonElement>('.om-asset-direct > button.om-button')!;
    const range = document.createRange();
    range.selectNodeContents(button);
    const bounds = button.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(button).paddingInline);
    const lines = Array.from(range.getClientRects());
    const [provider, model] = Array.from(pane.querySelectorAll('.om-generation-picker [role="combobox"]'), el => el.getBoundingClientRect());
    return {
      textFits: lines.length > 0 && lines.every(line => line.left >= bounds.left + padding - 1 && line.right <= bounds.right - padding + 1 && line.top >= bounds.top && line.bottom <= bounds.bottom),
      stacked: model.top >= provider.bottom && Math.abs(model.left - provider.left) < 1,
      aligned: model.left >= provider.right && Math.abs(model.bottom - provider.bottom) < 1,
    };
  });
  assert.ok(geometry.textFits, 'Every line of the provider setup action fits inside the button');
  assert.ok(stacked ? geometry.stacked : geometry.aligned, 'The model controls respond to the width of the creator pane');
}

test('Studio controls fit their resizable generator and timeline panes', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [];
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
      await page.setViewport({ width: 1280, height: 800 });
      const url = new URL((await running.info()).previewUrl);
      url.searchParams.set('page', 'cinema');
      url.searchParams.set('scene', 'text-to-video');
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.om-creator-pane .om-asset-direct > button.om-button', { visible: true });
      await page.evaluate(() => document.fonts.ready);
      const divider = await page.waitForSelector('.om-creator-pane [role="separator"]');
      for (const [key, width] of [['Home', 310], ['End', 650]] as const) {
        await divider!.press(key);
        await page.waitForFunction(width => document.querySelector('.om-creator-pane [role="separator"]')?.getAttribute('aria-valuenow') === String(width), {}, width);
        await checkCreator(page, key === 'Home');
      }
      await page.setViewport({ width: 320, height: 690 });
      await page.waitForFunction(() => document.querySelector('.om-creator-pane')!.getBoundingClientRect().width <= innerWidth);
      await checkCreator(page, true);
      assert.ok(await page.$eval('.om-studio-bar', bar => {
        const back = bar.querySelector('.om-studio-back')!.getBoundingClientRect();
        const assets = bar.querySelector('.om-studio-library-link')!.getBoundingClientRect();
        const scenes = bar.querySelector('nav')!.getBoundingClientRect();
        return assets.top < back.bottom && assets.bottom <= scenes.top;
      }), 'The mobile header keeps both navigation actions above the scenes');
      await page.goto((await running.info()).previewUrl, { waitUntil: 'domcontentloaded' });
      const toolbar = await page.waitForSelector('.motion-timeline-icon-controls', { visible: true });
      assert.ok(await toolbar!.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll('button, input')).filter(control => control.getClientRects().length).every(control => {
          const box = control.getBoundingClientRect();
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
        });
      }), 'All timeline controls fit at the narrowest viewport');
    } finally {
      await browser.close();
      await running.close();
      await gateway.close();
    }
  });
});

test('Explore fills every gallery row and keeps its height when the spotlight changes', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [];
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      const items = Array.from({ length: 8 }, (_, i) => ({ id: 'work-' + i, title: 'Work ' + i, description: 'A product reveal.', kind: 'builtin', tags: [] }));
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/template-catalog')) {
          void request.respond({ contentType: 'application/json', body: JSON.stringify({ offset: 0, items, next: null }) });
        } else void request.continue();
      });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const url = new URL((await running.info()).previewUrl);
      url.searchParams.set('page', 'explore');
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.om-feed-group [data-template-id]');
      await page.evaluate(() => document.fonts.ready);
      for (const width of [1512, 1060, 760, 320]) {
        await page.setViewport({ width, height: 850 });
        const rowsFill = await page.$eval('.om-feed-group', feed => {
          const bounds = feed.getBoundingClientRect();
          const cards = Array.from(feed.children, card => card.getBoundingClientRect());
          return cards.every((card, index) => {
            const previous = cards[index - 1], next = cards[index + 1];
            const startsRow = !previous || previous.top !== card.top;
            const endsRow = !next || next.top !== card.top;
            return (!startsRow || Math.abs(card.left - bounds.left) < 1) && (!endsRow || Math.abs(card.right - bounds.right) < 1);
          });
        });
        assert.ok(rowsFill, 'Gallery rows follow reading order and fill the available width at ' + width);
        const hero = (await page.$('.om-feature-carousel'))!;
        const initialHeight = await hero.evaluate(element => element.getBoundingClientRect().height);
        for (const indicator of await hero.$$('.om-media-segments button')) {
          await indicator.click();
          assert.equal(await hero.evaluate(element => element.getBoundingClientRect().height), initialHeight);
        }
      }
    } finally {
      await browser.close();
      await running.close();
      await gateway.close();
    }
  });
});
