// Real OpenMotion Studio -> source-backed text edit -> native MP4 qualification.
// Uses the existing Puppeteer/native-render integration harness, not a mock DOM.
// Fails closed if the licensed fonts, Studio edit, actual export, or glyph pixels are absent.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { paintedCaptionSeekTimes, verifyPaintedCaptionMovement } from '../scripts/rtl-verify-cross-os-fonts.mjs';
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
import { readLiveFrameText } from './rtl-preview-frame-read.mjs';
import { armRtlPostCleanupWatchdog } from './rtl-post-cleanup-watchdog.mjs';
import { releaseExitedOwnedChildStdio } from './rtl-owned-child-stdio.mjs';

const output = process.argv[2];
const fontDir = process.argv[3];
assert(process.argv.length <= 5 && (process.argv[4] === undefined || process.argv[4] === '--woff1'),
  'Unsupported RTL webfont qualification mode');
const woff1 = process.argv[4] === '--woff1';
const webfontFormat = woff1 ? 'woff' : 'woff2';
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
function captionInkPixels(rgb) {
  // Check the entire caption lane, not just the yellow highlight: an opacity
  // regression must not leave white glyphs visible in browser or native MP4.
  let pixels = 0;
  for (let y = 451; y < height; y++) for (let x = 24; x < width - 24; x++) {
    if (ink(rgb, x, y)) pixels++;
  }
  return pixels;
}
// Measure painted highlight position in both the real Chromium screenshot and
// independently decoded native MP4; CSS transforms alone cannot prove parity.
function yellowCentroid(rgb) {
  let pixels = 0, sumX = 0, sumY = 0;
  for (let y = 451; y < height; y++) for (let x = 24; x < width - 24; x++) {
    const pos = (y * width + x) * 3;
    const dr = rgb[pos] - 250, dg = rgb[pos + 1] - 204, db = rgb[pos + 2] - 21;
    if (dr * dr + dg * dg + db * db > 55 * 55) continue;
    pixels++; sumX += x; sumY += y;
  }
  return pixels ? { x: sumX / pixels, y: sumY / pixels, pixels } : null;
}
function compositionHtml(fontPaths) {
  const css = Object.entries(fontPaths).map(([face, url]) => {
    const lower = url.toLowerCase();
    const format = lower.endsWith('.woff2') ? 'woff2' : lower.endsWith('.woff') ? 'woff' : 'truetype';
    return '@font-face{font-family:"OM RTL ' + face + '";src:url("' + url + '") format("' + format + '");font-weight:100 900;font-style:normal;font-display:block}';
  }).join('\n');
  const rows = samples.map((sample, index) => '<div class="sample" id="' + sample.id + '" dir="' + sample.dir + '" lang="' + sample.lang + '" data-start="0" data-duration="1" data-track-index="' + index + '" style="top:' + (16 + index * 62) + 'px;font-family:' + (sample.face ? "'OM RTL " + sample.face + "'" : 'Arial,sans-serif') + ';">' + sample.copy + '</div>').join('\n');
  const timedCaption = '<div id="timed-caption" dir="rtl" lang="he" data-start="0" data-duration="1" data-track-index="7">'
    + '<span id="caption-he" lang="he" dir="rtl">שָׁלוֹם</span> '
    + '<span id="caption-ar" lang="ar" dir="rtl">السَّلَامُ</span></div>';
  return '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>body{margin:0}' + css + '#main{width:640px;height:480px;position:relative;overflow:hidden;background:#18382f;color:#fff}.sample{position:absolute;left:24px;width:592px;height:57px;line-height:1.45;font-size:30px;font-weight:400;white-space:nowrap;overflow:hidden;text-align:start}#timed-caption{position:absolute;top:451px;left:24px;width:592px;height:29px;line-height:1.2;font-size:21px;text-align:start;white-space:nowrap;overflow:hidden}#timed-caption span{display:inline-block;padding:1px 5px;background:transparent;color:white}#caption-he{font-family:\"OM RTL hebrew\"}#caption-ar{font-family:\"OM RTL arabic\"}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="1" data-width="640" data-height="480" data-fps="10">' + rows + timedCaption + '</div><script>window.__timelines={main:gsap.timeline({paused:true}).to("#label",{opacity:1,duration:1,ease:"none"},0).to("#caption-he",{x:-32,duration:1,ease:"none"},0).to("#caption-ar",{x:-32,duration:1,ease:"none"},0).set("#caption-he",{backgroundColor:"#facc15"},0.01).set("#caption-ar",{backgroundColor:"transparent"},0.01).set("#caption-he",{backgroundColor:"transparent"},0.5).set("#caption-ar",{backgroundColor:"#facc15"},0.5).set("#timed-caption",{opacity:0},0.35).set("#timed-caption",{opacity:1},0.65)};</script></body></html>';
}
async function findStudioFrame(page, copy) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const found = await readLiveFrameText(frame, '#label');
      if (found === copy) return frame;
    }
    await sleep(150);
  }
  throw new Error('Real Studio player iframe did not render expected text');
}
// The selected Studio Content inspector is React-controlled. A previously
// captured ElementHandle can be detached when the timeline/inspector rerenders
// after a real click (macOS 45008326986). Puppeteer's Locator re-resolves the
// live textarea before clicking, so a pre-input detach can safely recover
// WITHOUT retrying a rejected character insertion or mutating DOM values.
async function replaceStudioInspectorText(page, before, after, script) {
  await page.locator('[data-flat-group-open="true"] textarea')
    .filter(element => element.isConnected)
    .setTimeout(15_000)
    .click();
  // Read the DOM's currently active element, never the transient ElementHandle
  // returned by an earlier query. Reject wrong-clip focus or stale data.
  const selected = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLTextAreaElement) || !element.isConnected ||
        !element.closest('[data-flat-group-open="true"]')) {
      throw new Error('Inspector input is not the active connected textarea');
    }
    element.setSelectionRange(0, element.value.length);
    return { value: element.value, start: element.selectionStart, end: element.selectionEnd, length: element.value.length };
  });
  assert.equal(selected.value, before, script + ': inspector targets wrong Unicode text');
  assert.deepEqual([selected.start, selected.end], [0, selected.length], script + ': logical selection did not span original text');
  // Record native browser events without mutating the React field or Studio
  // store. A correct-looking textarea alone did not prove an Arabic WOFF1
  // source write on Windows (RTL run 45082328771).
  await page.evaluate(targetScript => {
    const input = document.activeElement;
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Inspector probe lost textarea focus');
    const receipt = { events: [] };
    window.__rtlInspectorInputReceipts ??= {};
    window.__rtlInspectorInputReceipts[targetScript] = receipt;
    for (const type of ['beforeinput', 'input', 'blur', 'compositionstart', 'compositionend']) {
      input.addEventListener(type, event => {
        receipt.events.push({
          type: event.type,
          value: event.currentTarget.value,
          trusted: event.isTrusted,
          connected: event.currentTarget.isConnected,
        });
      }, { capture: true });
    }
  }, script);
  await page.keyboard.sendCharacter(after);
  // A CDP insertText acknowledgement alone is not proof that React accepted
  // the edit. Wait for the LIVE focused textarea to show the exact logical
  // Unicode string; if the user input was dropped this remains a hard failure.
  try {
    await page.waitForFunction(expected =>
      Array.from(document.querySelectorAll('[data-flat-group-open="true"] textarea'))
        .some(element => element.isConnected && document.activeElement === element && element.value === expected),
    { timeout: 8_000 }, after);
  } catch (error) {
    const state = await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName,
      activeValue: document.activeElement?.value,
      visibleTextareas: Array.from(document.querySelectorAll('[data-flat-group-open="true"] textarea'))
        .map(element => ({ value: element.value, connected: element.isConnected,
          focused: document.activeElement === element })),
    }));
    throw new Error(script + ': Studio rejected or reverted the actual Unicode input: ' + JSON.stringify(state), { cause: error });
  }
  const receipt = await page.evaluate(id => window.__rtlInspectorInputReceipts?.[id], script);
  assert(receipt?.events?.some(event => event.type === 'input' && event.value === after),
    script + ': browser did not dispatch an exact Unicode input event to the connected inspector: '
      + JSON.stringify(receipt));
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
  // A real Semitic WOFF2, converted from the *Git-blob-pinned licensed TTF*
  // through version-pinned fontTools/Brotli in CI, must survive every actual
  // browser, native MP4 and independently reimported project path.
  const convertedScripts = ['hebrew', 'arabic', 'urdu', 'syriac'];
  const webfontFaces = new Map();
  for (const script of convertedScripts) {
    const converted = JSON.parse(await readFile(path.join(fontDir, script + '-' + webfontFormat + '.json'), 'utf8'));
    const pinned = manifest.faces.find(face => face.id === script);
    assert(pinned, 'Pinned script TTF missing for ' + script);
    assert.equal(converted.id, script, 'WOFF2 manifest ID mismatch');
    assert.equal(converted.format, webfontFormat);
    if (woff1) {
      assert.equal(converted.signature, 'wOFF');
      assert.equal(converted.filename, script + '.woff');
      assert.equal(converted.sourceCommit, manifest.sourceCommit);
      assert.equal(converted.sourceFontGitBlob, pinned.fontGitBlob);
      assert.equal(converted.sourceLicenseGitBlob, pinned.licenseGitBlob);
      assert.deepEqual(converted.decodedSfntTables, converted.sourceSfntTables);
      const bytes = await readFile(path.join(fontDir, converted.filename));
      assert.equal(bytes.toString('ascii', 0, 4), 'wOFF', 'Not actual WOFF 1.0 data');
    }
    assert.equal(converted.sourceTtfSha256, pinned.fontSha256, script + ': WOFF2 source is not the pinned TTF');
    assert.equal(converted.sourceLicense, pinned.licenseFilename, script + ': WOFF2 license identity changed');
    assert.equal(converted.sourceLicenseSha256, pinned.licenseSha256, script + ': pinned license SHA changed');
    assert.equal(sha256(await readFile(path.join(fontDir, converted.filename))), converted.sha256,
      script + ': WOFF2 generated bytes differ from converter manifest');
    assert(Array.isArray(converted.layoutTables) && converted.layoutTables.includes('GSUB') &&
      converted.layoutTables.includes('GPOS'), script + ': OpenType joining/positioning tables missing');
    webfontFaces.set(script, converted);
  }
  // Keep the original TTF Ethiopic control and pinned Latin face. Four
  // Semitic families now import their *actual WOFF2 bytes* into the project.
  const hebrewWebfont = webfontFaces.get('hebrew');
  const fontSources = [
    ...manifest.faces.map(face => {
      const derived = webfontFaces.get(face.id);
      return {
        ...face,
        sourcePath: path.join(fontDir, derived?.filename ?? face.filename),
        licensePath: path.join(fontDir, face.licenseFilename),
        fontSha256: derived?.sha256 ?? face.fontSha256,
        format: derived ? webfontFormat : 'ttf',
      };
    }),
    { id: 'latin', sourcePath: latinPath, licensePath: latinLicensePath, format: 'ttf',
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
    assert(item.path.endsWith('.' + face.format), 'Native imported font extension mismatch for ' + face.id);
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
  assertStep('Real Studio player loaded all RTL scripts and Ethiopic/LTR with logical source', { samples: loaded });
  // The player and timeline can exist beneath the project loading overlay.
  // Wait for its actual removal, regardless of the locale or punctuation,
  // before inspecting or clicking the responsive workspace controls.
  await page.waitForFunction(() => {
    const clip = document.querySelector('button[aria-label^="Label,"]');
    return clip && clip.getClientRects().length > 0
      && !document.querySelector('.motion-editor-loading');
  }, { timeout: 30_000 });
  await page.screenshot({ path: path.join(output, 'studio-before-edit.png') });
  // Compact layouts auto-collapse the right inspector into a rail. The test
  // must open the real Design panel through its actual UI, not rely on a
  // selection magically expanding it or mutate dock store state in JS.
  const designRail = await page.$('nav[aria-label="Right panels"] button[aria-label="Design"]');
  if (designRail) await designRail.click();
  await page.waitForFunction(() => {
    const design = document.querySelector('[data-dock-panel="design"]');
    return design && !design.hasAttribute('inert')
      && design.getBoundingClientRect().width > 150;
  }, { timeout: 30_000 });
  assertStep('Actual Studio Design inspector available (expand compact rail via user UI)', {
    expandedCompactRightRail: Boolean(designRail),
  });
  await page.click('button[aria-label^="Label,"]');
  await page.waitForFunction(() => document.querySelector('[data-flat-group-open="true"]')?.textContent?.includes('Font'));
  // Locate the live controlled field by its exact Unicode string. Locator
  // click retries pre-input detachment, never a failed text edit.
  // The full logical selection and caret-affinity remain separately gated.
  await replaceStudioInspectorText(page, originalHebrew, editedHebrew, 'hebrew');
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
  samples[0].copy = editedHebrew;
  // The same *actual Studio Content inspector* must save Arabic, Persian,
  // Urdu and Syriac, not only display font-provenanced static rows.
  // Exercise the public Linked Selection control before multi-script editing.
  // Windows run 45075179101 reached a correct single-clip precheck, then the
  // subsequent inspector click found two linked clips and no textarea.
  // Do not set the selection store directly or retry an inserted character:
  // disable linked selection through the REAL toolbar, still Alt-click the
  // requested clip, and require exactly one selected clip and exact Unicode
  // before any input. Restore the user's prior toolbar preference afterward.
  // The embedded MVP intentionally has no toggle and forces linked
  // selection off. Assert the actual subscribed Studio preference in both
  // shell modes; a missing full-Studio button or an enabled MVP must fail.
  const linkedSelectionToolbar = '.motion-timeline-toolbar[data-linked-selection-mode]';
  const linkedSelectionButton = 'button[aria-label="Linked Selection"]';
  const linkedSelectionMode = await page.$eval(linkedSelectionToolbar,
    element => element.getAttribute('data-linked-selection-mode'));
  assert(['host-locked', 'user-toggle'].includes(linkedSelectionMode),
    'Studio did not expose a recognized linked-selection UI mode');
  const linkedSelectionControlCount = await page.evaluate(
    selector => document.querySelectorAll(selector).length, linkedSelectionButton);
  assert.equal(linkedSelectionControlCount, linkedSelectionMode === 'user-toggle' ? 1 : 0,
    'Actual Studio linked-selection control visibility disagrees with its host mode');
  let linkedSelectionInitiallyOn = false;
  if (linkedSelectionMode === 'user-toggle') {
    linkedSelectionInitiallyOn = await page.$eval(linkedSelectionButton,
      element => element.getAttribute('aria-pressed') === 'true');
    if (linkedSelectionInitiallyOn) {
      await page.locator(linkedSelectionButton).setTimeout(15_000).click();
    }
  }
  await page.waitForFunction(selector => {
    const toolbar = document.querySelector('.motion-timeline-toolbar[data-linked-selection-mode]');
    const button = document.querySelector(selector);
    return toolbar?.getAttribute('data-linked-selection-state') === 'off'
      && (button ? button.getAttribute('aria-pressed') === 'false'
        : toolbar.getAttribute('data-linked-selection-mode') === 'host-locked');
  }, { timeout: 10_000 }, linkedSelectionButton);
  const scriptEdits = [];
  for (const [id, nextCopy] of [
    ['arabic', 'السَّلَامُ OpenMotion 52%'],
    ['persian', 'فارسی پ چ ژ گ ۲۰۶۲'],
    ['urdu', 'اردو ڈ ٹ ڑ ں ے'],
    ['syriac', 'ܒܪܝܟܐ ܫܠܡܐ'],
  ]) {
    const sample = samples.find(row => row.id === id);
    assert(sample, 'Unknown script edit ' + id);
    const oldCopy = sample.copy;
    // Clip and inspector can rerender when selection changes. Use live
    // selectors for both actual UI clicks instead of collecting handles.
    // The real Studio supports Alt-click to select this clip ALONE when
    // linked selection is enabled. A macOS CI screenshot captured a two-clip
    // Persian/Arabic group after a plain click, leaving no text inspector.
    // Use the public UI's single-selection gesture; never set store/DOM state.
    // Escape clears any prior inspector/multi-selection through the real UI
    // before applying Studio's Alt-click single-clip gesture. This prevents a
    // previous composition selection from leaking into the next source edit.
    await page.keyboard.press('Escape');
    await page.keyboard.down('Alt');
    try {
      await page.locator('button[aria-label^="' + id + '," i]')
        .setTimeout(30_000)
        .click();
    } finally {
      await page.keyboard.up('Alt');
    }
    // An inspector with the correct text is insufficient when linked clips
    // remain selected. Require the actual accessible timeline state to be
    // exactly this one clip before sending any Unicode characters.
    const selectedClips = () => Array.from(document.querySelectorAll('button.timeline-clip[aria-pressed="true"]'))
      .map(el => el.getAttribute('aria-label') ?? '');
    try {
      await page.waitForFunction((expected, targetId) => {
        const pressed = Array.from(document.querySelectorAll('button.timeline-clip[aria-pressed="true"]'))
          .map(el => (el.getAttribute('aria-label') ?? '').toLowerCase());
        return pressed.length === 1 && pressed[0].startsWith(targetId.toLowerCase() + ',')
          && Array.from(document.querySelectorAll('[data-flat-group-open="true"] textarea'))
            .some(el => el.isConnected && el.value === expected);
      }, { timeout: 30_000 }, oldCopy, id);
      const selectedLabels = await page.evaluate(selectedClips);
      (evidence.singleClipSelections ??= []).push({ id, selectedLabels });
    } catch (error) {
      const observed = await page.evaluate(() => ({
        selectedGroup: document.body.textContent?.match(/[0-9]+ elements selected/)?.[0] ?? null,
        connectedInspectorValues: Array.from(document.querySelectorAll('[data-flat-group-open="true"] textarea'))
          .filter(el => el.isConnected).map(el => el.value),
        selectedClipLabels: Array.from(document.querySelectorAll('button.timeline-clip[aria-pressed="true"]'))
          .map(el => el.getAttribute('aria-label')),
      }));
      throw new Error(id + ': single-clip Studio inspector did not show exact Unicode after Alt-click: '
        + JSON.stringify(observed), { cause: error });
    }
    await replaceStudioInspectorText(page, oldCopy, nextCopy, id);
    await page.keyboard.press('Tab');
    const inputReceipt = await page.evaluate(script => window.__rtlInspectorInputReceipts?.[script], id);
    let persisted = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { current = await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } }); }
      catch (error) {
        if (error?.code !== 'VERSION_CONFLICT') throw error;
        await sleep(200); continue;
      }
      if (JSON.stringify(current.file).includes(nextCopy)) { persisted = true; break; }
      await sleep(200);
    }
    if (!persisted) {
      // Keep failure evidence on disk for all OS runners. The next diagnosis
      // must distinguish a missed blur, a React/source commit error, a
      // selection change and an actual native persistence fault. Do not
      // synthesize a blur, retry input, or accept a visually edited textarea.
      const browserState = await page.evaluate(() => ({
        activeTag: document.activeElement?.tagName ?? null,
        activeValue: document.activeElement?.value ?? null,
        selectedLabels: Array.from(document.querySelectorAll('button.timeline-clip[aria-pressed="true"]'))
          .map(button => button.getAttribute('aria-label')),
        inspectorValues: Array.from(document.querySelectorAll('[data-flat-group-open="true"] textarea'))
          .map(element => ({ value: element.value, connected: element.isConnected,
            focused: document.activeElement === element })),
        alerts: Array.from(document.querySelectorAll('[role="alert"]'))
          .map(element => element.textContent?.trim()).filter(Boolean).slice(-10),
        linkedSelection: document.querySelector('.motion-timeline-toolbar')
          ?.getAttribute('data-linked-selection-state') ?? null,
      }));
      const diagnostic = {
        script: id, expected: nextCopy, original: oldCopy,
        projectRevision: current?.revision ?? null,
        sourceStillContainsOriginal: JSON.stringify(current?.file).includes(oldCopy),
        sourceContainsExpected: JSON.stringify(current?.file).includes(nextCopy),
        inspectorInputEvents: inputReceipt?.events ?? [],
        browserState,
      };
      await writeFile(path.join(output, 'studio-edit-failure-' + id + '.json'),
        JSON.stringify(diagnostic, null, 2));
      console.error('Studio source persistence mismatch: ' + JSON.stringify(diagnostic));
    }
    assert(persisted, id + ' edit did not persist native project Unicode');
    assert(!JSON.stringify(current.file).includes(oldCopy), id + ' old text persisted');
    frame = await findStudioFrame(page, editedHebrew);
    assert.equal(await frame.$eval('#' + id, element => element.textContent), nextCopy,
      id + ' Studio preview has stale text');
    sample.copy = nextCopy;
    scriptEdits.push({ id, text: nextCopy, revision: current.revision,
      inputEvents: inputReceipt?.events?.filter(event => event.type === 'input').length ?? 0,
      blurEvents: inputReceipt?.events?.filter(event => event.type === 'blur').length ?? 0 });
  }
  const ltrControls = await frame.evaluate(() => [
    document.getElementById('ethiopic')?.textContent,
    document.getElementById('latin')?.textContent,
  ]);
  assert.deepEqual(ltrControls, samples.filter(row => row.dir === 'ltr').map(row => row.copy),
    'Editing RTL scripts modified Ethiopic/LTR control text');
  await page.screenshot({ path: path.join(output, 'studio-all-scripts-edited.png') });
  assertStep('Actual Studio edited all five Semitic scripts without changing Ethiopic/LTR controls',
    { scriptEdits, ltrControls });
  // Exercise the real Studio project-history keyboard path, not the
  // browser's native textarea history. Focus a timeline clip after the
  // inspector's blur/save and require BOTH durable native source and preview
  // to reverse and reapply the latest Syriac edit. Other scripts must survive.
  const historyClip = await page.$('button[aria-label^="Syriac," i]');
  assert(historyClip, 'Cannot focus real Syriac timeline clip for project undo/redo');
  await historyClip.click();
  const historyFocus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    label: document.activeElement?.getAttribute('aria-label'),
  }));
  assert.equal(historyFocus.tag, 'BUTTON', 'History shortcut would target an editable field instead of Studio');
  assert(historyFocus.label?.toLowerCase().startsWith('syriac,'),
    'History shortcut focus missed the selected timeline clip');
  const historyModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const historySteps = [];
  for (const [direction, wanted, rejected] of [
    ['undo', 'ܫܠܡܐ ܒܪܝܟܐ', 'ܒܪܝܟܐ ܫܠܡܐ'],
    ['redo', 'ܒܪܝܟܐ ܫܠܡܐ', 'ܫܠܡܐ ܒܪܝܟܐ'],
  ]) {
    // Puppeteer's Keyboard.press() accepts one key, not a compound
    // "Control+z"/"Meta+z" name. Dispatch the real modifier keydown,
    // physical Z press/release, then modifier keyup as browser input.
    // Keep focus on the timeline button; do not call history APIs.
    const heldKeys = [historyModifier, ...(direction === 'redo' ? ['Shift'] : [])];
    const pressedKeys = [];
    try {
      for (const key of heldKeys) {
        await page.keyboard.down(key);
        pressedKeys.push(key);
      }
      await page.keyboard.press('z');
    } finally {
      for (const key of pressedKeys.reverse()) await page.keyboard.up(key);
    }
    let persisted = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { current = await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } }); }
      catch (error) {
        if (error?.code !== 'VERSION_CONFLICT') throw error;
        await sleep(200);
        continue;
      }
      const text = JSON.stringify(current.file);
      if (text.includes(wanted) && !text.includes(rejected)) { persisted = true; break; }
      await sleep(200);
    }
    assert(persisted, 'Studio keyboard ' + direction + ' did not persist exact Syriac Unicode in native project source');
    for (const row of samples.filter(sample => sample.id !== 'syriac')) {
      assert(JSON.stringify(current.file).includes(row.copy),
        'Studio keyboard ' + direction + ' altered unrelated ' + row.lang + ' source');
    }
    let previewText = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const liveFrame of page.frames()) {
        const found = await readLiveFrameText(liveFrame, '#syriac');
        if (found === wanted) { previewText = found; break; }
      }
      if (previewText !== null) break;
      await sleep(200);
    }
    assert.equal(previewText, wanted, 'Studio keyboard ' + direction + ' did not update actual preview');
    await page.waitForFunction(expected => Array.from(document.querySelectorAll('[data-flat-group-open="true"] textarea'))
      .some(element => element.value === expected), { timeout: 20_000 }, wanted);
    await page.screenshot({ path: path.join(output, 'studio-after-' + direction + '.png') });
    historySteps.push({ direction, text: wanted, revision: current.revision });
  }
  assertStep('Real Studio keyboard undo/redo reverses and reapplies Syriac Unicode in native source and preview', {
    modifier: historyModifier, steps: historySteps,
  });
  if (linkedSelectionInitiallyOn) {
    await page.locator(linkedSelectionButton).setTimeout(15_000).click();
    await page.waitForFunction(selector =>
      document.querySelector(selector)?.getAttribute('aria-pressed') === 'true'
        && document.querySelector('.motion-timeline-toolbar')?.getAttribute('data-linked-selection-state') === 'on',
    { timeout: 10_000 }, linkedSelectionButton);
  } else {
    assert.equal(await page.$eval(linkedSelectionToolbar,
      element => element.getAttribute('data-linked-selection-state')), 'off',
      'Studio linked selection drifted on during multi-script edits');
  }
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
  for (const [seekIndex, expectedTime] of [0.25, 0.45, 0.75, 0.45, 0.25, 0.75].entries()) {
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
        const parent = document.getElementById('timed-caption');
        if (!he || !ar || !parent) return null;
        window.__rtlStudioCaptionNodes ??= [he.firstChild, ar.firstChild];
        return {
          unchangedNodes: he.firstChild === window.__rtlStudioCaptionNodes[0]
            && ar.firstChild === window.__rtlStudioCaptionNodes[1],
          text: parent.textContent,
          parentOpacity: getComputedStyle(parent).opacity,
          heColor: getComputedStyle(he).backgroundColor,
          arColor: getComputedStyle(ar).backgroundColor,
        };
      });
      const yellow = color => /250,\s*204,\s*21/.test(color || '');
      if (state && yellow(state.heColor) === (expectedTime < 0.5)
        && yellow(state.arColor) === (expectedTime > 0.5)
        && (Number(state.parentOpacity) < 0.02) === (expectedTime === 0.45)) break;
      await sleep(100);
    }
    assert(state, 'Studio player iframe lost authored timed caption on seek');
    assert.equal(state.text, 'שָׁלוֹם السَّلَامُ', 'Studio preview seek altered RTL Unicode text');
    assert(state.unchangedNodes, 'Studio preview seek replaced an authored caption text node');
    assert.equal(Number(state.parentOpacity) < 0.02, expectedTime === 0.45,
      'Studio player did not hide/restore the actual caption parent at ' + expectedTime);
    const yellow = color => /250,\s*204,\s*21/.test(color || '');
    assert.equal(yellow(state.heColor), expectedTime < 0.5, 'Studio Hebrew highlight wrong at ' + expectedTime);
    assert.equal(yellow(state.arColor), expectedTime > 0.5, 'Studio Arabic highlight wrong at ' + expectedTime);
    const previous = repeatedStudioStates.get(expectedTime);
    if (previous) assert.deepEqual(state, previous, 'Repeated real Studio scrub changed the caption state');
    else repeatedStudioStates.set(expectedTime, state);
    studioSeeks.push({ seekIndex, expectedTime, actualTime, ...state });
    if (expectedTime === 0.45 && seekIndex === 1) {
      await page.screenshot({ path: path.join(output, 'studio-caption-parent-hidden.png') });
    }
  }
  await page.screenshot({ path: path.join(output, 'studio-after-reverse-seek.png') });
  assertStep('Actual Studio seek hides and restores authored RTL caption parent without mutation', { studioSeeks });

  // Real transport acceptance is distinct from the direct GSAP seek and
  // pixel-parity checks below. Slow the REAL Studio transport with its public
  // speed menu, so a three-OS runner can observe both timed boundaries without
  // injecting time into React, a player store, or the authored timeline.
  // The Base UI speed popup can render an unselected 1x option while
  // Puppeteer's filtered Locator.click waits indefinitely for it to become
  // actionable. In the original three-OS failure a real Studio screenshot
  // showed the 1x row plainly visible beneath the selected 0.25x row.
  // Resolve exactly one visible, enabled, unobstructed radio from the LIVE DOM,
  // then use a real Chromium mouse click (never dispatch synthetic events).
  async function chooseActualStudioSpeed(rate) {
    const label = `${rate}x`;
    await page.locator('button[aria-label="Playback speed"]').click();
    await page.waitForFunction(wanted =>
      [...document.querySelectorAll('[role="menuitemradio"]')]
        .some(row => row.textContent?.trim() === wanted),
    { timeout: 10_000 }, label);
    const target = await page.evaluate(wanted => {
      const rows = [...document.querySelectorAll('[role="menuitemradio"]')]
        .filter(row => row.textContent?.trim() === wanted);
      if (rows.length !== 1) return { matches: rows.length };
      const row = rows[0];
      const bounds = row.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        matches: rows.length, x, y,
        rendered: bounds.width > 0 && bounds.height > 0,
        enabled: row.getAttribute('aria-disabled') !== 'true',
        unobstructed: Boolean(hit && row.contains(hit)),
      };
    }, label);
    assert.equal(target.matches, 1, 'Ambiguous real Studio speed-menu radio: ' + label);
    assert(target.rendered && target.enabled && target.unobstructed,
      'Real Studio speed option is hidden, disabled or obstructed: ' + JSON.stringify({ label, target }));
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction(wanted =>
      document.querySelector('button[aria-label="Playback speed"]')?.textContent?.trim() === wanted,
    { timeout: 10_000 }, label);
  }
  await chooseActualStudioSpeed(0.25);
  const playbackSelector = 'button[data-studio-control="playback"]:not(:disabled)';
  const sliderBounds = await seekInput.boundingBox();
  assert(sliderBounds && sliderBounds.width > 150 && sliderBounds.height > 0,
    'Real Studio transport slider has no pointer geometry');
  const sliderInset = Math.min(14, sliderBounds.height / 2);
  await seekInput.click({ offset: {
    x: sliderInset + (sliderBounds.width - 2 * sliderInset) * 0.18 / sliderDuration,
    y: sliderBounds.height / 2,
  } });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[data-studio-control="seek-preview"]');
    return input && Math.abs(input.valueAsNumber - 0.18) < 0.06;
  }, { timeout: 10_000 });
  const livePlaybackPhases = [];
  async function observeRealPlayback(phase, expectedPlaying) {
    const actualTime = await seekInput.evaluate(input => input.valueAsNumber);
    const controlLabel = await page.$eval(playbackSelector, control => control.getAttribute('aria-label'));
    assert.equal(controlLabel, expectedPlaying ? 'Pause' : 'Play',
      'Actual Studio transport button did not reflect ' + phase);
    frame = await findStudioFrame(page, editedHebrew);
    const state = await frame.evaluate(() => {
      const parent = document.getElementById('timed-caption');
      const he = document.getElementById('caption-he');
      const ar = document.getElementById('caption-ar');
      if (!parent || !he || !ar) return null;
      window.__rtlStudioCaptionNodes ??= [he.firstChild, ar.firstChild];
      return {
        unchangedNodes: he.firstChild === window.__rtlStudioCaptionNodes[0]
          && ar.firstChild === window.__rtlStudioCaptionNodes[1],
        text: parent.textContent,
        parentOpacity: Number(getComputedStyle(parent).opacity),
        heColor: getComputedStyle(he).backgroundColor,
        arColor: getComputedStyle(ar).backgroundColor,
        timelineTime: Number(window.__timelines?.main?.time?.()),
      };
    });
    assert(state, 'Real Studio playback lost authored Hebrew/Arabic caption elements');
    assert(state.unchangedNodes, 'Real Studio transport replaced authored caption text nodes');
    assert.equal(state.text, 'שָׁלוֹם السَّلَامُ',
      'Real Studio playback altered logical Unicode or caption word identity');
    assert(Number.isFinite(state.timelineTime) && Math.abs(state.timelineTime - actualTime) <= 0.12,
      'Studio transport slider and actual composition clock diverged: ' + phase);
    const yellow = color => /250,\s*204,\s*21/.test(color || '');
    const visible = phase !== 'hidden-paused';
    assert.equal(state.parentOpacity < 0.02, !visible,
      'Actual Studio playback caption parent visibility wrong during ' + phase);
    // The hidden interval spans the 0.5s word-swap boundary. A real
    // pause may land on either side while the parent is invisible; assert the
    // authored highlight against the ACTUAL playback clock, not a phase name.
    const hebrewActive = state.timelineTime < 0.5;
    assert.equal(yellow(state.heColor), hebrewActive,
      'Hebrew authored word highlight wrong at real playback time during ' + phase);
    assert.equal(yellow(state.arColor), !hebrewActive,
      'Arabic authored word highlight wrong at real playback time during ' + phase);
    livePlaybackPhases.push({
      phase, actualTime, playing: expectedPlaying, visible,
      parentOpacity: state.parentOpacity, timelineTime: state.timelineTime,
      unchangedNodes: state.unchangedNodes, text: state.text,
    });
  }
  await page.locator(playbackSelector).click();
  await page.waitForFunction(() =>
    document.querySelector('button[data-studio-control="playback"]')?.getAttribute('aria-label') === 'Pause',
  { timeout: 10_000 });
  await page.waitForFunction(() => {
    const t = document.querySelector('input[data-studio-control="seek-preview"]')?.valueAsNumber;
    return t >= 0.24 && t < 0.35;
  }, { polling: 20, timeout: 12_000 });
  await observeRealPlayback('hebrew-playing', true);
  // A running Studio clock must actually cross the hidden parent boundary.
  await page.waitForFunction(() => {
    const t = document.querySelector('input[data-studio-control="seek-preview"]')?.valueAsNumber;
    return t >= 0.43 && t < 0.60;
  }, { polling: 20, timeout: 12_000 });
  await page.locator(playbackSelector).click();
  await page.waitForFunction(() =>
    document.querySelector('button[data-studio-control="playback"]')?.getAttribute('aria-label') === 'Play',
  { timeout: 10_000 });
  await observeRealPlayback('hidden-paused', false);
  const frozenAt = await seekInput.evaluate(input => input.valueAsNumber);
  await sleep(350);
  const frozenAfter = await seekInput.evaluate(input => input.valueAsNumber);
  assert(Math.abs(frozenAfter - frozenAt) < 0.025,
    'Pause did not freeze real Studio playback clock inside hidden caption interval');
  await page.screenshot({ path: path.join(output, 'studio-caption-playback-paused-hidden.png') });
  await page.locator(playbackSelector).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[data-studio-control="seek-preview"]');
    return input?.valueAsNumber >= 0.73
      && document.querySelector('button[data-studio-control="playback"]')?.getAttribute('aria-label') === 'Pause';
  }, { polling: 20, timeout: 12_000 });
  await page.locator(playbackSelector).click();
  await observeRealPlayback('arabic-paused', false);
  await page.screenshot({ path: path.join(output, 'studio-caption-playback-paused-restored.png') });
  assert(livePlaybackPhases[0].actualTime < livePlaybackPhases[1].actualTime
    && livePlaybackPhases[1].actualTime < livePlaybackPhases[2].actualTime,
  'Real Studio Play/Pause/Resume did not advance the authored composition clock');
  assert(livePlaybackPhases[0].actualTime < 0.35
    && livePlaybackPhases[1].actualTime > 0.35 && livePlaybackPhases[1].actualTime < 0.65
    && livePlaybackPhases[2].actualTime >= 0.65,
  'Real Studio transport did not observe both caption visibility boundaries');
  // The user-facing speed preference must not leak from a test into subsequent
  // checks or mask a transport-duration discrepancy.
  await chooseActualStudioSpeed(1);
  evidence.livePlayback = { phases: livePlaybackPhases, pauseClockDrift: Math.abs(frozenAfter - frozenAt) };
  assertStep('Real Studio Play Pause Resume crosses RTL caption hide and restore with intact authored nodes',
    evidence.livePlayback);

  const direct = await browser.newPage();
  await direct.setViewport({ width, height, deviceScaleFactor: 1 });
  const route = new URL('/api/projects/' + encodeURIComponent(projectId) + '/preview/index.html', new URL(preview.previewUrl).origin);
  const woffResponses = new Map();
  if (woff1) {
    // Assert the actual Chromium preview fetches the exact imported WOFF1
    // bytes. A custom font marker alone does not identify a file format.
    await direct.setCacheEnabled(false);
    direct.on('response', response => {
      const resource = new URL(response.url());
      if (resource.origin === route.origin && resource.pathname.endsWith('.woff')) {
        woffResponses.set(resource.href, response);
      }
    });
  }
  await direct.goto(route.href, { waitUntil: 'load' });
  await direct.waitForSelector('#main');
  const raw = await direct.evaluate(async () => { await document.fonts.ready; return document.getElementById('label').textContent; });
  assert.equal(raw, editedHebrew, 'Direct preview route does not match Studio player edit');
  const servedWoffSha256 = {};
  if (woff1) {
    const baseURI = await direct.evaluate(() => document.baseURI);
    for (const [id, manifest] of webfontFaces) {
      const expected = new URL(fonts[id], baseURI);
      assert.equal(expected.origin, route.origin, 'WOFF must resolve to project-local preview');
      const response = woffResponses.get(expected.href);
      assert(response?.ok(), 'Missing real Chromium project-local WOFF response: ' + id);
      const bytes = await response.buffer();
      assert.equal(bytes.toString('ascii', 0, 4), 'wOFF');
      assert.equal(sha256(bytes), manifest.sha256, 'Chromium WOFF response bytes changed: ' + id);
      servedWoffSha256[id] = sha256(bytes);
    }
  }
  const liveTexts = await direct.evaluate(() => ['arabic','persian','urdu','syriac','ethiopic','latin'].map(id =>
    ({ id, text: document.getElementById(id)?.textContent })));
  for (const row of liveTexts) assert.equal(row.text, samples.find(s => s.id === row.id)?.copy,
    row.id + ' direct preview does not match real Studio editor');
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
  for (const [seekIndex, time] of paintedCaptionSeekTimes.entries()) {
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
        wordMotion: { he: new DOMMatrixReadOnly(getComputedStyle(he).transform).m41,
          ar: new DOMMatrixReadOnly(getComputedStyle(ar).transform).m41 },
        parentOpacity: getComputedStyle(caption).opacity,
        heColor: getComputedStyle(he).backgroundColor, arColor: getComputedStyle(ar).backgroundColor };
    }, time);
    assert(layout.unchanged, 'Playback replaced an authored caption text node');
    assert.equal(layout.text, 'שָׁלוֹם السَّلَامُ', 'Playback mutated Unicode caption content');
    for (const id of ['he', 'ar']) {
      assert(Number.isFinite(layout.wordMotion[id]) &&
        Math.abs(layout.wordMotion[id] + 32 * time) <= 2.1,
        id + ': authored per-word GSAP translation missing at ' + time);
    }
    assert.equal(Number(layout.parentOpacity) < 0.02, time === 0.45,
      'Authored caption parent opacity did not reverse correctly on seek at ' + time);
    const yellow = color => /250,\s*204,\s*21/.test(color);
    assert.equal(yellow(layout.heColor), time < 0.5, 'Hebrew timed highlight state differs from authored timeline');
    assert.equal(yellow(layout.arColor), time > 0.5, 'Arabic timed highlight state differs from authored timeline');
    const screenshot = path.join(output, 'preview-caption-seek-' + seekIndex + '-' + time + '.png');
    await direct.screenshot({ path: screenshot, clip: { x: 0, y: 0, width, height } });
    const pixels = decodeToRgb(screenshot, false);
    const heYellow = yellowPixels(pixels, layout.he);
    const arYellow = yellowPixels(pixels, layout.ar);
    const totalInk = captionInkPixels(pixels);
    const browserCentroid = yellowCentroid(pixels);
    if (time !== 0.45) {
      const activeRect = time < 0.5 ? layout.he : layout.ar;
      assert(browserCentroid && browserCentroid.pixels > 90,
        'Animated Chromium caption has no painted yellow region');
      assert(browserCentroid.x >= activeRect.left - 2 && browserCentroid.x <= activeRect.right + 2 &&
        browserCentroid.y >= activeRect.top - 2 && browserCentroid.y <= activeRect.bottom + 2,
        'Chromium yellow pixels do not occupy the transformed authored word');
    } else {
      assert(!browserCentroid || browserCentroid.pixels < 25,
        'Hidden animated caption leaked Chromium yellow pixels');
    }
    if (time === 0.45) {
      assert(totalInk < 25, 'Hidden caption leaked visible glyph or highlight ink in Chromium');
      assert(heYellow < 25 && arYellow < 25,
        'Hidden caption parent leaked visible Hebrew/Arabic pixels in Chromium');
    } else {
      assert(totalInk > 90, 'Restored browser caption has no visible glyph ink');
      assert((time < 0.5 ? heYellow : arYellow) > 70, 'Expected real browser caption highlight absent');
      assert((time < 0.5 ? arYellow : heYellow) < 25, 'Untimed caption word unexpectedly highlighted');
    }
    const seekState = {
      he: layout.he, ar: layout.ar,
      heColor: layout.heColor, arColor: layout.arColor, parentOpacity: layout.parentOpacity,
      wordMotion: layout.wordMotion, browserCentroid,
      browserYellow: { he: heYellow, ar: arYellow }, browserInk: totalInk,
    };
    const previous = priorSeekStates.get(time);
    if (previous) {
      assert.deepEqual(seekState, previous,
        'Reverse/forward seeking changed the repeated caption geometry or highlight state at ' + time);
    } else {
      priorSeekStates.set(time, seekState);
    }
    timedPreviews.push({ seekIndex, time, screenshot, layout,
      browserYellow: seekState.browserYellow, browserInk: seekState.browserInk, browserCentroid });
  }
  await direct.close();
  if (woff1) {
    assertStep('Project-local licensed fonts actually used by Chromium, including four Semitic WOFF1 faces', {
      fontUsage, scriptWoff: [...webfontFaces.values()], servedWoffSha256,
    });
  } else {
    assertStep('Project-local licensed fonts actually used by Chromium, including four Semitic WOFF2 faces', {
      fontUsage, hebrewWoff2: hebrewWebfont, scriptWoff2: [...webfontFaces.values()],
    });
  }
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
    const videoInk = captionInkPixels(rgb);
    const videoCentroid = yellowCentroid(rgb);
    let centroidDriftPx = null;
    let drift = null;
    if (capture.time === 0.45) {
      assert(videoInk < 25, 'Decoded MP4 leaked visible caption glyph ink while its parent was hidden');
      assert(videoYellow.he < 25 && videoYellow.ar < 25,
        'Decoded MP4 leaks visible caption pixels while the authored parent is hidden');
    } else {
      assert(videoInk > 90, 'Restored MP4 caption has no visible glyph ink');
      assert(videoYellow[active] > 70, 'MP4 timed caption highlight missing at ' + capture.time);
      assert(videoYellow[inactive] < 25, 'MP4 contains a stale timed caption highlight at ' + capture.time);
      drift = Math.abs(videoYellow[active] - capture.browserYellow[active])
        / Math.max(videoYellow[active], capture.browserYellow[active]);
      assert(drift <= 0.3, 'Browser/MP4 timed highlight geometry mismatch: ' + JSON.stringify({ time: capture.time, drift, videoYellow, browserYellow: capture.browserYellow }));
      assert(videoCentroid && videoCentroid.pixels > 90,
        'Decoded MP4 lacks a painted animated caption centroid');
      centroidDriftPx = Math.hypot(
        videoCentroid.x - capture.browserCentroid.x, videoCentroid.y - capture.browserCentroid.y);
      assert(centroidDriftPx <= 9,
        'MP4 animated word displaced from real Chromium pixels: ' +
        JSON.stringify({ time: capture.time, centroidDriftPx, browser: capture.browserCentroid, video: videoCentroid }));
    }
    temporal.push({ seekIndex: capture.seekIndex, time: capture.time, visible: capture.time !== 0.45,
      parentOpacity: capture.layout.parentOpacity, active, browserYellow: capture.browserYellow,
      browserInk: capture.browserInk, videoInk,
      wordMotion: capture.layout.wordMotion,
      browserCentroid: capture.browserCentroid, videoCentroid, centroidDriftPx,
      videoYellow, areaDrift: drift });
  }
  verifyPaintedCaptionMovement(temporal, 'Studio/MP4');
  assertStep('Timed RTL caption parent hide/restore and per-word highlights match decoded MP4 on repeated seeks', { temporal });
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
  const archiveBytes = await readFile(archive.archivePath);
  // Reimport the exact persisted evidence file, not a second unretained ZIP.
  const retainedArchive = path.join(output, 'offline-project.zip');
  await copyFile(archive.archivePath, retainedArchive);
  assert.equal(sha256(await readFile(retainedArchive)), sha256(archiveBytes),
    'Retained offline ZIP differs from native project export');
  const entries = readProjectZip(archiveBytes);
  const manifestEntry = entries.get('openmotion-projects.json');
  assert(manifestEntry, 'Offline export missing project manifest');
  const archiveManifest = JSON.parse(manifestEntry.toString('utf8'));
  assert.equal(archiveManifest.projects.length, 1, 'RTL archive must contain exactly one project');
  const archiveRoot = archiveManifest.projects[0].root;
  assert.equal(typeof archiveRoot, 'string', 'Missing versioned archive root');
  const exportedHtml = entries.get(archiveRoot + '/index.html');
  assert(exportedHtml, 'Offline export missing edited composition');
  const authoredMotion = '.to("#caption-he",{x:-32,duration:1,ease:"none"},0).to("#caption-ar",{x:-32,duration:1,ease:"none"},0)';
  assert(exportedHtml.toString('utf8').includes(authoredMotion) &&
    exportedHtml.toString('utf8').includes('id="caption-he"') &&
    exportedHtml.toString('utf8').includes('id="caption-ar"'),
    'Offline project lost distinct authored word IDs or animated GSAP transforms');
  assert(exportedHtml.toString('utf8').includes(editedHebrew), 'Archive lost edited Hebrew niqqud/Latin copy');
  assert(!exportedHtml.toString('utf8').includes(originalHebrew), 'Archive restored stale pre-edit text');
  for (const sample of samples) assert(exportedHtml.toString('utf8').includes(sample.copy),
    'Offline ZIP lost author-edited ' + sample.lang + ' Unicode');
  const assetFiles = [];
  if (woff1) await mkdir(path.join(output, 'woff1-fonts'), { recursive: true });
  for (const face of fontSources) {
    const asset = imported.items.find(item => item.itemId === face.id);
    assert(asset?.path && asset?.license?.path, 'Missing imported font/license paths: ' + face.id);
    for (const [relative, originalPath] of [[asset.path, face.sourcePath], [asset.license.path, face.licensePath]]) {
      const archived = entries.get(archiveRoot + '/' + relative);
      assert(archived, 'Offline archive missing asset: ' + relative);
      const original = await readFile(originalPath);
      assert.deepEqual(archived, original, 'Offline archive changed bytes: ' + relative);
      assetFiles.push({ path: relative, sha256: sha256(archived) });
      if (woff1 && webfontFaces.has(face.id)) {
        const retained = face.id + (relative === asset.path ? '.woff' : '.OFL.txt');
        await writeFile(path.join(output, 'woff1-fonts', retained), archived);
      }
    }
  }
  const restored = await client.call('openmotion_project_archive', {
    action: 'import', requestId: 'rtl-offline-archive-import', sourcePath: retainedArchive,
  });
  assert.equal(restored.projects.length, 1, 'Offline reimport did not restore exactly one project');
  const restoredId = restored.projects[0].projectId;
  assert(restoredId && restoredId !== projectId, 'Offline import must create an independent project');
  const restoredSource = await client.call('openmotion_get_project', {
    projectId: restoredId, file: { path: 'index.html' },
  });
  assert(JSON.stringify(restoredSource.file).includes(editedHebrew), 'Reimport lost edited logical Unicode text');
  assert(JSON.stringify(restoredSource.file).includes('x:-32') &&
    JSON.stringify(restoredSource.file).includes('caption-he') &&
    JSON.stringify(restoredSource.file).includes('caption-ar'),
    'Offline ZIP reimport lost independently authored word animation');
  assert(!JSON.stringify(restoredSource.file).includes(originalHebrew), 'Reimport restored stale pre-edit text');
  for (const sample of samples) assert(JSON.stringify(restoredSource.file).includes(sample.copy),
    'Offline reimport lost ' + sample.lang + ' Unicode');
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
  // Preserve the actual generated offline project archive for independent
  // review. Previous runner artifacts retained receipts, but not ZIP bytes.
  assert.equal(sha256(await readFile(retainedArchive)), sha256(archiveBytes),
    'Offline ZIP bytes changed during native project reimport');
  evidence.offlineArchive = {
    filename: 'offline-project.zip', sha256: sha256(archiveBytes), bytes: archiveBytes.length,
  };
  assertStep('Offline ZIP reimport retained exact edited Unicode and six licensed font assets', {
    restoredProjectId: restoredId, assets: assetFiles, offlineArchive: evidence.offlineArchive,
  });
  assert.deepEqual(consoleErrors, [], 'Studio page errors');
  evidence.passed = true;
  evidence.browser = await browser.version();
  evidence.fonts = fontSources.map(({ id, fontSha256, licenseSha256 }) => ({ id, fontSha256, licenseSha256 }));
  if (woff1) evidence.scriptWoff = [...webfontFaces.values()];
  else evidence.scriptWoff2 = [...webfontFaces.values()];
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
  const cleanupErrors = [], cleanupRecoveries = [], ownedStdioCleanup = [];
  // 'exit' can precede stdio 'close'. The macOS WOFF1 evidence succeeded all
  // eleven checks but left PipeWrap resources after teardown; only release
  // streams of children owned by this integration and confirmed exited.
  function releaseOwnedStdioIfExited(child, label) {
    if (!child || (child.exitCode === null && child.signalCode === null)) return;
    const receipt = releaseExitedOwnedChildStdio(child, label);
    ownedStdioCleanup.push(receipt);
    if (receipt.released.length) {
      cleanupRecoveries.push(label + ': released exited-child stdio: ' + receipt.released.join(', '));
    }
  }
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
    // Capture the process before Puppeteer discards its browser connection.
    const owned = browser.process();
    if (await cleanupWithin('Chromium graceful close', () => browser.close(), 15_000)) {
      releaseOwnedStdioIfExited(owned, 'Chromium');
      return;
    }
    // Only this integration's Puppeteer-launched process may be terminated.
    assert(owned, 'Chromium timed out, and no owned browser process is available');
    if (owned.exitCode === null && owned.signalCode === null) {
      assert(owned.kill('SIGTERM'), 'Could not terminate test-owned Chromium');
    }
    assert(await cleanupWithin('Chromium exit', () => processExited(owned), 10_000),
      'Test-owned Chromium did not exit after termination');
    cleanupRecoveries.push('Terminated test-owned Chromium after graceful-close timeout');
    releaseOwnedStdioIfExited(owned, 'Chromium');
  });
  await cleanup('MCP child', async () => {
    if (await cleanupWithin('MCP graceful EOF', () => client.close(), 15_000)) {
      releaseOwnedStdioIfExited(client.child, 'MCP');
      return;
    }
    // This child was created solely for this temporary project. Do not
    // terminate or restart an external/shared OpenMotion instance.
    const owned = client.child;
    if (owned.exitCode === null && owned.signalCode === null) {
      assert(owned.kill('SIGTERM'), 'Could not terminate test-owned MCP child');
    }
    assert(await cleanupWithin('MCP exit', () => client.closed, 10_000),
      'Test-owned MCP child did not exit after termination');
    cleanupRecoveries.push('Terminated test-owned MCP child after graceful EOF timeout');
    releaseOwnedStdioIfExited(owned, 'MCP');
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
  evidence.cleanup = { recoveries: cleanupRecoveries, errors: cleanupErrors, ownedStdioCleanup };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  if (evidence.passed && cleanupErrors.length) throw new Error('RTL integration teardown failed: ' + cleanupErrors.join('; '));
  // A passing result.json is not qualification if a test-owned event-loop
  // resource keeps Node alive after all teardown steps have returned.
  if (evidence.passed) armRtlPostCleanupWatchdog({ output, evidence });
}
