import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

// Run the production React property-panel textarea, not an imitation.
// CDP Input.imeSetComposition is a Chromium IME pipeline, but does not
// certify physical Windows/macOS/Linux keyboard IMEs or full UAX #9.
const harness = [
  "import { createElement } from 'react';",
  "import { createRoot } from 'react-dom/client';",
  "import { TextAreaField } from './studio/src/components/editor/propertyPanelSections.tsx';",
  "window.__rtlImeCommits = [];",
  "const root = createRoot(document.getElementById('host'));",
  "root.render(createElement(TextAreaField, { flat: true, label: 'Content', value: '', onCommit: value => window.__rtlImeCommits.push(value) }));",
].join('\n');
// The standalone Node esbuild runner is not Vite: unrelated inspector
// dependencies include a Node-only parser (recast/os) and ?raw SVG icons.
// These browser-only shims are deliberately unreachable from TextAreaField;
// do not mock React, textarea events, Unicode or production edit handlers.
const browserDependencyShim = {
  name: 'unused-ancestor-dependency-shim',
  setup(bundle) {
    bundle.onResolve({ filter: /^(?:node:)?os$/ }, () => ({
      path: 'os', namespace: 'rtl-test-node-shim',
    }));
    bundle.onLoad({ filter: /.*/, namespace: 'rtl-test-node-shim' }, () => ({
      contents: "export const EOL = '\\n'; export default { EOL: '\\n' };",
      loader: 'js',
    }));
    bundle.onLoad({ filter: /\.svg\?raw$/ }, () => ({
      contents: "export default '';",
      loader: 'js',
    }));
  },
};
const samples = [
  { lang: 'he', text: 'שָׁלוֹם', partial: 'שָׁ' },
  { lang: 'ar', text: 'السَّلَامُ', partial: 'السَّ' },
  { lang: 'fa', text: 'فارسی', partial: 'فار' },
  { lang: 'ur', text: 'اردو ٹ ڈ ڑ', partial: 'ارد' },
  { lang: 'syr', text: 'ܫܠܡܐ ܒܪܝܟܐ', partial: 'ܫܠ' },
  { lang: 'en', text: 'English ABC-123', partial: 'Eng' },
];

test('real Chromium CDP IME preedit never leaks partial source to Studio save', { timeout: 180_000 }, async t => {
  const bundle = await build({
    stdin: { contents: harness, resolveDir: process.cwd(), sourcefile: 'rtl-inspector-ime.ts', loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', write: false,
    loader: { '.svg': 'text' }, plugins: [browserDependencyShim],
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  assert.equal(bundle.outputFiles.length, 1);
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  t.after(() => browser.close());
  // about:blank is not a trustworthy browser origin: production's shared UI
  // initializes crypto.randomUUID, which browsers expose only in secure
  // contexts. Local loopback is a real browser secure context, unlike a stub.
  const fixtureHtml = '<!doctype html><html lang="en" dir="ltr"><body><div id="host"></div><button id="next">Next</button></body></html>';
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(fixtureHtml);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  assert(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;
  const outDir = process.env.RTL_IME_ARTIFACT_DIR;
  if (outDir) await mkdir(outDir, { recursive: true });
  const evidence = [];
  for (const sample of samples) {
    const page = await browser.newPage();
    // Surface browser bundle/runtime exceptions immediately instead of an
    // opaque 30s textarea timeout; never mute failures as a passing test.
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push('pageerror: ' + error.stack));
    page.on('console', message => {
      if (message.type() === 'error') pageErrors.push('console: ' + message.text());
    });
    try {
      await page.setViewport({ width: 750, height: 300, deviceScaleFactor: 1 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const context = await page.evaluate(() => ({
        secure: window.isSecureContext, uuid: typeof window.crypto.randomUUID,
      }));
      assert.deepEqual(context, { secure: true, uuid: 'function' },
        sample.lang + ': Chromium fixture must behave like a secure production origin');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      try {
        await page.waitForSelector('textarea', { timeout: 4500 });
      } catch (error) {
        const snapshot = await page.evaluate(() => ({
          markup: document.body.innerHTML.slice(0, 900),
          commits: window.__rtlImeCommits,
          mount: Boolean(document.getElementById('host')),
        }));
        throw new Error(sample.lang + ': production TextAreaField did not mount: ' +
          JSON.stringify({ error: String(error), snapshot, pageErrors }));
      }
      assert.deepEqual(pageErrors, [], sample.lang + ': Chromium reported React render errors');
      await page.evaluate(() => {
        window.__rtlImeEvents = [];
        const textarea = document.querySelector('textarea');
        for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
          textarea.addEventListener(type, e => window.__rtlImeEvents.push({ type: e.type, data: e.data }));
        }
      });
      await page.focus('textarea');
      const cdp = await page.createCDPSession();
      await cdp.send('Input.imeSetComposition', {
        text: sample.partial, selectionStart: sample.partial.length, selectionEnd: sample.partial.length,
      });
      await page.waitForFunction(() => window.__rtlImeEvents.some(e => e.type === 'compositionstart'));
      // Deliberately wait beyond the normal non-composition 120ms debounce.
      await new Promise(resolve => setTimeout(resolve, 210));
      const preedit = await page.evaluate(() => ({
        value: document.querySelector('textarea').value,
        commits: [...window.__rtlImeCommits],
        events: [...window.__rtlImeEvents],
      }));
      assert.equal(preedit.value, sample.partial, sample.lang + ': Chromium did not display the live IME preedit');
      assert.deepEqual(preedit.commits, [], sample.lang + ': provisional IME glyphs were saved to the project');
      await cdp.send('Input.insertText', { text: sample.text });
      await page.click('#next');
      await page.waitForFunction(() => window.__rtlImeCommits.length > 0, { timeout: 5_000 });
      await new Promise(resolve => setTimeout(resolve, 165));
      const after = await page.evaluate(() => ({
        value: document.querySelector('textarea').value,
        commits: [...window.__rtlImeCommits],
        events: [...window.__rtlImeEvents],
      }));
      assert.equal(after.value, sample.text, sample.lang + ': IME commit lost/altered logical Unicode');
      assert.deepEqual(after.commits, [sample.text], sample.lang + ': save was duplicated or used stale Unicode');
      assert(after.events.some(e => e.type === 'compositionend'), sample.lang + ': missing real Chromium IME compositionend');
      evidence.push({ script: sample.lang, preedit, after });
      if (outDir) {
        await page.screenshot({ path: path.join(outDir, 'rtl-inspector-ime-' + sample.lang + '.png') });
        await writeFile(path.join(outDir, 'rtl-inspector-ime.json'), JSON.stringify({
          browser: await browser.version(), evidence,
          limitation: 'Real Chromium CDP composition and actual production React inspector; not physical OS IME or complete mixed UAX #9 certification.',
        }, null, 2) + '\n');
      }
      await cdp.detach();
    } finally {
      await page.close();
    }
  }
  assert.equal(evidence.length, samples.length);
});
