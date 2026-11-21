// Real Chromium check for the opt-in, localized-but-independent Studio sidebar.
// Does not mock the actual account menu, I18n context, player or media timeline.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { fixture } from './fixtures.ts';
import { startServer } from '../server.ts';

const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Expected an absolute RTL UI browser evidence directory');
await mkdir(output, { recursive: true });
process.env.OPENMOTION_TELEMETRY = '0';
const sampleText = 'שָׁלוֹם OpenMotion 2026';
const result = { passed: false, checks: [], browser: null };
const check = (name, value) => { result.checks.push({ name, value }); console.log('PASS ' + name); };
let page;
try {
  await fixture(async store => {
    await writeFile(path.join(store.projectDirectory, 'index.html'), '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script></head><body style="margin:0"><div id="main" data-composition-id="main" data-start="0" data-duration="3" data-width="640" data-height="360" data-fps="10" style="position:relative;width:640px;height:360px;background:#17382f"><h1 id="label" lang="he" dir="rtl" data-start="0" data-duration="3" style="color:#fff;font:40px sans-serif">' + sampleText + '</h1></div><script>window.__timelines={main:gsap.timeline({paused:true})};</script></body></html>');
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/usr/bin/google-chrome', headless: true });
    result.browser = await browser.version();
    page = await browser.newPage();
    try {
      await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
      const origin = (await running.info()).previewUrl;
      await page.goto(origin + '/#project/' + store.projectId, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
      await page.waitForSelector('.motion-sidebar');
      await page.waitForSelector('[aria-label="Account menu"]');
      const initial = await page.evaluate(() => ({
        sidebarDir: document.querySelector('.motion-sidebar')?.getAttribute('dir'),
        rootDir: document.documentElement.dir,
        locale: document.documentElement.lang,
        titles: [...document.querySelectorAll('.motion-sidebar bdi')].map(element => element.textContent),
        timelineDir: getComputedStyle(document.querySelector('[data-timeline-element-count]')).direction,
      }));
      assert.equal(initial.sidebarDir, 'ltr');
      assert.equal(initial.locale, 'en');
      assert(initial.titles.length > 0 && initial.titles.every(Boolean), 'Missing project title isolates');
      const labelInPreview = async () => {
        for (const frame of page.frames()) {
          const text = await frame.$eval('#label', el => el.textContent).catch(() => null);
          if (text) return text;
        }
        return null;
      };
      assert.equal(await labelInPreview(), sampleText, 'Actual preview source did not load');
      await page.screenshot({ path: path.join(output, 'navigation-ltr.png') });
      check('English Studio with LTR workspace and Unicode source before toggle', initial);
      const toggleInMenu = async expectedChecked => {
        await page.click('[aria-label="Account menu"]');
        await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some(el => el.textContent?.includes('Language')));
        const entries = await page.$$('[role="menuitem"]');
        let trigger;
        for (const entry of entries) if ((await entry.evaluate(el => el.textContent)).includes('Language')) { trigger = entry; break; }
        assert(trigger, 'Real account menu missing language submenu');
        await trigger.focus();
        await page.keyboard.press('ArrowRight');
        const selector = '[role="menu"][aria-label="Language"] [role="menuitemcheckbox"]';
        await page.waitForSelector(selector, { visible: true, timeout: 10_000 });
        const checked = await page.$eval(selector, el => el.getAttribute('aria-checked'));
        assert.equal(checked, String(expectedChecked), 'Actual language checkbox state wrong');
        await page.click(selector);
      };
      const verifyMobileDrawer = async direction => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.waitForSelector('.motion-project-navigation-trigger button[aria-label="Open project list"]', { visible: true });
        await page.click('.motion-project-navigation-trigger button[aria-label="Open project list"]');
        await page.waitForSelector('.motion-sidebar-drawer', { visible: true });
        const actual = await page.evaluate(() => {
          const drawer = document.querySelector('.motion-sidebar-drawer');
          const rect = drawer.getBoundingClientRect();
          const timeline = document.querySelector('[data-timeline-element-count]');
          return {
            left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth,
            drawerDirection: drawer.getAttribute('dir'),
            sidebarDirection: drawer.querySelector('.motion-sidebar')?.getAttribute('dir'),
            rootDirection: document.documentElement.dir,
            timelineDirection: timeline ? getComputedStyle(timeline).direction : null,
          };
        });
        assert.equal(actual.drawerDirection, direction, 'Portaled mobile project drawer must receive direction');
        assert.equal(actual.sidebarDirection, direction, 'Mobile project list must inherit its chosen direction');
        assert.equal(actual.rootDirection, initial.rootDir, 'Mobile navigation must never change global document direction');
        assert.equal(actual.timelineDirection, initial.timelineDir, 'Media timeline must not mirror on mobile');
        assert(actual.width > 200 && actual.width <= 260, 'Mobile drawer must remain visible within the viewport');
        if (direction === 'rtl') assert(Math.abs(actual.right - actual.viewport) < 2, 'RTL mobile drawer must anchor to right viewport edge');
        else assert(Math.abs(actual.left) < 2, 'LTR mobile drawer must anchor to left viewport edge');
        assert.equal(await labelInPreview(), sampleText, 'Mobile drawer altered authored preview Unicode');
        await page.screenshot({ path: path.join(output, 'navigation-mobile-' + direction + '.png') });
        check('Real responsive ' + direction.toUpperCase() + ' project drawer anchors only navigation', actual);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.motion-sidebar-drawer'));
        await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
        await page.waitForSelector('.motion-sidebar');
      };
      await toggleInMenu(false);
      await page.waitForFunction(() => document.querySelector('.motion-sidebar')?.getAttribute('dir') === 'rtl');
      const active = await page.evaluate(() => ({
        sidebarDir: document.querySelector('.motion-sidebar')?.getAttribute('dir'),
        rootDir: document.documentElement.dir,
        locale: document.documentElement.lang,
        preference: localStorage.getItem('motion.studio.navigationDirection'),
        titles: [...document.querySelectorAll('.motion-sidebar bdi')].map(element => element.textContent),
        titleDirections: [...document.querySelectorAll('.motion-sidebar bdi')].map(element => element.getAttribute('dir')),
        timelineDir: getComputedStyle(document.querySelector('[data-timeline-element-count]')).direction,
      }));
      assert.equal(active.preference, 'rtl');
      assert.equal(active.sidebarDir, 'rtl');
      assert.equal(active.rootDir, initial.rootDir, 'Project navigation may not globally mirror HTML');
      assert.equal(active.timelineDir, initial.timelineDir, 'Media timeline must retain its direction');
      assert.equal(active.locale, 'en', 'Studio interface language must remain English');
      assert.deepEqual(active.titles, initial.titles);
      assert(active.titleDirections.every(value => value === 'auto'), 'Project titles need isolated logical direction');
      assert.equal(await labelInPreview(), sampleText, 'Navigation changed authored Hebrew video content');
      await page.screenshot({ path: path.join(output, 'navigation-rtl.png') });
      check('Real account-menu toggle mirrors only project navigation', active);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.motion-sidebar');
      await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)');
      assert.equal(await page.$eval('.motion-sidebar', el => el.getAttribute('dir')), 'rtl');
      assert.equal(await labelInPreview(), sampleText);
      check('RTL navigation preference survives real browser reload', { direction: 'rtl' });
      await verifyMobileDrawer('rtl');
      await toggleInMenu(true);
      await page.waitForFunction(() => document.querySelector('.motion-sidebar')?.getAttribute('dir') === 'ltr');
      assert.equal(await page.evaluate(() => localStorage.getItem('motion.studio.navigationDirection')), 'ltr');
      assert.equal(await labelInPreview(), sampleText);
      check('Real account-menu toggle restores LTR without mutating media', { direction: 'ltr' });
      await verifyMobileDrawer('ltr');
      result.passed = true;
    } finally {
      if (!result.passed) await page.screenshot({ path: path.join(output, 'navigation-failure.png') }).catch(() => {});
      await browser.close();
      await running.close();
    }
  });
} catch (error) {
  result.error = String(error?.stack ?? error);
  throw error;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
