// Real OpenMotion Studio -> source-backed text edit -> native MP4 qualification.
// Uses the existing Puppeteer/native-render integration harness, not a mock DOM.
// Fails closed if the licensed fonts, Studio edit, actual export, or glyph pixels are absent.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { configureNativeEnvironment } from '../scripts/npm-runtime.mjs';
import { pluginRoot } from '../hyperframes.ts';
import { Client } from './shared-editor-client.mjs';
import { readProjectZip } from '../shared/project-zip.ts';
import { closeFixtureEditor } from './fixtures.ts';
import { removeTemporaryRtlProject, stopOwnedWindowsPreviewTree } from './rtl-temp-project-cleanup.mjs';

const output = process.argv[2];
const fontDir = process.argv[3];
assert(output && path.isAbsolute(output), 'Expected absolute evidence directory');
assert(fontDir && path.isAbsolute(fontDir), 'Pinned licensed font directory is mandatory');
await mkdir(output, { recursive: true });
process.env.OPENMOTION_TELEMETRY = '0';
await configureNativeEnvironment(pluginRoot);
const data = await mkdtemp(path.join(tmpdir(), 'openmotion-rtl-studio-export-'));
const client = new Client(data);
const evidence = { passed: false, scope: `${process.platform} Studio browser, source-backed UI edit and native exported MP4`, checks: [] };
const assertStep = (name, details = {}) => { evidence.checks.push({ name, ...details }); console.log('PASS ' + name); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const originalHebrew = 'שָׁלוֹם OpenMotion 2026';
const editedHebrew = 'שָׁלוֹם OpenMotion 2030';
const samples = [
  { id: 'label', face: 'hebrew', lang: 'he', dir: 'rtl', copy: originalHebrew },
  { id: 'arabic', face: 'arabic', lang: 'ar', dir: 'rtl', copy: 'السَّلَامُ OpenMotion 25%' },
  { id: 'persian', face: 'arabic', lang: 'fa', dir: 'rtl', copy: 'فارسی پ چ ژ گ ۲۰۲۶' },
  { id: 'urdu', face: 'urdu', lang: 'ur', dir: 'rtl', copy: 'اردو ٹ ڈ ڑ ں ے' },
  { id: 'syriac', face: 'syriac', lang: 'syr', dir: 'rtl', copy: 'ܫܠܡܐ ܒܪܝܟܐ' },
  { id: 'ethiopic', face: 'ethiopic', lang: 'am', dir: 'ltr', copy: 'ሰላም ኢትዮጵያ' },
  { id: 'latin', face: 'latin', lang: 'en', dir: 'ltr', copy: 'Render ABC-123 at 10:30' },
];
const background = [24, 56, 47];
const width = 640, height = 480;
let browser, page, ownedPreviewUrl;
function decodeToRgb(input, isVideo, atSeconds = 0.5) {
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (isVideo) args.push('-ss', String(atSeconds));
  args.push('-i', input, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1');
  const result = spawnSync(ffmpeg, args, { maxBuffer: 10 * 1024 * 1024 });
  assert.equal(result.status, 0, 'FFmpeg frame decode failed: ' + result.stderr?.toString().slice(-1500));
  assert.equal(result.stdout.length, width * height * 3, 'Unexpected decoded frame dimensions');
  return result.stdout;
}
function ink(buffer, x, y) {
  const pos = (y * width + x) * 3;
  return Math.max(...background.map((value, channel) => Math.abs(buffer[pos + channel] - value))) > 65;
}
function compareRows(preview, rendered) {
  const rows = [];
  for (let index = 0; index < samples.length; index++) {
    const top = 16 + index * 62, bottom = Math.min(height, top + 57);
    let expected = 0, actual = 0, intersection = 0, union = 0, error = 0;
    for (let y = top; y < bottom; y++) for (let x = 20; x < width - 20; x++) {
      const a = ink(preview, x, y), b = ink(rendered, x, y);
      expected += Number(a); actual += Number(b);
      intersection += Number(a && b); union += Number(a || b);
      const offset = (y * width + x) * 3;
      for (let color = 0; color < 3; color++) error += Math.abs(preview[offset + color] - rendered[offset + color]);
    }
    const pixels = (bottom - top) * (width - 40);
    const row = { script: samples[index].lang, expectedInk: expected, exportedInk: actual, intersectionOverUnion: union ? intersection / union : 0, meanRgbError: error / (pixels * 3) };
    assert(expected > 90, samples[index].lang + ': reference screenshot contains no visible text');
    assert(actual > 90, samples[index].lang + ': MP4 frame contains no visible text');
    assert(row.intersectionOverUnion >= 0.45, samples[index].lang + ': lost or displaced glyphs in MP4: ' + JSON.stringify(row));
    assert(row.meanRgbError <= 22, samples[index].lang + ': preview/MP4 RGB mismatch: ' + JSON.stringify(row));
    rows.push(row);
  }
  return rows;
}
// Only background highlight changes with playback; word contents and text nodes
// remain authored, so rendered frames can be compared at two seek positions.
// Strict perceptual-near-reference yellow classifier. The old loose channel
// gates also counted brown/orange antialiased Arabic glyph pixels as yellow.
// Exact #facc15 palette distance keeps actual FFmpeg/PNG RGB rounding tolerance.
function yellowPixels(rgb, rect) {
  let count = 0;
  const left = Math.max(0, Math.floor(rect.left)), right = Math.min(width, Math.ceil(rect.right));
  const top = Math.max(0, Math.floor(rect.top)), bottom = Math.min(height, Math.ceil(rect.bottom));
  assert(right > left + 5 && bottom > top + 5, 'Timed caption has no measurable word geometry');
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const pos = (y * width + x) * 3;
    const dr = rgb[pos] - 250, dg = rgb[pos + 1] - 204, db = rgb[pos + 2] - 21;
    if (dr * dr + dg * dg + db * db <= 55 * 55) count++;
  }
  return count;
}
function compositionHtml(fontPaths) {
  const css = Object.entries(fontPaths).map(([face, url]) => '@font-face{font-family:"OM RTL ' + face + '";src:url("' + url + '") format("truetype");font-weight:100 900;font-style:normal;font-display:block}').join('\n');
  const rows = samples.map((sample, index) => '<div class="sample" id="' + sample.id + '" dir="' + sample.dir + '" lang="' + sample.lang + '" data-start="0" data-duration="1" data-track-index="' + index + '" style="top:' + (16 + index * 62) + 'px;font-family:' + (sample.face ? "'OM RTL " + sample.face + "'" : 'Arial,sans-serif') + ';">' + sample.copy + '</div>').join('\n');
  const timedCaption = '<div id="timed-caption" dir="rtl" lang="he" data-start="0" data-duration="1" data-track-index="7">'
    + '<span id="caption-he" lang="he" dir="rtl">שָׁלוֹם</span> '
    + '<span id="caption-ar" lang="ar" dir="rtl">السَّلَامُ</span></div>';
  return '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>body{margin:0}' + css + '#main{width:640px;height:480px;position:relative;overflow:hidden;background:#18382f;color:#fff}.sample{position:absolute;left:24px;width:592px;height:57px;line-height:1.45;font-size:30px;font-weight:400;white-space:nowrap;overflow:hidden;text-align:start}#timed-caption{position:absolute;top:451px;left:24px;width:592px;height:29px;line-height:1.2;font-size:21px;text-align:start;white-space:nowrap;overflow:hidden}#timed-caption span{display:inline-block;padding:1px 5px;background:transparent;color:white}#caption-he{font-family:\"OM RTL hebrew\"}#caption-ar{font-family:\"OM RTL arabic\"}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="1" data-width="640" data-height="480" data-fps="10">' + rows + timedCaption + '</div><script>window.__timelines={main:gsap.timeline({paused:true}).to("#label",{opacity:1,duration:1,ease:"none"},0).set("#caption-he",{backgroundColor:"#facc15"},0.01).set("#caption-ar",{backgroundColor:"transparent"},0.01).set("#caption-he",{backgroundColor:"transparent"},0.5).set("#caption-ar",{backgroundColor:"#facc15"},0.5)};</script></body></html>';
}
async function findStudioFrame(page, copy) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const found = await frame.$eval('#label', element => element.textContent).catch(() => null);
      if (found === copy) return frame;
    }
    await sleep(150);
  }
  throw new Error('Real Studio player iframe did not render expected text');
}
// The Windows end-to-end gate can finish every browser/MP4 assertion and
// still stall on an owned child-process shutdown. Bound only teardown, keep
// every rendering/source assertion, and report what actually needed recovery.
async function cleanupWithin(label, operation, timeoutMs) {
  let timer;
  const result = await Promise.race([
    Promise.resolve().then(operation).then(() => ({ complete: true }), error => ({ complete: true, error })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ complete: false }), timeoutMs); }),
  ]);
  clearTimeout(timer);
  if (result.error) throw result.error;
  if (!result.complete) console.warn('RTL teardown deadline reached: ' + label);
  return result.complete;
}
function processExited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
}

try {
  const manifest = JSON.parse(await readFile(path.join(fontDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.faces.length, 5);
  for (const face of manifest.faces) {
    assert.equal(sha256(await readFile(path.join(fontDir, face.filename))), face.fontSha256);
    assert.equal(sha256(await readFile(path.join(fontDir, face.licenseFilename))), face.licenseSha256);
  }
  // The Latin control must use the same portable project-font path as every
  // Semitic face. The previous unpinned Arial fallback produced a 0.2535
  // preview/MP4 ink IoU despite identical logical source (run 44885930705).
  const latinPath = path.join(pluginRoot, 'tests/fixtures/fonts/orbitron.ttf');
  const latinLicensePath = path.join(pluginRoot, 'tests/fixtures/fonts/OFL.txt');
  const fontSources = [
    ...manifest.faces.map(face => ({ ...face, sourcePath: path.join(fontDir, face.filename), licensePath: path.join(fontDir, face.licenseFilename) })),
    { id: 'latin', sourcePath: latinPath, licensePath: latinLicensePath,
      fontSha256: sha256(await readFile(latinPath)), licenseSha256: sha256(await readFile(latinLicensePath)) },
  ];
  await client.initialize();
  const created = await client.call('openmotion_create_project', { projectType: 'natural_language', title: 'RTL Studio / MP4 parity', requirements: 'Offline imported script fonts; reversible logical Unicode editing; silent deterministic render.', requestId: 'rtl-create' });
  const projectId = created.projectId;
  const imported = await client.call('openmotion_import_assets', {
    projectId, requestId: 'rtl-fonts',
    items: fontSources.map(face => ({ itemId: face.id, sourcePath: face.sourcePath, licensePath: face.licensePath })),
  });
  assert.equal(imported.status, 'completed', JSON.stringify(imported.items));
  const fonts = {};
  for (const face of fontSources) {
    const item = imported.items.find(candidate => candidate.itemId === face.id);
    assert.equal(item?.status, 'completed', 'Font import failed for ' + face.id);
    assert.equal(sha256(await readFile(path.join(data, 'projects', projectId, item.path)).catch(async () => readFile(path.join(data, 'project', item.path)))), face.fontSha256, 'Imported font bytes differ for ' + face.id);
    fonts[face.id] = item.path;
  }
  let current = await client.call('openmotion_get_project', { projectId });
  const source = compositionHtml(fonts);
  const saved = await client.call('openmotion_edit_project', {
    projectId, expectedRevision: current.revision, expectedVersionId: current.currentVersionId, requestId: 'rtl-author',
    files: [{ path: 'index.html', content: source }, { path: 'assets/gsap.min.js', content: await readFile(path.join(pluginRoot, 'node_modules/gsap/dist/gsap.min.js'), 'utf8') }],
  });
  assert(saved.revision, 'Expected versioned editor write');
  const preview = await client.call('openmotion_open_preview', { projectId });
  // Phase-1's previewUrl is a viewer page with a session path/query/hash.
  // Teardown authenticates the local preview SERVICE origin, not the viewer URL.
  ownedPreviewUrl = preview.serverUrl || new URL(preview.previewUrl).origin;
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || await browserExecutable(), headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(40_000);
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
  await page.goto(preview.previewUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-timeline-element-count]')?.getAttribute('data-timeline-element-count')) >= 7);
  let frame = await findStudioFrame(page, originalHebrew);
  const loaded = await frame.evaluate(async () => {
    await document.fonts.ready;
    return ['label','arabic','persian','urdu','syriac','ethiopic','latin'].map(id => {
      const el = document.getElementById(id), style = getComputedStyle(el);
      return { id, text: el.textContent, dir: el.getAttribute('dir'), lang: el.getAttribute('lang'), computedDirection: style.direction, width: el.getBoundingClientRect().width };
    });
  });
  for (const sample of samples) {
    const seen = loaded.find(value => value.id === sample.id);
    assert.deepEqual([seen?.text, seen?.dir, seen?.lang, seen?.computedDirection], [sample.copy, sample.dir, sample.lang, sample.dir], sample.id);
    assert(seen.width > 200, sample.id + ' is missing geometry');
  }
  await page.screenshot({ path: path.join(output, 'studio-before-edit.png') });
  assertStep('Real Studio player loaded all RTL scripts and Ethiopic/LTR with logical source', { samples: loaded });
  await page.click('button[aria-label^="Label,"]');
  await page.waitForFunction(() => document.querySelector('[data-flat-group-open="true"]')?.textContent?.includes('Font'));
  const field = await page.waitForSelector('[data-flat-group-open="true"] textarea');
  assert(field, 'Expected source-backed real Studio Content editor');
  await field.focus();
  // Select via the real textarea selection API, not an OS-dependent keyboard
  // shortcut. This gate tests Unicode text replacement and MP4 parity; native
  // Select All / caret affinity needs its own independent interaction gate.
  const sourceBefore = await field.evaluate(element => element.value);
  assert.equal(sourceBefore, originalHebrew, 'Wrong selected Studio Content field');
  const selected = await field.evaluate(element => {
    element.setSelectionRange(0, element.value.length);
    return { start: element.selectionStart, end: element.selectionEnd, length: element.value.length };
  });
  assert.deepEqual([selected.start, selected.end], [0, selected.length], 'Content selection did not span the logical source');
  // Puppeteer's supported CDP text insertion emits actual input events.
  await page.keyboard.sendCharacter(editedHebrew);
  assert.equal(await field.evaluate(element => element.value), editedHebrew, 'Content input did not fully replace logical source');
  await page.keyboard.press('Tab');
  let edited = false, conflictingReads = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      current = await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } });
    } catch (error) {
      // During a real native Studio autosave the source can change between
      // stat and hash. Read-only VERSION_CONFLICT is explicitly retriable;
      // write conflicts, other errors and an unpersisted edit still fail.
      if (error?.code !== 'VERSION_CONFLICT') throw error;
      conflictingReads++;
      await sleep(200);
      continue;
    }
    if (JSON.stringify(current.file).includes(editedHebrew)) { edited = true; break; }
    await sleep(200);
  }
  evidence.conflictingReadAttempts = conflictingReads;
  assert(edited, 'Real Studio text edit did not persist the exact logical Unicode string');
  assert(!JSON.stringify(current.file).includes(originalHebrew), 'Old Hebrew source text still present after Studio edit');
  frame = await findStudioFrame(page, editedHebrew);
  await page.screenshot({ path: path.join(output, 'studio-after-edit.png') });
  assertStep('UI Content editor persisted Hebrew niqqud and mixed English/numerals', { newText: editedHebrew, revision: current.revision });
  // Qualify the actual Studio transport, not only the raw composition's
  // GSAP timeline. Pointer-seek forwards, backwards, then repeat: a player
  // wired to the wrong timeline could otherwise pass all MP4 parity gates.
  const seekInput = await page.waitForSelector(
    'input[data-studio-control="seek-preview"]:not(:disabled)', { timeout: 30_000 });
  assert(seekInput, 'Real Studio seek input is unavailable');
  const sliderDuration = await seekInput.evaluate(input => Number(input.max));
  assert(sliderDuration >= 0.95 && sliderDuration <= 1.05,
    'Studio duration differs from the authored one-second composition: ' + sliderDuration);
  await seekInput.evaluate(input => input.scrollIntoView({ block: 'center' }));
  const studioSeeks = [];
  const repeatedStudioStates = new Map();
  for (const [seekIndex, expectedTime] of [0.25, 0.75, 0.25, 0.75].entries()) {
    const bounds = await seekInput.boundingBox();
    assert(bounds && bounds.width > 150 && bounds.height > 0, 'Studio seek input has no pointer geometry');
    const inset = Math.min(14, bounds.height / 2);
    await seekInput.click({ offset: {
      x: inset + (bounds.width - 2 * inset) * expectedTime / sliderDuration,
      y: bounds.height / 2,
    } });
    const actualTime = await seekInput.evaluate(input => input.valueAsNumber);
    assert(Math.abs(actualTime - expectedTime) <= 0.08,
      'Native Studio slider missed the seek: ' + JSON.stringify({ expectedTime, actualTime }));
    let state;
    for (let attempt = 0; attempt < 50; attempt++) {
      frame = await findStudioFrame(page, editedHebrew);
      state = await frame.evaluate(() => {
        const he = document.getElementById('caption-he'), ar = document.getElementById('caption-ar');
        if (!he || !ar) return null;
        window.__rtlStudioCaptionNodes ??= [he.firstChild, ar.firstChild];
        return {
          unchangedNodes: he.firstChild === window.__rtlStudioCaptionNodes[0]
            && ar.firstChild === window.__rtlStudioCaptionNodes[1],
          text: document.getElementById('timed-caption')?.textContent,
          heColor: getComputedStyle(he).backgroundColor,
          arColor: getComputedStyle(ar).backgroundColor,
        };
      });
      const yellow = color => /250,\s*204,\s*21/.test(color || '');
      if (state && yellow(state.heColor) === (expectedTime < 0.5)
        && yellow(state.arColor) === (expectedTime > 0.5)) break;
      await sleep(100);
    }
    assert(state, 'Studio player iframe lost authored timed caption on seek');
    assert.equal(state.text, 'שָׁלוֹם السَّلَامُ', 'Studio preview seek altered RTL Unicode text');
    assert(state.unchangedNodes, 'Studio preview seek replaced an authored caption text node');
    const yellow = color => /250,\s*204,\s*21/.test(color || '');
    assert.equal(yellow(state.heColor), expectedTime < 0.5, 'Studio Hebrew highlight wrong at ' + expectedTime);
    assert.equal(yellow(state.arColor), expectedTime > 0.5, 'Studio Arabic highlight wrong at ' + expectedTime);
    const previous = repeatedStudioStates.get(expectedTime);
    if (previous) assert.deepEqual(state, previous, 'Repeated real Studio scrub changed the caption state');
    else repeatedStudioStates.set(expectedTime, state);
    studioSeeks.push({ seekIndex, expectedTime, actualTime, ...state });
  }
  await page.screenshot({ path: path.join(output, 'studio-after-reverse-seek.png') });
  assertStep('Actual Studio seek control reverses and replays RTL word highlights without mutation', { studioSeeks });
  const direct = await browser.newPage();
  await direct.setViewport({ width, height, deviceScaleFactor: 1 });
  const route = new URL('/api/projects/' + encodeURIComponent(projectId) + '/preview/index.html', new URL(preview.previewUrl).origin);
  await direct.goto(route.href, { waitUntil: 'load' });
  await direct.waitForSelector('#main');
  const raw = await direct.evaluate(async () => { await document.fonts.ready; return document.getElementById('label').textContent; });
  assert.equal(raw, editedHebrew, 'Direct preview route does not match Studio player edit');
  const cdp = await direct.createCDPSession();
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const dom = await cdp.send('DOM.getDocument');
  const fontUsage = {};
  for (const sample of samples.filter(item => item.face)) {
    const node = await cdp.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#' + sample.id });
    const found = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
    fontUsage[sample.lang] = found.fonts.map(row => ({ familyName: row.familyName, isCustomFont: row.isCustomFont, glyphCount: row.glyphCount }));
    assert(fontUsage[sample.lang].some(row => row.isCustomFont && row.glyphCount > 0), sample.lang + ': imported font not used by browser');
  }
  const png = path.join(output, 'preview-frame.png');
  await direct.screenshot({ path: png, clip: { x: 0, y: 0, width, height } });
  // Seek forward, reverse, then forward again using the same authored GSAP
  // timeline as the native renderer. A stale tween or destructive caption
  // measurement can pass a one-way test but fail when scrubbing backwards.
  // Never split or replace authored caption text nodes.
  const timedPreviews = [];
  const priorSeekStates = new Map();
  for (const [seekIndex, time] of [0.25, 0.75, 0.25, 0.75].entries()) {
    const layout = await direct.evaluate(at => {
      const timeline = window.__timelines?.main;
      if (!timeline || typeof timeline.pause !== 'function') throw Error('Missing authored GSAP timeline');
      const caption = document.getElementById('timed-caption');
      const he = document.getElementById('caption-he'), ar = document.getElementById('caption-ar');
      if (!caption || !he || !ar) throw Error('Timed caption word spans not rendered');
      const nodes = [he.firstChild, ar.firstChild];
      window.__rtlOriginalCaptionNodes ??= nodes;
      const unchanged = nodes.every((node, index) => node === window.__rtlOriginalCaptionNodes[index]);
      timeline.pause(at);
      const measure = el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      return { unchanged, text: caption.textContent, he: measure(he), ar: measure(ar),
        heColor: getComputedStyle(he).backgroundColor, arColor: getComputedStyle(ar).backgroundColor };
    }, time);
    assert(layout.unchanged, 'Playback replaced an authored caption text node');
    assert.equal(layout.text, 'שָׁלוֹם السَّلَامُ', 'Playback mutated Unicode caption content');
    const yellow = color => /250,\s*204,\s*21/.test(color);
    assert.equal(yellow(layout.heColor), time < 0.5, 'Hebrew timed highlight state differs from authored timeline');
    assert.equal(yellow(layout.arColor), time > 0.5, 'Arabic timed highlight state differs from authored timeline');
    const screenshot = path.join(output, 'preview-caption-seek-' + seekIndex + '-' + time + '.png');
    await direct.screenshot({ path: screenshot, clip: { x: 0, y: 0, width, height } });
    const pixels = decodeToRgb(screenshot, false);
    const heYellow = yellowPixels(pixels, layout.he);
    const arYellow = yellowPixels(pixels, layout.ar);
    assert((time < 0.5 ? heYellow : arYellow) > 70, 'Expected real browser caption highlight absent');
    assert((time < 0.5 ? arYellow : heYellow) < 25, 'Untimed caption word unexpectedly highlighted');
    const seekState = {
      he: layout.he, ar: layout.ar,
      heColor: layout.heColor, arColor: layout.arColor,
      browserYellow: { he: heYellow, ar: arYellow },
    };
    const previous = priorSeekStates.get(time);
    if (previous) {
      assert.deepEqual(seekState, previous,
        'Reverse/forward seeking changed the repeated caption geometry or highlight state at ' + time);
    } else {
      priorSeekStates.set(time, seekState);
    }
    timedPreviews.push({ seekIndex, time, screenshot, layout, browserYellow: seekState.browserYellow });
  }
  await direct.close();
  assertStep('Project-local licensed fonts actually used by Chromium', { fontUsage });
  current = await client.call('openmotion_get_project', { projectId });
  const queued = await client.call('openmotion_export_request', {
    projectId, versionId: current.currentVersionId, expectedRevision: current.revision,
    requestId: 'rtl-export', compositionPath: 'index.html', audio: 'silent',
  });
  let completed;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { exportJob } = await client.call('openmotion_get_project', { projectId, exportJobId: queued.job.id });
    assert.notEqual(exportJob.state, 'failed', 'Native export failed: ' + JSON.stringify(exportJob));
    if (exportJob.state === 'completed') { completed = exportJob; break; }
    await sleep(500);
  }
  assert(completed, 'Native MP4 export timed out');
  assert.equal(completed.verification.status, 'passed', 'Export verification failed');
  assert.equal(completed.expected.width, width); assert.equal(completed.expected.height, height);
  const mp4 = path.join(output, 'exported-rtl.mp4');
  await copyFile(completed.path, mp4);
  // Persist an actual decoded frame alongside the captured Chromium preview.
  const decoded = path.join(output, 'exported-mp4-frame.png');
  const frameResult = spawnSync(process.env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', '0.5', '-i', mp4, '-frames:v', '1', '-y', decoded]);
  assert.equal(frameResult.status, 0, 'Could not retain MP4 frame: ' + frameResult.stderr?.toString().slice(-1000));
  const rows = compareRows(decodeToRgb(png, false), decodeToRgb(mp4, true));
  assertStep('Actual decoded MP4 preserves each script row and preview glyph geometry', { rows, exportVerification: completed.verification });
  const temporal = [];
  for (const capture of timedPreviews) {
    const rgb = decodeToRgb(mp4, true, capture.time);
    const heYellow = yellowPixels(rgb, capture.layout.he);
    const arYellow = yellowPixels(rgb, capture.layout.ar);
    const active = capture.time < 0.5 ? 'he' : 'ar';
    const inactive = capture.time < 0.5 ? 'ar' : 'he';
    const videoYellow = { he: heYellow, ar: arYellow };
    assert(videoYellow[active] > 70, 'MP4 timed caption highlight missing at ' + capture.time);
    assert(videoYellow[inactive] < 25, 'MP4 contains a stale timed caption highlight at ' + capture.time);
    const drift = Math.abs(videoYellow[active] - capture.browserYellow[active])
      / Math.max(videoYellow[active], capture.browserYellow[active]);
    assert(drift <= 0.3, 'Browser/MP4 timed highlight geometry mismatch: ' + JSON.stringify({ time: capture.time, drift, videoYellow, browserYellow: capture.browserYellow }));
    temporal.push({ seekIndex: capture.seekIndex, time: capture.time, active, browserYellow: capture.browserYellow, videoYellow, areaDrift: drift });
  }
  assertStep('Timed Hebrew/Arabic word highlighting survives forward/reverse/replay seeks and MP4 parity without caption text-node mutation', { temporal });
  // Production project ZIP export must preserve source Unicode and actual
  // imported font/LICENSE bytes, not merely look right in Chrome.
  // Import into an independent project to catch missing relative assets.
  const originalBeforeArchive = await client.call('openmotion_get_project', {
    projectId, file: { path: 'index.html' },
  });
  const archive = await client.call('openmotion_project_archive', {
    action: 'export', requestId: 'rtl-offline-archive-export', projectIds: [projectId],
  });
  assert(typeof archive.archivePath === 'string' && archive.archivePath,
    'Offline export did not return an archive path');
  const entries = readProjectZip(await readFile(archive.archivePath));
  const manifestEntry = entries.get('openmotion-projects.json');
  assert(manifestEntry, 'Offline export missing project manifest');
  const archiveManifest = JSON.parse(manifestEntry.toString('utf8'));
  assert.equal(archiveManifest.projects.length, 1, 'RTL archive must contain exactly one project');
  const archiveRoot = archiveManifest.projects[0].root;
  assert.equal(typeof archiveRoot, 'string', 'Missing versioned archive root');
  const exportedHtml = entries.get(archiveRoot + '/index.html');
  assert(exportedHtml, 'Offline export missing edited composition');
  assert(exportedHtml.toString('utf8').includes(editedHebrew), 'Archive lost edited Hebrew niqqud/Latin copy');
  assert(!exportedHtml.toString('utf8').includes(originalHebrew), 'Archive restored stale pre-edit text');
  const assetFiles = [];
  for (const face of fontSources) {
    const asset = imported.items.find(item => item.itemId === face.id);
    assert(asset?.path && asset?.license?.path, 'Missing imported font/license paths: ' + face.id);
    for (const [relative, originalPath] of [[asset.path, face.sourcePath], [asset.license.path, face.licensePath]]) {
      const archived = entries.get(archiveRoot + '/' + relative);
      assert(archived, 'Offline archive missing asset: ' + relative);
      const original = await readFile(originalPath);
      assert.deepEqual(archived, original, 'Offline archive changed bytes: ' + relative);
      assetFiles.push({ path: relative, sha256: sha256(archived) });
    }
  }
  const restored = await client.call('openmotion_project_archive', {
    action: 'import', requestId: 'rtl-offline-archive-import', sourcePath: archive.archivePath,
  });
  assert.equal(restored.projects.length, 1, 'Offline reimport did not restore exactly one project');
  const restoredId = restored.projects[0].projectId;
  assert(restoredId && restoredId !== projectId, 'Offline import must create an independent project');
  const restoredSource = await client.call('openmotion_get_project', {
    projectId: restoredId, file: { path: 'index.html' },
  });
  assert(JSON.stringify(restoredSource.file).includes(editedHebrew), 'Reimport lost edited logical Unicode text');
  assert(!JSON.stringify(restoredSource.file).includes(originalHebrew), 'Reimport restored stale pre-edit text');
  for (const face of fontSources) {
    const asset = imported.items.find(item => item.itemId === face.id);
    assert.deepEqual(
      await readFile(path.join(data, 'projects', restoredId, asset.path)),
      await readFile(face.sourcePath),
      'Reimport changed font bytes: ' + face.id,
    );
    assert.deepEqual(
      await readFile(path.join(data, 'projects', restoredId, asset.license.path)),
      await readFile(face.licensePath),
      'Reimport changed font license bytes: ' + face.id,
    );
  }
  const originalAfterArchive = await client.call('openmotion_get_project', {
    projectId, file: { path: 'index.html' },
  });
  assert.deepEqual(originalAfterArchive.file, originalBeforeArchive.file,
    'Archive round-trip changed the original authored project');
  assertStep('Offline ZIP reimport retained exact edited Unicode and six licensed font assets', {
    restoredProjectId: restoredId, assets: assetFiles,
  });
  assert.deepEqual(consoleErrors, [], 'Studio page errors');
  evidence.passed = true;
  evidence.browser = await browser.version();
  evidence.fonts = fontSources.map(({ id, fontSha256, licenseSha256 }) => ({ id, fontSha256, licenseSha256 }));
  evidence.comparison = rows;
  evidence.temporalCaptions = temporal;
} catch (error) {
  evidence.error = String(error?.stack || error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  evidence.mcpStderr = client.stderr?.slice(-2500);
  // Persist the primary test outcome before any teardown. A cleanup failure
  // must not hide a real editor/renderer failure from the uploaded artifact.
  await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  const cleanupErrors = [], cleanupRecoveries = [];
  async function cleanup(label, operation) {
    console.log('RTL teardown start: ' + label);
    try { await operation(); console.log('RTL teardown done: ' + label); }
    catch (error) {
      cleanupErrors.push(label + ': ' + String(error));
      console.error('RTL teardown failed: ' + label, error);
    }
  }
  await cleanup('Chromium', async () => {
    if (!browser) return;
    if (await cleanupWithin('Chromium graceful close', () => browser.close(), 15_000)) return;
    // Only this integration's Puppeteer-launched process may be terminated.
    const owned = browser.process();
    assert(owned, 'Chromium timed out, and no owned browser process is available');
    if (owned.exitCode === null && owned.signalCode === null) {
      assert(owned.kill('SIGTERM'), 'Could not terminate test-owned Chromium');
    }
    assert(await cleanupWithin('Chromium exit', () => processExited(owned), 10_000),
      'Test-owned Chromium did not exit after termination');
    cleanupRecoveries.push('Terminated test-owned Chromium after graceful-close timeout');
  });
  await cleanup('MCP child', async () => {
    if (await cleanupWithin('MCP graceful EOF', () => client.close(), 15_000)) return;
    // This child was created solely for this temporary project. Do not
    // terminate or restart an external/shared OpenMotion instance.
    const owned = client.child;
    if (owned.exitCode === null && owned.signalCode === null) {
      assert(owned.kill('SIGTERM'), 'Could not terminate test-owned MCP child');
    }
    assert(await cleanupWithin('MCP exit', () => client.closed, 10_000),
      'Test-owned MCP child did not exit after termination');
    cleanupRecoveries.push('Terminated test-owned MCP child after graceful EOF timeout');
  });
  await cleanup('owned Windows preview service tree', async () => {
    if (process.platform !== 'win32' || !ownedPreviewUrl) return;
    const result = await stopOwnedWindowsPreviewTree(data, ownedPreviewUrl);
    evidence.windowsPreviewTeardown = result;
    console.log('RTL verified owned preview service stopped: ' + JSON.stringify(result));
  });
  await cleanup('fixture editor', () => cleanupWithin('fixture editor shutdown', () => closeFixtureEditor(data), 30_000)
    .then(done => assert(done, 'Fixture editor shutdown exceeded 30 seconds')));
  await cleanup('temporary project', () => cleanupWithin('temporary project removal',
    async () => {
      const result = await removeTemporaryRtlProject(data, {
        onRetry: retry => console.warn('RTL temp directory removal retry: ' + JSON.stringify(retry)),
      });
      evidence.cleanupRemoval = result;
      if (result.retries.length) cleanupRecoveries.push('Removed owned project after ' + result.retries.length + ' transient filesystem errors');
    }, 90_000)
    .then(done => assert(done, 'Temporary project removal exceeded 90 seconds')));
  evidence.cleanup = { recoveries: cleanupRecoveries, errors: cleanupErrors };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  if (evidence.passed && cleanupErrors.length) throw new Error('RTL integration teardown failed: ' + cleanupErrors.join('; '));
}
