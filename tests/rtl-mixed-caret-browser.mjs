import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

/** Bundle the actual Studio caret component, not a reimplementation of its geometry. */
const harnessSource = String.raw`
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { InlineTextCaret } from './studio/src/components/editor/InlineTextCaret.tsx';
export function mount(iframe, element) {
  const root = createRoot(document.getElementById('react-host'));
  root.render(createElement(InlineTextCaret, {
    iframe,
    session: { element, original: element.innerHTML, outline: '', outlineOffset: '' },
  }));
  return root;
}
`;

const samples = [
  { script: 'Hebrew', lang: 'he', text: 'ABC-123 שלום עולם', start: 10 },
  { script: 'Arabic', lang: 'ar', text: 'ABC-123 مرحبا عالم', start: 10 },
  { script: 'Persian', lang: 'fa', text: 'ABC-123 سلام دنیا', start: 10 },
  { script: 'Urdu', lang: 'ur', text: 'ABC-123 سلام دنیا', start: 10 },
  { script: 'Syriac', lang: 'syr', text: 'ABC-123 ܫܠܡܐ ܒܪܝܟܐ', start: 10 },
];

/**
 * Use real Chromium text layout and real native End navigation with a mixed
 * Latin+RTL text node. It catches the earlier bug where the whole node's
 * mixed direction made the overlay blindly choose the last glyph's RIGHT edge.
 * This is intentionally not a complete UAX #9 editing/IME acceptance test.
 */
test('real Chromium Studio caret respects the last RTL grapheme at mixed-script soft-wrap End', { timeout: 120_000 }, async t => {
  const bundled = await build({
    stdin: { contents: harnessSource, resolveDir: process.cwd(), sourcefile: 'rtl-caret-harness.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'RtlCaretHarness',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  assert.equal(bundled.outputFiles.length, 1);
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  t.after(() => browser.close());
  const outputDir = process.env.RTL_CARET_ARTIFACT_DIR;
  if (outputDir) await mkdir(outputDir, { recursive: true });
  const evidence = [];
  for (const sample of samples) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 900, height: 650, deviceScaleFactor: 1 });
      await page.setContent('<!doctype html><html lang="en" dir="ltr"><body><div id="react-host"></div><iframe id="composition" title="RTL composition" style="position:absolute;left:75px;top:60px;width:600px;height:340px;border:0"></iframe></body></html>');
      await page.evaluate(() => {
        document.getElementById('composition').srcdoc = '<!doctype html><html><body><div id="editable" contenteditable="true" style="width:175px;min-height:200px;direction:rtl;white-space:pre-wrap;overflow-wrap:anywhere;font:28px/1.3 DejaVu Sans,sans-serif;padding:4px"></div></body></html>';
      });
      await page.waitForFunction(() => Boolean(document.querySelector('#composition')?.contentDocument?.getElementById('editable')));
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      const initial = await page.evaluate(({ text, lang, start }) => {
        const iframe = document.querySelector('#composition');
        const editable = iframe.contentDocument.getElementById('editable');
        editable.textContent = text;
        editable.lang = lang;
        editable.focus();
        iframe.contentWindow.getSelection().collapse(editable.firstChild, start);
        window.__rtlCaretRoot = window.RtlCaretHarness.mount(iframe, editable);
        return { original: editable.textContent, initialOffset: start };
      }, sample);
      await page.waitForFunction(() => document.querySelector('#composition').contentDocument.getElementById('editable').style.caretColor === 'transparent');
      await page.keyboard.press('End');
      await page.waitForFunction(() => document.querySelector('[data-inline-text-caret="true"]') !== null);
      const result = await page.evaluate(() => {
        const iframe = document.querySelector('#composition');
        const doc = iframe.contentDocument;
        const editable = doc.getElementById('editable');
        const selection = iframe.contentWindow.getSelection();
        const at = selection.anchorNode;
        const offset = selection.anchorOffset;
        const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(at?.textContent || '')];
        const previous = graphemes.find(segment => segment.index + segment.segment.length === offset);
        if (!previous) return { error: 'Not on grapheme boundary', offset, text: editable.textContent };
        const glyph = doc.createRange();
        glyph.setStart(at, previous.index);
        glyph.setEnd(at, offset);
        const ink = [...glyph.getClientRects()].find(rect => rect.height > 0);
        const leading = glyph.cloneRange();
        leading.collapse(true);
        const leadingRect = [...leading.getClientRects()].find(rect => rect.height > 0);
        const layer = document.querySelector('[data-inline-text-caret="true"]');
        const frameRect = iframe.getBoundingClientRect();
        const scale = frameRect.width / iframe.contentWindow.innerWidth;
        return {
          text: editable.textContent,
          originalGrapheme: previous.segment,
          direction: getComputedStyle(editable).direction,
          offset,
          ink: ink ? { left: ink.left, right: ink.right, top: ink.top, height: ink.height } : null,
          leading: leadingRect ? { left: leadingRect.left, top: leadingRect.top } : null,
          layer: layer ? { left: parseFloat(layer.style.left), top: parseFloat(layer.style.top) } : null,
          expectedLeft: ink ? frameRect.left + ink.left * scale - 1 : null,
          expectedTop: ink ? frameRect.top + ink.top * scale : null,
        };
      });
      const record = { script: sample.script, ...initial, ...result };
      evidence.push(record);
      if (outputDir) {
        await page.screenshot({ path: path.join(outputDir, 'mixed-caret-' + sample.lang + '.png') });
        await writeFile(path.join(outputDir, 'rtl-mixed-caret.json'), JSON.stringify({ browser: await browser.version(), evidence }, null, 2) + '\n');
      }
      assert.equal(record.text, sample.text, sample.script + ': browser End changed Unicode');
      assert.equal(record.direction, 'rtl');
      assert.ok(/[\\p{Script=Hebrew}\\p{Script=Arabic}\\p{Script=Syriac}]/u.test(record.originalGrapheme), sample.script + ': did not land after RTL grapheme');
      assert.ok(record.ink && record.leading && record.layer, sample.script + ': missing actual DOM / Studio caret geometry');
      assert.ok(Math.abs(record.leading.top - record.ink.top) <= 3, sample.script + ': glyph leading marker is on another line');
      assert.ok(Math.abs(record.leading.left - record.ink.right) <= 4, sample.script + ': UAX #9 reference does not put the RTL glyph start at the right');
      assert.ok(Math.abs(record.layer.left - record.expectedLeft) <= 2, sample.script + ': Studio drew mixed-script caret on wrong visual edge: ' + JSON.stringify(record));
      assert.ok(Math.abs(record.layer.top - record.expectedTop) <= 2, sample.script + ': Studio drew mixed-script caret on wrong line');
    } finally {
      await page.close();
    }
  }
  assert.equal(evidence.length, samples.length);
});
