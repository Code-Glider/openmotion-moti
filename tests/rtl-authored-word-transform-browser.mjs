import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

const harness = [
  "import { createElement } from 'react';",
  "import { createRoot } from 'react-dom/client';",
  "import { CaptionOverlay } from './studio/src/captions/components/CaptionOverlay.tsx';",
  "import { useCaptionStore } from './studio/src/captions/store.ts';",
  "import { applyCaptionModelToIframe, readWordTransformForGesture } from './studio/src/captions/components/CaptionOverlayUtils.ts';",
  "import { generateCaptionHtml } from './studio/src/captions/generator.ts';",
  "import { buildCaptionModel } from './studio/src/captions/parser.ts';",
  "import { readGsapTransform, writeTransform, computeTransformStyle, getOrCreateWrapper } from './studio/src/captions/components/CaptionOverlayUtils.ts';",
  "export function editWordWithoutFlattening(word, dx, rotationDelta) {",
  " const state = readGsapTransform(getOrCreateWrapper(word), window);",
  " writeTransform(word, window, state.x + dx, state.y, state.scale, state.rotation + rotationDelta, state.scaleY);",
  " return computeTransformStyle(word, window);",
  "}",
  "function modelFor(style) {",
  " const words = [",
  "   { id: 'w-he', text: 'שָׁלוֹם', start: 0.1, end: 0.45 },",
  "   { id: 'w-en', text: 'ABC-123', start: 0.5, end: 0.95 },",
  " ];",
  " const model = buildCaptionModel(words, { width: 640, height: 360, duration: 2, wordsPerGroup: 2 });",
  " const group = model.groups.get(model.groupOrder[0]);",
  " group.style.fontFamily = 'Pinned Hebrew QA';",
  " const first = model.segments.get(group.segmentIds[0]);",
  " first.style = style;",
  "return model;",
  "}",
  "export function htmlFor(style) { return generateCaptionHtml(modelFor(style)); }",
  "export async function replay(frame, fontCss) {",
  " const doc = frame.contentDocument;",
  " const host = doc.createElement('template');",
  " host.innerHTML = generateCaptionHtml(useCaptionStore.getState().model);",
  " const inner = host.content.querySelector('template');",
  " const script = inner?.content.querySelector('script')?.textContent;",
  " const css = inner?.content.querySelector('style')?.textContent;",
  " if (!script || !css) throw Error('Missing generated caption source');",
  " doc.head.innerHTML = '';",
  " doc.body.innerHTML = '<div id=\"captions-container\" style=\"width:640px;height:360px\"></div>';",
  " doc.body.style.cssText = 'margin:0;background:#111827';",
  " const sheet = doc.createElement('style');",
  " sheet.textContent = fontCss + css; doc.head.append(sheet);",
  " frame.contentWindow.gsap = { timeline: () => ({ to() { return this; } }) };",
  " new frame.contentWindow.Function(script)();",
  " await doc.fonts.ready;",
  " doc.querySelector('.caption-group').style.opacity = '1';",
  "}",
  "export async function mountPointerOverlay(frame, fontCss) {",
  " const store = useCaptionStore.getState();",
  " store.reset(); store.setModel(modelFor({})); store.setEditMode(true);",
  " await replay(frame, fontCss);",
  " const root = createRoot(document.getElementById('overlay-host'));",
  " root.render(createElement(CaptionOverlay, { iframeRef: { current: frame } }));",
  " return root;",
  "}",
  "export function snapshot(frame) {",
  " const store = useCaptionStore.getState();",
  " const model = store.model; const group = model.groups.get(model.groupOrder[0]);",
  " const words = [...frame.contentDocument.querySelectorAll('.caption-group .word')];",
  " return { past: store.past.length, future: store.future.length, selected: [...store.selectedSegmentIds],",
  "   segments: group.segmentIds.map(id => { const s = model.segments.get(id); return { id, wordId:s.wordId, text:s.text, start:s.start, end:s.end, style:s.style }; }),",
  "   dom: words.map(word => ({ id:word.id, text:word.textContent, start:word.dataset.start, end:word.dataset.end, transform:readWordTransformForGesture(word, frame.contentWindow), wrapper:word.parentElement?.dataset.captionWrapper === 'true', markup:word.outerHTML })),",
  " };",
  "}",
  "export function history(direction) {",
  " const model = useCaptionStore.getState()[direction]();",
  " if (!model) throw Error('No caption history to ' + direction);",
  " applyCaptionModelToIframe(model);",
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
    write: false, logLevel: 'silent', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
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
  // Trusted pointer events through the production CaptionOverlay, not direct
  // calls to the transform helpers. This component host is not full Studio.
  const pointerPage = await browser.newPage();
  await pointerPage.setViewport({ width: 760, height: 520, deviceScaleFactor: 1 });
  await pointerPage.setContent('<!doctype html><html lang="en" dir="ltr"><head><style>' +
    'body{margin:0;background:#111827}.absolute{position:absolute}.inset-0{inset:0}.z-50{z-index:50}' +
    '.ring-2{outline:2px solid #3ce6ac}</style></head><body>' +
    '<div style="position:relative;width:640px;height:360px;margin:40px">' +
    '<iframe id="pointer-frame" title="Caption preview" style="position:absolute;left:0;top:0;width:640px;height:360px;border:0"></iframe>' +
    '<div id="overlay-host" style="position:absolute;inset:0"></div></div></body></html>');
  await pointerPage.addScriptTag({ content: bundle.outputFiles[0].text });
  const fontCss = '@font-face{font-family:"Pinned Hebrew QA";src:url("data:font/ttf;base64,' +
    bytes.toString('base64') + '") format("truetype");font-display:block}';
  await pointerPage.evaluate(async css => {
    const frame = document.getElementById('pointer-frame');
    window.__pointerReceipts = [];
    for (const type of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture']) {
      document.addEventListener(type, e => {
        window.__pointerReceipts.push({ type, trusted:e.isTrusted, pointerId:e.pointerId });
      }, true);
    }
    window.__overlayRoot = await window.RtlNativeCaptionTransform.mountPointerOverlay(frame, css);
  }, fontCss);
  const snapshot = () => pointerPage.evaluate(() => window.RtlNativeCaptionTransform.snapshot(document.getElementById('pointer-frame')));
  const baseline = await snapshot();
  assert.equal(baseline.dom.length, 2);
  assert.equal(baseline.segments[0].wordId, 'w-he');
  const selector = '[data-caption-segment-id="' + baseline.segments[0].id + '"]';
  await pointerPage.waitForSelector(selector, { visible: true });
  await pointerPage.click(selector);
  await pointerPage.waitForFunction(sel => document.querySelector(sel)?.style.cursor === 'move', {}, selector);
  const center = async () => {
    const hit = await pointerPage.$(selector);
    assert(hit, 'Missing authored Hebrew word hit');
    const box = await hit.boundingBox();
    await hit.dispose();
    assert(box && box.width > 24 && box.height > 12, 'Real overlay has no usable pointer target');
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  };
  const beginDrag = async () => {
    const start = await center();
    await pointerPage.mouse.move(start.x, start.y);
    await pointerPage.mouse.down();
    await pointerPage.mouse.move(start.x + 24, start.y - 12, { steps: 4 });
  };
  await beginDrag();
  const provisional = await snapshot();
  assert.equal(provisional.past, baseline.past, 'Provisional drag created history before pointerup');
  assert.deepEqual(provisional.segments, baseline.segments, 'Provisional drag changed the saved model');
  assert.equal(provisional.dom[0].transform.x, 24);
  assert.equal(provisional.dom[0].transform.y, -12);
  await pointerPage.keyboard.press('Escape');
  await pointerPage.mouse.up();
  const cancelled = await snapshot();
  assert.deepEqual(cancelled.dom, baseline.dom, 'Escape did not restore authored DOM');
  assert.deepEqual(cancelled.segments, baseline.segments);
  assert.equal(cancelled.past, baseline.past);
  // Re-establish selection via the actual hit if cancellation cleared it.
  if (!cancelled.selected.includes(baseline.segments[0].id)) await pointerPage.click(selector);
  await pointerPage.waitForFunction(sel => document.querySelector(sel)?.style.cursor === 'move', {}, selector);
  // Complete a second trusted drag; require exactly one history entry.
  await beginDrag();
  await pointerPage.mouse.up();
  const committed = await snapshot();
  assert.equal(committed.past, baseline.past + 1, 'Completed drag did not create one history entry');
  assert.deepEqual(committed.segments[0].style, { x:24, y:-12, scaleX:1, scaleY:1, rotation:0 });
  assert.deepEqual(committed.segments[1], baseline.segments[1], 'Dragging Hebrew changed the Latin sibling');
  assert.deepEqual(committed.dom[1], baseline.dom[1], 'Dragging Hebrew mutated the Latin DOM sibling');
  assert.equal(committed.dom[0].markup, baseline.dom[0].markup, 'Drag rewrote the authored Hebrew word');
  assert.deepEqual(committed.dom[0].transform, { x:24, y:-12, scale:1, scaleY:1, rotation:0 });
  const events = await pointerPage.evaluate(() => window.__pointerReceipts);
  assert(events.every(e => e.trusted), 'Pointer fixture received synthetic events');
  assert(events.some(e => e.type === 'gotpointercapture'), 'Browser never granted actual pointer capture');
  assert(events.some(e => e.type === 'lostpointercapture'), 'Browser never released actual pointer capture');
  if (outputDir) await pointerPage.screenshot({ path: path.join(outputDir, 'rtl-trusted-caption-pointer.png') });
  // Caption store history and its live iframe replay helper, not app hotkeys.
  await pointerPage.evaluate(() => window.RtlNativeCaptionTransform.history('undo'));
  const undone = await snapshot();
  assert.deepEqual(undone.segments, baseline.segments);
  assert.deepEqual(undone.dom[0].transform, baseline.dom[0].transform);
  await pointerPage.evaluate(() => window.RtlNativeCaptionTransform.history('redo'));
  const redone = await snapshot();
  assert.deepEqual(redone.segments, committed.segments);
  assert.deepEqual(redone.dom[0].transform, committed.dom[0].transform);
  // Generate fresh source from the model, not a native project ZIP.
  await pointerPage.evaluate(css => window.RtlNativeCaptionTransform.replay(document.getElementById('pointer-frame'), css), fontCss);
  const regenerated = await snapshot();
  assert.deepEqual(regenerated.segments, committed.segments);
  assert.deepEqual(regenerated.dom, committed.dom, 'Generated source replay changed word identity or transform');
  if (outputDir) await writeFile(path.join(outputDir, 'rtl-trusted-caption-pointer.json'),
    JSON.stringify({ passed:true, browser:await browser.version(), baseline, provisional, cancelled, committed, undone, redone, regenerated, events,
      scope:'Trusted Chromium CaptionOverlay pointer events, caption store history, generated source replay; native Studio persistence, offline ZIP and MP4 remain separate.' }, null, 2) + '\n');
  await pointerPage.close();

  if (outputDir) await writeFile(path.join(outputDir, 'rtl-authored-word-transform.json'),
    JSON.stringify({ passed: true, browser: await browser.version(), pinnedHebrewSha256: sha(bytes),
      original: neutral, moved, styled, edited, reset, scope: 'Native generated DOM plus live Chromium move/rotate with preserved non-uniform scale; native MP4 transform parity remains separate.' }, null, 2) + '\n');
});
