import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

const source = [
  "import { readWordBoxes, getWordEl } from './studio/src/captions/components/CaptionOverlayUtils.ts';",
  "export { readWordBoxes, getWordEl };",
].join('\n');

const cases = [
  { id: 'hebrew', lang: 'he', dir: 'rtl', text: 'שָׁלוֹם  OpenMotion 25%!', words: ['שָׁלוֹם', 'OpenMotion', '25%!'], face: 'hebrew' },
  { id: 'arabic', lang: 'ar', dir: 'rtl', text: 'السَّلَامُ  OpenMotion 2026!', words: ['السَّلَامُ', 'OpenMotion', '2026!'], face: 'arabic' },
  { id: 'persian', lang: 'fa', dir: 'rtl', text: 'فارسی  OpenMotion ۲۰۲۶', words: ['فارسی', 'OpenMotion', '۲۰۲۶'], face: 'arabic' },
  { id: 'urdu', lang: 'ur', dir: 'rtl', text: 'اردو  ABC-123  ٹڈڑںے', words: ['اردو', 'ABC-123', 'ٹڈڑںے'], face: 'urdu' },
  { id: 'syriac', lang: 'syr', dir: 'rtl', text: 'ܫܠܡܐ  ܒܪܝܟܐ ABC-123', words: ['ܫܠܡܐ', 'ܒܪܝܟܐ', 'ABC-123'], face: 'syriac' },
  { id: 'ethiopic', lang: 'am', dir: 'ltr', text: 'ሰላም  English 2026', words: ['ሰላም', 'English', '2026'], face: 'ethiopic' },
  { id: 'authored', lang: 'he', dir: 'rtl', text: 'שלום ABC-123', words: ['שלום', 'ABC-123'], face: 'hebrew' },
];
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Real Chromium DOM ranges; no geometry mocks, no text-node replacement. */
test('non-destructive RTL caption hit geometry matches Chromium Range and preserves authored word identities', { timeout: 120_000 }, async t => {
  const fontDir = process.env.RTL_BROWSER_FONT_DIR;
  assert(fontDir && path.isAbsolute(fontDir), 'PINNED_RTL_CAPTION_FONTS_REQUIRED');
  const manifest = JSON.parse(await readFile(path.join(fontDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, '06bfe0d62a98375cb09c942fa18e68bd32cff057');
  const css = [];
  for (const id of ['hebrew', 'arabic', 'urdu', 'syriac', 'ethiopic']) {
    const face = manifest.faces.find(item => item.id === id);
    assert(face, id + ': pinned font face missing');
    const bytes = await readFile(path.join(fontDir, face.filename));
    const license = await readFile(path.join(fontDir, face.licenseFilename));
    assert.equal(sha256(bytes), face.fontSha256, id + ': font hash mismatch');
    assert.equal(sha256(license), face.licenseSha256, id + ': license hash mismatch');
    css.push('@font-face{font-family:"RTL QA ' + id + '";src:url("data:font/ttf;base64,' + bytes.toString('base64') + '") format("truetype");font-display:block}');
    css.push('[data-font="' + id + '"]{font-family:"RTL QA ' + id + '" !important}');
  }
  const bundle = await build({
    stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'rtl-caption-range-harness.ts', loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'RTLCaptionRanges',
    write: false, logLevel: 'silent',
  });
  assert.equal(bundle.outputFiles.length, 1);
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1150, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html lang="en" dir="ltr"><body style="margin:0">' +
    '<div id="overlay" style="position:absolute;left:0;top:0;width:900px;height:1150px;pointer-events:none"></div>' +
    '<iframe id="preview" title="RTL video" style="position:absolute;left:36px;top:28px;width:640px;height:1050px;border:0"></iframe>' +
    '</body></html>');
  await page.evaluate(() => {
    document.getElementById('preview').srcdoc = '<!doctype html><html lang="en"><head><style>' +
      'body{margin:0;background:#222}.caption-group{position:absolute;width:175px;font-size:24px;line-height:1.3;' +
      'white-space:pre-wrap;overflow-wrap:anywhere;opacity:1;color:white}</style></head><body></body></html>';
  });
  await page.waitForFunction(() => Boolean(document.querySelector('#preview')?.contentDocument?.querySelector('style')?.textContent?.includes('.caption-group')));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async ({ cases, styles }) => {
    const iframe = document.getElementById('preview');
    const doc = iframe.contentDocument;
    const injected = doc.createElement('style');
    injected.textContent = styles;
    doc.head.append(injected);
    const segments = new Map(), groups = new Map(), groupOrder = [];
    const nodeRefs = new Map();
    for (const [index, sample] of cases.entries()) {
      const group = doc.createElement('div');
      group.className = 'caption-group';
      group.id = 'rtl-group-' + sample.id;
      group.dataset.captionGroupId = sample.id;
      group.dataset.font = sample.face;
      group.dir = sample.dir;
      group.lang = sample.lang;
      group.style.top = (8 + index * 105) + 'px';
      if (sample.id === 'syriac') {
        // A styled subspan around the first complete word must not be
        // mistaken for an authored per-word transformable caption layout.
        const span = doc.createElement('span');
        span.style.color = 'white';
        span.textContent = 'ܫܠܡܐ';
        group.append(span, doc.createTextNode('  ܒܪܝܟܐ ABC-123'));
      } else if (sample.id === 'authored') {
        group.append(...sample.words.map(word => {
          const span = doc.createElement('span');
          span.textContent = word;
          return span;
        }));
      } else group.textContent = sample.text;
      doc.body.append(group);
      nodeRefs.set(sample.id, [...group.childNodes]);
      groupOrder.push(sample.id);
      const segmentIds = sample.words.map((word, i) => {
        const id = sample.id + ':' + i;
        segments.set(id, { text: word });
        return id;
      });
      groups.set(sample.id, { segmentIds });
    }
    // Duplicate stable IDs are ambiguous and must never be selected/transformed.
    for (const n of [0,1]) {
      const duplicate = doc.createElement('div');
      duplicate.className = 'caption-group';
      duplicate.dataset.captionGroupId = 'duplicate';
      duplicate.textContent = 'שלום';
      duplicate.dir = 'rtl';
      duplicate.style.top = (850 + n * 45) + 'px';
      doc.body.append(duplicate);
    }
    groupOrder.push('duplicate');
    segments.set('duplicate:0', { text: 'שלום' });
    groups.set('duplicate', { segmentIds: ['duplicate:0'] });
    const hidden = doc.createElement('div');
    hidden.className = 'caption-group';
    hidden.dataset.captionGroupId = 'hidden';
    hidden.style.opacity = '0';
    hidden.textContent = 'שלום';
    doc.body.append(hidden);
    groupOrder.push('hidden');
    segments.set('hidden:0', { text: 'שלום' });
    groups.set('hidden', { segmentIds: ['hidden:0'] });
    await doc.fonts.ready;
    const model = { segments, groups, groupOrder };
    const overlay = document.getElementById('overlay');
    // Retain the actual Chromium preview objects for the time-varying ancestor probe below.
    window.__rtlCaptionRangeEvidence = { iframe, overlay, model, nodeRefs };
    const before = doc.body.innerHTML;
    const first = window.RTLCaptionRanges.readWordBoxes(iframe, model, overlay);
    const second = window.RTLCaptionRanges.readWordBoxes(iframe, model, overlay);
    const unchangedNodes = cases.every(sample => {
      const group = doc.getElementById('rtl-group-' + sample.id);
      const initial = nodeRefs.get(sample.id);
      return initial.length === group.childNodes.length &&
        initial.every((node, i) => group.childNodes[i] === node);
    });
    const frame = iframe.getBoundingClientRect(), area = overlay.getBoundingClientRect();
    const expected = [];
    for (const [index, sample] of cases.entries()) {
      const group = doc.getElementById('rtl-group-' + sample.id);
      const nodes = [];
      const walker = doc.createTreeWalker(group, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
      const text = nodes.map(node => node.data).join('');
      if (sample.id !== 'authored' && text !== sample.text) throw Error(sample.id + ': authored text mismatch');
      const locate = (offset, after) => {
        let remaining = offset;
        for (const node of nodes) {
          if (remaining < node.length || (!after && remaining === node.length)) return [node, remaining];
          remaining -= node.length;
        }
        const tail = nodes[nodes.length - 1];
        return [tail, tail.length];
      };
      let cursor = 0;
      for (const [wordIndex, word] of sample.words.entries()) {
        const start = text.indexOf(word, cursor);
        if (start < 0) throw Error('Missing exact logical word ' + word);
        const end = start + word.length;
        const [sNode, sOffset] = locate(start, true), [eNode, eOffset] = locate(end, false);
        const range = doc.createRange();
        range.setStart(sNode, sOffset);
        range.setEnd(eNode, eOffset);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
        if (!rects.length) throw Error('Missing actual Range geometry for ' + sample.id + ':' + wordIndex);
        expected.push({ id: sample.id + ':' + wordIndex, editable: sample.id === 'authored',
          x: frame.left - area.left + Math.min(...rects.map(r => r.left)),
          y: frame.top - area.top + Math.min(...rects.map(r => r.top)),
          width: Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left)),
          height: Math.max(...rects.map(r => r.bottom)) - Math.min(...rects.map(r => r.top)) });
        cursor = end;
      }
      if (sample.id !== 'authored' && window.RTLCaptionRanges.getWordEl(iframe, index, 0, model) !== null)
        throw Error(sample.id + ': read-only plain text gained a transformable word element');
    }
    const authoredIndex = groupOrder.indexOf('authored');
    const authored = doc.getElementById('rtl-group-authored');
    const authoredElementIdentity = window.RTLCaptionRanges.getWordEl(iframe, authoredIndex, 0, model) === authored.firstElementChild;
    const duplicateFailClosed = first.every(box => box.groupId !== 'duplicate');
    const hiddenFailClosed = first.every(box => box.groupId !== 'hidden');
    return { first, second, expected, unchangedMarkup: doc.body.innerHTML === before, unchangedNodes,
      authoredElementIdentity, duplicateFailClosed, hiddenFailClosed,
      frameDirection: getComputedStyle(doc.documentElement).direction,
      fontFamilies: cases.map(s => ({ id:s.id, family: doc.defaultView.getComputedStyle(doc.getElementById('rtl-group-' + s.id)).fontFamily })) };
  }, { cases, styles: css.join('\n') });
  const byId = new Map(result.first.map(box => [box.segmentId, box]));
  assert.equal(result.first.length, 20, 'Must measure 18 plain-text including Persian/Urdu + two authored spans, excluding ambiguous/hidden groups');
  assert.deepEqual(result.first, result.second, 'Repeat geometry reads changed caption identities, alignment or positions');
  assert.equal(result.unchangedMarkup, true, 'Caption hit measurement rewrote authored HTML');
  assert.equal(result.unchangedNodes, true, 'Caption hit measurement replaced original Unicode text nodes');
  assert.equal(result.authoredElementIdentity, true, 'Actual authored word lost transformable DOM identity');
  assert.equal(result.duplicateFailClosed, true, 'Duplicate group identifiers caused unsafe word identity reassignment');
  assert.equal(result.hiddenFailClosed, true, 'Hidden caption created hit targets');
  assert.equal(result.frameDirection, 'ltr', 'English application shell no longer LTR');
  for (const row of result.expected) {
    const box = byId.get(row.id);
    assert(box, 'Missing real caption hit target for ' + row.id);
    assert.equal(box.editable, row.editable, row.id + ': lost safe word transform guard');
    for (const key of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(box[key] - row[key]) < 1.5,
        row.id + ': non-destructive RTL geometry diverged from actual Range ' + key + ': ' + JSON.stringify({ box, row }));
    }
  }

  // Exercise real Chromium frames across caption-parent visibility transitions.
  // The visible legacy range and the authored DOM spans share a parent, but
  // neither their logical Unicode nor their selectable identities may change.
  const visibility = await page.evaluate(async () => {
    const { iframe, overlay, model, nodeRefs } = window.__rtlCaptionRangeEvidence;
    const doc = iframe.contentDocument;
    const legacy = doc.getElementById('rtl-group-hebrew');
    const authored = doc.getElementById('rtl-group-authored');
    const originalLegacyText = legacy.textContent;
    const originalAuthoredText = authored.textContent;
    const authoredFirstSpan = authored.firstElementChild;
    const parent = doc.createElement('section');
    parent.id = 'rtl-caption-visibility-parent';
    doc.body.append(parent);
    // Keep the original group, span and text nodes; moving an element is not
    // recreating a caption, and absolute groups keep the same containing block.
    parent.append(legacy, authored);
    const targetGroups = new Set(['hebrew', 'authored']);
    const nextPaint = () => new Promise(resolve => doc.defaultView.requestAnimationFrame(() => resolve()));
    const snapshots = [];
    const capture = (stage, hidden) => {
      const boxes = window.RTLCaptionRanges.readWordBoxes(iframe, model, overlay);
      const nodeIdentity = ['hebrew', 'authored'].every(id => {
        const group = doc.getElementById('rtl-group-' + id);
        const originals = nodeRefs.get(id);
        return originals.length === group.childNodes.length &&
          originals.every((node, index) => group.childNodes[index] === node);
      });
      const authoredIndex = model.groupOrder.indexOf('authored');
      snapshots.push({
        stage, hidden,
        targets: boxes.filter(box => targetGroups.has(box.groupId)),
        otherIds: boxes.filter(box => !targetGroups.has(box.groupId)).map(box => box.segmentId),
        unchangedUnicode: legacy.textContent === originalLegacyText && authored.textContent === originalAuthoredText,
        unchangedNodes: nodeIdentity,
        unchangedAuthoredTarget: window.RTLCaptionRanges.getWordEl(iframe, authoredIndex, 0, model) === authoredFirstSpan,
        frameTimeMs: Math.round(performance.now()),
      });
    };
    await nextPaint();
    capture('visible-before', false);
    const transitions = [
      ['parent-opacity-zero', () => { parent.style.opacity = '0'; }, () => { parent.style.opacity = ''; }],
      ['parent-display-none', () => { parent.style.display = 'none'; }, () => { parent.style.display = ''; }],
      ['parent-visibility-hidden', () => { parent.style.visibility = 'hidden'; }, () => { parent.style.visibility = ''; }],
      ['parent-hidden', () => { parent.hidden = true; }, () => { parent.hidden = false; }],
      ['parent-inert', () => { parent.inert = true; }, () => { parent.inert = false; }],
    ];
    for (const [name, hide, reveal] of transitions) {
      hide();
      await nextPaint();
      capture(name, true);
      reveal();
      await nextPaint();
      capture(name + '-restored', false);
    }
    return { snapshots, parentId: parent.id };
  });
  const targetIds = result.first.filter(box => ['hebrew', 'authored'].includes(box.groupId)).map(box => box.segmentId);
  const unaffectedIds = result.first.filter(box => !['hebrew', 'authored'].includes(box.groupId)).map(box => box.segmentId);
  assert.equal(targetIds.length, 5, 'Must exercise three Hebrew legacy Range hits and two authored spans');
  assert.equal(visibility.snapshots.length, 11, 'Missing Chromium hide/reveal frame');
  for (const state of visibility.snapshots) {
    assert.equal(state.unchangedUnicode, true, state.stage + ': parent toggle changed authored Unicode');
    assert.equal(state.unchangedNodes, true, state.stage + ': parent toggle replaced real text/span nodes');
    assert.equal(state.unchangedAuthoredTarget, true, state.stage + ': authored span identity changed');
    assert.deepEqual(state.otherIds, unaffectedIds, state.stage + ': other scripts gained or lost hit targets');
    assert.deepEqual(state.targets.map(box => box.segmentId), state.hidden ? [] : targetIds,
      state.stage + ': phantom hidden hit target or missing restored word');
    if (!state.hidden) {
      for (const box of state.targets) {
        const original = byId.get(box.segmentId);
        assert.equal(box.editable, original.editable, state.stage + ': changed transform guard');
        for (const key of ['x', 'y', 'width', 'height']) {
          assert(Math.abs(box[key] - original[key]) < 1.5,
            state.stage + ': restoration moved actual Chromium word ' + box.segmentId + ' ' + key);
        }
      }
    }
  }

  const outputDir = process.env.RTL_CAPTION_ARTIFACT_DIR;
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, 'rtl-caption-range-chromium.png') });
    await page.evaluate(() => {
      document.getElementById('preview').contentDocument.getElementById('rtl-caption-visibility-parent').style.opacity = '0';
    });
    await page.screenshot({ path: path.join(outputDir, 'rtl-caption-parent-hidden-chromium.png') });
    await page.evaluate(() => {
      document.getElementById('preview').contentDocument.getElementById('rtl-caption-visibility-parent').style.opacity = '';
    });
    await page.screenshot({ path: path.join(outputDir, 'rtl-caption-parent-restored-chromium.png') });
    await writeFile(path.join(outputDir, 'rtl-caption-range.json'), JSON.stringify({
      passed: true, browser: await browser.version(), pinnedSource: manifest.sourceCommit,
      measuredBoxes: result.first.length, scripts: cases.map(s => s.lang),
      visibility, result, limitation: 'Actual Chromium caption-parent visibility and non-destructive Range/word identities; not real Studio playback, drag editing, exported MP4, or OS IME.',
    }, null, 2) + '\n');
  }
});
