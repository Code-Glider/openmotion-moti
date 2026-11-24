import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

const harness = [
  "import { generateCaptionHtml } from './studio/src/captions/generator.ts';",
  "import { buildCaptionModel } from './studio/src/captions/parser.ts';",
  "import { readGsapTransform, writeTransform, computeTransformStyle, getOrCreateWrapper } from './studio/src/captions/components/CaptionOverlayUtils.ts';",
  "export function editWordWithoutFlattening(word, dx, rotationDelta) {",
  " const state = readGsapTransform(getOrCreateWrapper(word), window);",
  " writeTransform(word, window, state.x + dx, state.y, state.scale, state.rotation + rotationDelta, state.scaleY);",
  " return computeTransformStyle(word, window);",
  "}",
  "export function htmlFor(style) {",
  " const words = [",
  "   { id: 'w-he', text: 'שָׁלוֹם', start: 0.1, end: 0.45 },",
  "   { id: 'w-en', text: 'ABC-123', start: 0.5, end: 0.95 },",
  " ];",
  " const model = buildCaptionModel(words, { width: 640, height: 360, duration: 2, wordsPerGroup: 2 });",
  " const group = model.groups.get(model.groupOrder[0]);",
  " group.style.fontFamily = 'Pinned Hebrew QA';",
  " const first = model.segments.get(group.segmentIds[0]);",
  " first.style = style;",
  " return generateCaptionHtml(model);",
  "}",
].join('\n');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('real Chromium native caption export replays Hebrew word transforms and neutral undo exactly', { timeout: 120_000 }, async t => {
  const directory = process.env.RTL_BROWSER_FONT_DIR;
  assert(directory && path.isAbsolute(directory), 'PINNED_RTL_FONT_DIRECTORY_REQUIRED');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, '06bfe0d62a98375cb09c942fa18e68bd32cff057');
  const face = manifest.faces.find(item => item.id === 'hebrew');
  assert(face, 'PINNED_HEBREW_FONT_MISSING');
  const [bytes,license] = await Promise.all([
    readFile(path.join(directory, face.filename)),
    readFile(path.join(directory, face.licenseFilename)),
  ]);
  assert.equal(sha(bytes), face.fontSha256, 'PINNED_HEBREW_TTF_BYTES_CHANGED');
  assert.equal(sha(license), face.licenseSha256, 'PINNED_HEBREW_OFL_LICENSE_CHANGED');
  const bundle = await build({
    stdin: { contents: harness, resolveDir: process.cwd(), sourcefile: 'rtl-word-transform-harness.ts', loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'RtlNativeCaptionTransform',
    write: false, logLevel: 'silent',
  });
  assert.equal(bundle.outputFiles.length, 1);
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 760, height: 520, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html lang="en"><head></head><body style="margin:0;background:#111827">' +
    '<div id="captions-container" style="width:640px;height:360px"></div></body></html>');
  await page.addStyleTag({ content: '@font-face{font-family:"Pinned Hebrew QA";src:url("data:font/ttf;base64,' +
    bytes.toString('base64') + '") format("truetype");font-display:block}.caption-group{font-family:"Pinned Hebrew QA",sans-serif}' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const render = async style => page.evaluate(async input => {
    const html = window.RtlNativeCaptionTransform.htmlFor(input);
    const host = document.createElement('template');
    host.innerHTML = html;
    const inner = host.content.querySelector('template');
    const script = inner?.content.querySelector('script')?.textContent;
    const css = inner?.content.querySelector('style')?.textContent;
    if (!script || !css) throw new Error('Native HTML generator omitted script or CSS');
    document.querySelector('#native-captions-css')?.remove();
    document.getElementById('captions-container').replaceChildren();
    const sheet = document.createElement('style');
    sheet.id = 'native-captions-css';
    sheet.textContent = css;
    document.head.append(sheet);
    window.gsap = { timeline: () => ({ to() { return this; } }) };
    new Function(script)();
    await document.fonts.ready;
    const group = document.querySelector('.caption-group');
    if (!group) throw new Error('Native caption script did not render a group');
    group.style.opacity = '1';
    const word = group.querySelector('.word');
    const wrap = word?.closest('[data-caption-wrapper]');
    const rect = word.getBoundingClientRect();
    return {
      groupId: group.dataset.captionGroupId,
      groupText: group.textContent,
      children: group.children.length,
      wrapper: Boolean(wrap),
      wrapperMarker: wrap?.dataset.captionWrapper || null,
      transform: wrap?.style.transform || '',
      wordId: word?.id,
      wordText: word?.textContent,
      start: word?.dataset.start, end: word?.dataset.end,
      secondWordId: group.querySelectorAll('.word')[1]?.id,
      secondWordText: group.querySelectorAll('.word')[1]?.textContent,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }, style);
  const neutral = await render({});
  const moved = await render({ x: 18, y: -11 });
  assert.equal(moved.wrapper, true, 'Authored moved word needs a transform wrapper');
  assert.equal(moved.wrapperMarker, 'true');
  assert.equal(moved.transform, 'translate(18px, -11px) rotate(0deg) scale(1, 1)');
  assert(Math.abs(moved.rect.x - neutral.rect.x - 18) < 1.5,
    'Native caption word horizontal offset did not match saved translation');
  assert(Math.abs(moved.rect.y - neutral.rect.y + 11) < 1.5,
    'Native caption word vertical offset did not match saved translation');
  const styled = await render({ x: 18, y: -11, rotation: 12, scaleX: 1.25, scaleY: 0.9 });
  assert.equal(styled.transform, 'translate(18px, -11px) rotate(12deg) scale(1.25, 0.9)');
  assert(styled.rect.width > neutral.rect.width, 'Native caption nonuniform scale/rotation not applied to browser geometry');
  // Edit a real generated word in-place: model regeneration alone cannot
  // verify the Studio editor helper's transform read/write semantics.
  const edited = await page.evaluate(() => {
    const group = document.querySelector('.caption-group');
    const word = group.querySelector('.word');
    const before = word.getBoundingClientRect();
    const model = window.RtlNativeCaptionTransform.editWordWithoutFlattening(word, 6, 8);
    const after = word.getBoundingClientRect();
    return {
      model, wordId: word.id, wordText: word.textContent, groupText: group.textContent,
      transform: word.closest('[data-caption-wrapper]')?.style.transform,
      wrapperCount: group.querySelectorAll('[data-caption-wrapper]').length,
      beforeWidth: before.width, afterWidth: after.width,
    };
  });
  assert.deepEqual(edited.model, { x: 24, y: -11, rotation: 20, scaleX: 1.25, scaleY: 0.9 },
    'Moving and rotating a Hebrew word flattened its non-uniform Y scale');
  assert.equal(edited.wrapperCount, 1, 'Editing imported word created a duplicate wrapper');
  assert.equal(edited.wordId, 'w-he');
  assert.equal(edited.wordText, 'שָׁלוֹם');
  assert.equal(edited.groupText, 'שָׁלוֹםABC-123');
  const scale = edited.transform?.match(/\bscale\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*\)/);
  assert(scale, 'Live DOM transform did not contain a two-axis scale');
  assert.deepEqual(scale.slice(1).map(Number), [1.25, 0.9],
    'Live DOM transform lost its independent authored Y scale');
  assert(edited.afterWidth > neutral.rect.width, 'In-place editing lost actual Chromium glyph geometry');
  const outputDir = process.env.RTL_CAPTION_EXPORT_ARTIFACT_DIR;
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, 'rtl-authored-word-transform.png') });
  }
  const reset = await render({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  assert.equal(reset.wrapper, false, 'Neutral undo must remove the generated transform wrapper');
  assert(Math.abs(reset.rect.x - neutral.rect.x) < 1.5, 'Neutral reset retained horizontal drift');
  assert(Math.abs(reset.rect.y - neutral.rect.y) < 1.5, 'Neutral reset retained vertical drift');
  for (const state of [neutral, moved, styled, reset]) {
    assert.equal(state.wordId, 'w-he');
    assert.equal(state.wordText, 'שָׁלוֹם');
    assert.equal(state.groupText, 'שָׁלוֹםABC-123');
    assert.equal(state.start, '0.1');
    assert.equal(state.end, '0.45');
    assert.equal(state.secondWordId, 'w-en');
    assert.equal(state.secondWordText, 'ABC-123');
    assert.equal(state.children, 2);
  }
  if (outputDir) await writeFile(path.join(outputDir, 'rtl-authored-word-transform.json'),
    JSON.stringify({ passed: true, browser: await browser.version(), pinnedHebrewSha256: sha(bytes),
      original: neutral, moved, styled, edited, reset, scope: 'Native generated DOM plus live Chromium move/rotate with preserved non-uniform scale; native MP4 transform parity remains separate.' }, null, 2) + '\n');
});
