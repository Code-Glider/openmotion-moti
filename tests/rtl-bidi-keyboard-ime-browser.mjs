import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

const harness = [
  "import { createElement } from 'react';",
  "import { createRoot } from 'react-dom/client';",
  "import { InlineTextCaret } from './studio/src/components/editor/InlineTextCaret.tsx';",
  "export function mount(frame, element) {",
  "  const root = createRoot(document.getElementById('host'));",
  "  root.render(createElement(InlineTextCaret, {",
  "    iframe: frame,",
  "    session: { element, original: element.innerHTML, outline: '', outlineOffset: '' },",
  "  }));",
  "  return root;",
  "}",
].join('\n');

const cases = [
  { name: 'Hebrew', lang: 'he', text: 'שָׁלוֹם ABC-123 עולם', ime: 'שָׁ' },
  { name: 'Arabic', lang: 'ar', text: 'السَّلَامُ ABC-123 عليكم', ime: 'مَ' },
  { name: 'Persian', lang: 'fa', text: 'فارسی ABC-123 زبان', ime: 'ژ' },
  { name: 'Urdu', lang: 'ur', text: 'اردو ABC-123 زبان', ime: 'ڈ' },
  { name: 'Syriac', lang: 'syr', text: 'ܫܠܡܐ ABC-123 ܒܪܝܟܐ', ime: 'ܫ' },
];

const parentHtml = '<!doctype html><html lang="en" dir="ltr"><body>' +
  '<div id="host"></div><iframe id="frame" title="Video preview" ' +
  'style="position:absolute;left:80px;top:45px;width:600px;height:350px;border:0"></iframe></body></html>';
const iframeHtml = '<!doctype html><html lang="en"><body>' +
  '<div id="editable" contenteditable="true" dir="rtl" ' +
  'style="width:400px;min-height:140px;white-space:pre-wrap;overflow-wrap:anywhere;' +
  'font:30px/1.3 DejaVu Sans,sans-serif"></div></body></html>';

test('actual Chromium mixed-script arrows and selection retain logical Unicode and caret geometry', { timeout: 180_000 }, async t => {
  const bundle = await build({
    stdin: { contents: harness, resolveDir: process.cwd(), sourcefile: 'rtl-arrow-harness.ts', loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'RtlBidiOverlay',
    write: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' },
  });
  assert.equal(bundle.outputFiles.length, 1);
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  t.after(() => browser.close());
  const outputDir = process.env.RTL_CARET_ARTIFACT_DIR;
  if (outputDir) await mkdir(outputDir, { recursive: true });
  const evidence = [];

  for (const sample of cases) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 850, height: 550, deviceScaleFactor: 1 });
      await page.setContent(parentHtml);
      await page.evaluate(html => { document.querySelector('#frame').srcdoc = html; }, iframeHtml);
      await page.waitForFunction(() => Boolean(document.querySelector('#frame')?.contentDocument?.getElementById('editable')));
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ text, lang }) => {
        const frame = document.querySelector('#frame');
        const element = frame.contentDocument.getElementById('editable');
        element.textContent = text;
        element.lang = lang;
        element.focus();
        frame.contentWindow.getSelection().collapse(element.firstChild, element.firstChild.length);
        window.__rtlEditorRoot = window.RtlBidiOverlay.mount(frame, element);
      }, sample);
      await page.waitForFunction(() => document.querySelector('[data-inline-text-caret="true"]') !== null);
      let measured = 0;
      const moves = [];
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']) {
        await page.keyboard.press(key);
        await new Promise(resolve => setTimeout(resolve, 60));
        const state = await page.evaluate(() => {
          const frame = document.querySelector('#frame'), doc = frame.contentDocument;
          const element = doc.getElementById('editable');
          const selection = frame.contentWindow.getSelection();
          const anchor = selection.anchorNode;
          const text = element.textContent;
          const offset = anchor?.nodeType === 3 ? selection.anchorOffset : null;
          const boundaries = new Set([0, text.length]);
          for (const entry of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
            boundaries.add(entry.index);
            boundaries.add(entry.index + entry.segment.length);
          }
          const box = frame.getBoundingClientRect();
          const scale = box.width / frame.contentWindow.innerWidth;
          const rect = selection.rangeCount ? [...selection.getRangeAt(0).getClientRects()].find(r => r.height > 0) : null;
          const layer = document.querySelector('[data-inline-text-caret="true"]');
          return {
            text, offset, collapsed: selection.isCollapsed,
            boundary: offset === null ? false : boundaries.has(offset),
            native: rect ? { left: rect.left, top: rect.top } : null,
            layer: layer ? { left: Number.parseFloat(layer.style.left), top: Number.parseFloat(layer.style.top) } : null,
            expected: rect ? { left: box.left + rect.left * scale - 1, top: box.top + rect.top * scale } : null,
          };
        });
        assert.equal(state.text, sample.text, sample.name + ': arrow movement mutated authored Unicode');
        assert(state.collapsed, sample.name + ': arrow navigation unexpectedly extended selection');
        assert(state.boundary, sample.name + ': arrow landed inside grapheme cluster: ' + JSON.stringify(state));
        if (state.native && state.layer) {
          assert(Math.abs(state.native.left - (state.layer.left + 1 - 80)) <= 3,
            sample.name + ': Studio custom caret did not follow resolved browser visual affinity');
          assert(Math.abs(state.layer.left - state.expected.left) <= 3, sample.name + ': wrong visual x');
          assert(Math.abs(state.layer.top - state.expected.top) <= 3, sample.name + ': wrong visual line');
          measured++;
        }
        moves.push({ key, ...state });
      }
      assert(measured >= 3, sample.name + ': insufficient real visual glyph geometry evidence');
      // Selection is owned by Chromium. The overlay is not allowed to draw a
      // second caret while Shift selects a grapheme across a bidi boundary.
      await page.evaluate(() => {
        const frame = document.querySelector('#frame');
        const text = frame.contentDocument.getElementById('editable').firstChild;
        frame.contentWindow.getSelection().collapse(text, 7);
      });
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.up('Shift');
      await new Promise(resolve => setTimeout(resolve, 80));
      const selectionState = await page.evaluate(() => ({
        collapsed: document.querySelector('#frame').contentWindow.getSelection().isCollapsed,
        caretVisible: Boolean(document.querySelector('[data-inline-text-caret="true"]')),
        text: document.querySelector('#frame').contentDocument.getElementById('editable').textContent,
      }));
      assert.equal(selectionState.collapsed, false, sample.name + ': Shift+Arrow did not select');
      assert.equal(selectionState.caretVisible, false, sample.name + ': overlay obscured selected text');
      assert.equal(selectionState.text, sample.text, sample.name + ': selection mutated source');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('[data-inline-text-caret="true"]') !== null);

      // Exercise Chromium's actual composition event pipeline through CDP,
      // not fake JavaScript-dispatched compositionstart/compositionend events.
      // Cancel rather than commit so the saved logical source is unchanged.
      await page.evaluate(() => {
        const frame = document.querySelector('#frame');
        const editable = frame.contentDocument.getElementById('editable');
        window.__rtlCompositionEvents = [];
        for (const eventName of ['compositionstart','compositionupdate','compositionend']) {
          editable.addEventListener(eventName, event => {
            window.__rtlCompositionEvents.push({ event: event.type, data: event.data });
          });
        }
        editable.focus();
        frame.contentWindow.getSelection().collapse(editable.firstChild, editable.firstChild.length);
      });
      await page.waitForFunction(() => document.querySelector('[data-inline-text-caret="true"]') !== null);
      const cdp = await page.createCDPSession();
      await cdp.send('Input.imeSetComposition', {
        text: sample.ime, selectionStart: sample.ime.length, selectionEnd: sample.ime.length,
      });
      await page.waitForFunction(() => {
        const events = window.__rtlCompositionEvents || [];
        return events.some(entry => entry.event === 'compositionstart') &&
          !document.querySelector('[data-inline-text-caret="true"]');
      }, { timeout: 10_000 });
      const duringComposition = await page.evaluate(() => ({
        events: [...window.__rtlCompositionEvents],
        caretVisible: Boolean(document.querySelector('[data-inline-text-caret="true"]')),
        text: document.querySelector('#frame').contentDocument.getElementById('editable').textContent,
      }));
      assert.equal(duringComposition.caretVisible, false, sample.name + ': synthetic caret covered actual Chromium IME composition');
      assert(duringComposition.events.some(event => event.event === 'compositionupdate' && event.data === sample.ime),
        sample.name + ': Chromium did not preserve script-specific composition data');
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
      await page.waitForFunction(() => {
        const events = window.__rtlCompositionEvents || [];
        return events.some(entry => entry.event === 'compositionend') &&
          Boolean(document.querySelector('[data-inline-text-caret="true"]'));
      }, { timeout: 10_000 });
      const afterCancel = await page.evaluate(() => ({
        events: [...window.__rtlCompositionEvents],
        text: document.querySelector('#frame').contentDocument.getElementById('editable').textContent,
        caretVisible: Boolean(document.querySelector('[data-inline-text-caret="true"]')),
      }));
      assert.equal(afterCancel.text, sample.text, sample.name + ': cancelled IME composition changed original Unicode text');
      assert.equal(afterCancel.caretVisible, true, sample.name + ': custom caret not restored after cancelled composition');
      await cdp.detach();
      evidence.push({ script: sample.name, source: sample.text, arrows: moves, rangeSelection: selectionState,
        ime: { composition: duringComposition, cancelled: afterCancel }, measured });
      if (outputDir) {
        await page.screenshot({ path: path.join(outputDir, 'rtl-arrows-' + sample.lang + '.png') });
        await writeFile(path.join(outputDir, 'rtl-arrows.json'), JSON.stringify({
          browser: await browser.version(), evidence,
          limitation: 'Actual Chromium native arrows and CDP IME-composition cancel through the real React caret overlay; not OS-level keyboard IME or full UAX #9 editing certification.',
        }, null, 2) + '\n');
      }
    } finally {
      await page.close();
    }
  }
  assert.equal(evidence.length, cases.length);
});
