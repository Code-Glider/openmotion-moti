// Real Studio caption gesture -> versioned native HTML -> keyboard history
// -> offline ZIP reimport -> decoded H.264 parity. No DOM/store mutation stands
// in for the author's pointer/keyboard edit or the persisted project source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { Client } from './shared-editor-client.mjs';
import { closeFixtureEditor } from './fixtures.ts';
import { removeTemporaryRtlProject, stopOwnedWindowsPreviewTree } from './rtl-temp-project-cleanup.mjs';
import { configureNativeEnvironment } from '../scripts/npm-runtime.mjs';
import { pluginRoot } from '../hyperframes.ts';
import { browserExecutable } from '../browser.ts';
import { readProjectZip } from '../shared/project-zip.ts';

const [output, fontDir] = process.argv.slice(2);
assert(output && path.isAbsolute(output) && fontDir && path.isAbsolute(fontDir),
  'Real managed-caption acceptance needs absolute evidence/font directories');
await mkdir(output, { recursive: true });
await configureNativeEnvironment(pluginRoot);
process.env.OPENMOTION_TELEMETRY = '0';
const data = await mkdtemp(path.join(tmpdir(), 'openmotion-rtl-studio-export-managed-caption-'));
const client = new Client(data);
const width = 640, height = 360, duration = 2, at = 0.8;
const bg = [24, 56, 47];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { passed: false, scope: 'Real Studio trusted caption drag, native source undo/redo, independent ZIP reimport and decoded MP4 word-position parity', checks: [] };
const check = (name, evidence = {}) => { result.checks.push({ name, ...evidence }); console.log('PASS ' + name); };
let browser, page, previewUrl, projectId, retainedPath, finalSrc;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, cmd + ' failed: ' + r.stderr?.toString().slice(-1500));
  return r.stdout;
};
function decode(file, seconds = null) {
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (seconds !== null) args.push('-ss', String(seconds));
  args.push('-i', file, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1');
  const pixels = run(ffmpeg, args);
  assert.equal(pixels.length, width * height * 3, 'Decoded screenshot/native MP4 dimensions incorrect');
  return pixels;
}
const regions = {
  hebrew: { left: 30, right: 300, top: 55, bottom: 195 },
  latin: { left: 30, right: 390, top: 200, bottom: 340 },
};
function centroid(pixels, region) {
  const background = [...pixels.subarray(0, 3)];
  assert(background.every((c, index) => Math.abs(c - bg[index]) < 18),
    'Rendered composition background is not the authored one: ' + background);
  let count = 0, sumX = 0, sumY = 0;
  for (let y = region.top; y < region.bottom; y++) {
    for (let x = region.left; x < region.right; x++) {
      const i = (y * width + x) * 3;
      // White glyph ink is visibly distinct from the pinned dark background.
      const diff = Math.max(...bg.map((value, channel) => Math.abs(pixels[i + channel] - value)));
      if (diff < 65) continue;
      count++; sumX += x; sumY += y;
    }
  }
  assert(count > 80 && count < 9000, 'No bounded authored glyph ink: ' + JSON.stringify({ region, count }));
  return { x: sumX / count, y: sumY / count, pixels: count };
}
function geometry(pixels) {
  return Object.fromEntries(Object.entries(regions).map(([name, region]) => [name, centroid(pixels, region)]));
}
async function nodeSourceGenerator() {
  // A complete Node bundle avoids importing TypeScript interfaces or TSX
  // through the experimental strip-types resolver. It still executes the
  // exact production parser and native source serializer.
  const bundle = await build({
    stdin: {
      contents: [
        "export { buildCaptionModel } from './studio/src/captions/parser.ts';",
        "export { generateCaptionHtml } from './studio/src/captions/generator.ts';",
        "export { managedCaptionScriptTag } from './studio/src/captions/nativeSource.ts';",
      ].join('\n'),
      resolveDir: pluginRoot, sourcefile: 'rtl-managed-caption-fixture.ts', loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  });
  assert.equal(bundle.outputFiles.length, 1, 'Production caption source bundle missing');
  const compiled = path.join(data, 'rtl-managed-caption-fixture.cjs');
  await writeFile(compiled, bundle.outputFiles[0].text);
  return createRequire(import.meta.url)(compiled);
}
async function waitSource(predicate, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    let current;
    try {
      current = await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } });
    } catch (error) {
      if (error?.code !== 'VERSION_CONFLICT') throw error;
      await sleep(200); continue;
    }
    const content = current.file?.content;
    if (typeof content === 'string' && predicate(content)) return current;
    await sleep(200);
  }
  throw Error('Real Studio native source did not reach ' + label);
}
function movedOffset(source) {
  const expression = /[.]style[.]transform = "translate\((-?(?:\d+(?:[.]\d+)?))px, (-?(?:\d+(?:[.]\d+)?))px\) rotate\(/.exec(source);
  return expression ? { x: Number(expression[1]), y: Number(expression[2]) } : null;
}
async function sendHistory(direction) {
  const held = direction === 'redo' ? ['Control', 'Shift'] : ['Control'];
  try {
    for (const key of held) await page.keyboard.down(key);
    await page.keyboard.press('z');
  } finally {
    for (const key of held.reverse()) await page.keyboard.up(key);
  }
}
async function directCapture(origin, id, label) {
  const p = await browser.newPage();
  try {
    // The raw project-preview route retains an 8px browser body margin.
    // Screenshot the *composition* itself, not the surrounding white page.
    await p.setViewport({ width: width + 40, height: height + 40, deviceScaleFactor: 1 });
    const url = new URL('/api/projects/' + encodeURIComponent(id) + '/preview/index.html', origin);
    await p.goto(url.href, { waitUntil: 'load' });
    await p.waitForSelector('#w-he');
    const dom = await p.evaluate(async time => {
      await document.fonts.ready;
      const tl = window.__timelines?.captions;
      if (!tl || typeof tl.pause !== 'function') throw Error('Native managed caption GSAP timeline not running');
      tl.pause(time);
      const measure = id => {
        const el = document.getElementById(id);
        if (!el) throw Error('Missing exact authored word ' + id);
        const r = el.getBoundingClientRect();
        return { text: el.textContent, id: el.id, x: r.x, y: r.y, width: r.width, height: r.height,
          wrapper: el.parentElement?.dataset.captionWrapper === 'true' };
      };
      return { he: measure('w-he'), en: measure('w-en'), timeline: tl.time() };
    }, at);
    assert.equal(dom.he.text, 'שָׁלוֹם');
    assert.equal(dom.en.text, 'ABC-123');
    const filename = path.join(output, label + '.png');
    const frame = await p.$eval('[data-composition-id="captions"]', el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    assert(Math.abs(frame.width - width) < 1 && Math.abs(frame.height - height) < 1,
      'Raw native composition has unexpected pixel dimensions: ' + JSON.stringify(frame));
    await p.screenshot({ path: filename, clip: { x: frame.x, y: frame.y, width, height } });
    const c = geometry(decode(filename));
    return { file: filename, dom, ink: c, sha256: sha(await readFile(filename)) };
  } finally { await p.close(); }
}
let error;
try {
  const { buildCaptionModel, generateCaptionHtml, managedCaptionScriptTag } = await nodeSourceGenerator();
  const manifest = JSON.parse(await readFile(path.join(fontDir, 'manifest.json'), 'utf8'));
  const hebrew = manifest.faces.find(face => face.id === 'hebrew');
  assert(hebrew, 'Missing pinned licensed Hebrew font');
  const latinPath = path.join(pluginRoot, 'tests/fixtures/fonts/orbitron.ttf');
  const latinLicense = path.join(pluginRoot, 'tests/fixtures/fonts/OFL.txt');
  await client.initialize();
  const created = await client.call('openmotion_create_project', {
    projectType: 'natural_language', title: 'Native RTL caption authored gesture acceptance',
    requirements: 'Deterministic licensed Hebrew and Latin font native project',
    requestId: 'rtl-caption-gesture-create',
  });
  projectId = created.projectId;
  const imported = await client.call('openmotion_import_assets', {
    projectId, requestId: 'rtl-caption-licensed-fonts',
    items: [
      { itemId: 'hebrew', sourcePath: path.join(fontDir, hebrew.filename),
        licensePath: path.join(fontDir, hebrew.licenseFilename) },
      { itemId: 'latin', sourcePath: latinPath, licensePath: latinLicense },
    ],
  });
  assert.equal(imported.status, 'completed', 'Native import failed');
  const fontPath = id => {
    const item = imported.items.find(item => item.itemId === id);
    assert.equal(item?.status, 'completed', 'Missing imported font ' + id);
    return item.path;
  };
  const model = buildCaptionModel([
    { id: 'w-he', text: 'שָׁלוֹם', start: 0, end: 1.8 },
    { id: 'w-en', text: 'ABC-123', start: 0, end: 1.8 },
  ], { width, height, duration, wordsPerGroup: 1 });
  const groups = model.groupOrder.map(id => model.groups.get(id));
  for (const [i, group] of groups.entries()) {
    assert(group);
    group.style = { ...group.style, x: 80, y: i === 0 ? 105 : 235,
      fontFamily: i === 0 ? '"RTL Managed Hebrew"' : '"RTL Managed Latin"',
      fontSize: 48, color: '#ffffff' };
  }
  const generated = generateCaptionHtml(model);
  const css = generated.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert(css, 'Production generated caption CSS missing');
  const nativeTag = await managedCaptionScriptTag(model);
  const source = '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">' +
    '<script src="assets/gsap.min.js"></script><style>' +
    '@font-face{font-family:"RTL Managed Hebrew";src:url("' + fontPath('hebrew') + '") format("truetype")}' +
    '@font-face{font-family:"RTL Managed Latin";src:url("' + fontPath('latin') + '") format("truetype")}' +
    css + '[data-composition-id="captions"]{background:#18382f}</style></head><body>' +
    '<div id="caption-composition" data-composition-id="captions" data-width="640" data-height="360" ' +
    'data-start="0" data-duration="2" data-fps="10"><div id="captions-container"></div></div>' +
    nativeTag + '</body></html>';
  const current = await client.call('openmotion_get_project', { projectId });
  await client.call('openmotion_edit_project', {
    projectId, expectedRevision: current.revision, expectedVersionId: current.currentVersionId,
    requestId: 'rtl-caption-initial-author',
    files: [{ path: 'index.html', content: source },
      { path: 'assets/gsap.min.js',
        content: await readFile(path.join(pluginRoot, 'node_modules/gsap/dist/gsap.min.js'), 'utf8') }],
  });
  const savedBaseline = await waitSource(content => content === source, 'initial managed authored HTML');
  check('Versioned native project contains exact SHA-managed authored Unicode source', {
    revision: savedBaseline.revision, sourceSha256: sha(source),
  });
  const preview = await client.call('openmotion_open_preview', { projectId });
  previewUrl = preview.serverUrl || new URL(preview.previewUrl).origin;
  browser = await puppeteer.launch({
    executablePath: process.env.HYPERFRAMES_BROWSER_PATH || await browserExecutable(), headless: true,
  });
  const baseline = await directCapture(previewUrl, projectId, 'rtl-native-caption-before-drag');
  check('Real Chromium baseline contains isolated Hebrew and Latin font glyph rows', baseline);
  page = await browser.newPage();
  result.nativeFileRequests = [];
  page.on('response', response => {
    if (response.url().includes('/files/')) {
      result.nativeFileRequests.push({ status: response.status(), url: response.url() });
    }
  });
  page.on('pageerror', issue => { result.pageErrors ??= []; result.pageErrors.push(issue.message); });
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
  await page.goto(preview.previewUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
  const slider = await page.waitForSelector('input[data-studio-control="seek-preview"]:not(:disabled)',
    { timeout: 30_000 });
  const max = await slider.evaluate(input => Number(input.max));
  assert(Math.abs(max - duration) < 0.15, 'Actual Studio did not load the managed two-second composition');
  await slider.evaluate(input => input.scrollIntoView({ block: 'center' }));
  const box = await slider.boundingBox();
  assert(box && box.width > 120, 'Studio seek slider has no physical geometry');
  const inset = Math.min(14, box.height / 2);
  await slider.click({ offset: { x: inset + (box.width - 2 * inset) * at / max, y: box.height / 2 } });
  try {
    await page.waitForFunction(() =>
      document.querySelector('[data-caption-segment-id="segment-0"]')?.getBoundingClientRect().width > 24,
      { timeout: 18_000 });
  } catch (cause) {
    const studio = await page.evaluate(() => ({
      editModeIndicatorVisible: document.body.textContent?.includes('Editing captions') ?? false,
      savedSourceErrorVisible: document.body.textContent?.includes('Caption source could not be verified') ?? false,
      selectedCaptionHits: [...document.querySelectorAll('[data-caption-segment-id]')].map(el => ({
        id: el.getAttribute('data-caption-segment-id'), width: el.getBoundingClientRect().width,
      })),
      captionVisibility: document.querySelector('button[aria-label="Caption visibility"]')?.textContent,
      seek: document.querySelector('input[data-studio-control="seek-preview"]')?.value,
      timelineCount: document.querySelector('[data-timeline-element-count]')?.getAttribute('data-timeline-element-count'),
      selection: document.querySelector('[data-caption-edit-mode]')?.getAttribute('data-caption-edit-mode'),
    }));
    const iframeState = await Promise.all(page.frames().map(async frame => {
      try {
        return await frame.evaluate(() => ({
          url: location.href,
          captionGroups: [...document.querySelectorAll('.caption-group')].map(el => ({
            id: el.dataset.captionGroupId, opacity: getComputedStyle(el).opacity,
            width: el.getBoundingClientRect().width, text: el.textContent,
          })),
          exactHebrewWords: document.querySelectorAll('#w-he').length,
          captionRoot: document.querySelector('[data-composition-id="captions"]')?.outerHTML.slice(0, 180),
        }));
      } catch (error) { return { error: String(error) }; }
    }));
    result.activationFailure = { studio, iframeState, nativeFileRequests: result.nativeFileRequests, pageErrors: result.pageErrors };
    throw new Error('Native managed captions did not activate in real Studio: ' +
      JSON.stringify(result.activationFailure), { cause });
  }
  const hit = '[data-caption-segment-id="segment-0"]';
  await page.click(hit);
  await page.waitForFunction(sel => document.querySelector(sel)?.style.cursor === 'move',
    { timeout: 10_000 }, hit);
  const rect = await page.$eval(hit, el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  assert(rect.width > 28 && rect.height > 20, 'Caption word hit target has no real pointer area');
  const center = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 24, center.y - 12, { steps: 5 });
  await page.mouse.up();
  const authored = await waitSource(content => {
    const movement = movedOffset(content);
    return movement && movement.x > 8 && movement.y < -4;
  }, 'actual Studio-authored Hebrew word movement');
  const moved = movedOffset(authored.file.content);
  assert(moved && moved.x < 100 && moved.y > -100, 'Unbounded native word transform');
  assert(authored.file.content.includes('"w-he"') && authored.file.content.includes('"w-en"'),
    'Saved native source lost authored word identities');
  assert(authored.file.content.includes('שָׁלוֹם') && authored.file.content.includes('ABC-123'),
    'Saved native source lost logical Unicode');
  check('Trusted Studio pointer gesture persists a native versioned transform (not sidecar-only)', {
    moved, revision: authored.revision, sourceSha256: sha(authored.file.content),
  });
  // A *second real pointer gesture* must be another reversible transaction
  // even inside the 800ms nudge history-coalescing window. Reacquire the
  // live hit after Studio's preview remeasurement, never mutate store/DOM.
  await page.click(hit);
  await page.waitForFunction(sel => document.querySelector(sel)?.style.cursor === 'move',
    { timeout: 10_000 }, hit);
  const secondRect = await page.$eval(hit, el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  assert(secondRect.width > 28 && secondRect.height > 20,
    'Second caption pointer gesture has no real hit area');
  const secondCenter = {
    x: Math.round(secondRect.x + secondRect.width / 2),
    y: Math.round(secondRect.y + secondRect.height / 2),
  };
  await page.mouse.move(secondCenter.x, secondCenter.y);
  await page.mouse.down();
  await page.mouse.move(secondCenter.x + 16, secondCenter.y, { steps: 5 });
  await page.mouse.up();
  const secondAuthored = await waitSource(content => {
    const xy = movedOffset(content);
    return xy && xy.x > moved.x + 7 && Math.abs(xy.y - moved.y) < 5;
  }, 'second separately authored Studio pointer transform');
  const secondMoved = movedOffset(secondAuthored.file.content);
  assert(secondMoved, 'Second pointer transform was not persisted');
  check('Second trusted drag persists a separate native source revision', {
    first: moved, second: secondMoved,
    firstRevision: authored.revision, secondRevision: secondAuthored.revision,
    firstSourceSha256: sha(authored.file.content),
    secondSourceSha256: sha(secondAuthored.file.content),
  });

  // These are actual keyboard shortcuts registered in Studio, not direct
  // Zustand history calls. Two undos must restore first move then original;
  // two redos must restore each drag, with matching versioned native HTML.
  await sendHistory('undo');
  const firstUndone = await waitSource(content => {
    const xy = movedOffset(content);
    return xy && xy.x === moved.x && xy.y === moved.y;
  }, 'first keyboard Undo restores first independently authored drag');
  check('Real Studio first Undo reverses only the second pointer gesture', {
    revision: firstUndone.revision, sourceSha256: sha(firstUndone.file.content),
  });
  await sendHistory('undo');
  const undone = await waitSource(content => !movedOffset(content),
    'second keyboard Undo restores original native word geometry');
  check('Real Studio second Undo reverses first pointer gesture', {
    revision: undone.revision, sourceSha256: sha(undone.file.content),
  });
  await sendHistory('redo');
  const firstRedone = await waitSource(content => {
    const xy = movedOffset(content);
    return xy && xy.x === moved.x && xy.y === moved.y;
  }, 'first keyboard Redo reapplies first native drag');
  check('Real Studio first Redo reapplies first pointer gesture', {
    revision: firstRedone.revision, sourceSha256: sha(firstRedone.file.content),
  });
  await sendHistory('redo');
  const redone = await waitSource(content => {
    const xy = movedOffset(content);
    return xy && xy.x === secondMoved.x && xy.y === secondMoved.y;
  }, 'second keyboard Redo reapplies independently saved native drag');
  finalSrc = redone.file.content;
  check('Real Studio second Redo reapplies exact final saved native word transform', {
    revision: redone.revision, first: moved, final: secondMoved,
  });
  const finalPreview = await directCapture(previewUrl, projectId, 'rtl-native-caption-after-redo');
  const delta = { x: finalPreview.ink.hebrew.x - baseline.ink.hebrew.x,
    y: finalPreview.ink.hebrew.y - baseline.ink.hebrew.y };
  assert(delta.x > 7 && delta.y < -4,
    'Real saved native authored word did not move matching glyph pixels: ' + JSON.stringify(delta));
  assert(Math.hypot(finalPreview.ink.latin.x - baseline.ink.latin.x,
    finalPreview.ink.latin.y - baseline.ink.latin.y) < 2.5,
  'Latin LTR control glyphs drifted after Hebrew edit');
  check('Native source reload moves only selected Hebrew glyphs', { delta, finalPreview });
  const archive = await client.call('openmotion_project_archive', {
    action: 'export', projectIds: [projectId], requestId: 'rtl-caption-native-zip-export',
  });
  assert(archive.archivePath, 'Native offline ZIP export missing');
  retainedPath = path.join(output, 'rtl-native-caption-offline-project.zip');
  await copyFile(archive.archivePath, retainedPath);
  const bytes = await readFile(retainedPath);
  const entries = readProjectZip(bytes);
  const manifestFile = entries.get('openmotion-projects.json');
  assert(manifestFile, 'Offline ZIP missing project manifest');
  const packageManifest = JSON.parse(manifestFile.toString('utf8'));
  assert.equal(packageManifest.projects.length, 1);
  const root = packageManifest.projects[0].root;
  const packaged = entries.get(root + '/index.html')?.toString('utf8');
  assert.equal(packaged, finalSrc, 'Native offline ZIP changed authored Unicode or transform bytes');
  for (const item of imported.items) {
    assert(item.path && item.license?.path, 'Missing imported font/license item');
    for (const relative of [item.path, item.license.path]) {
      const saved = entries.get(root + '/' + relative);
      assert(saved, 'Native offline ZIP missing original licensed asset ' + relative);
      const original = await readFile(path.join(data, 'projects', projectId, relative))
        .catch(() => readFile(path.join(data, 'project', relative)));
      assert.equal(sha(saved), sha(original), 'Native offline ZIP changed a licensed asset');
    }
  }
  const importedArchive = await client.call('openmotion_project_archive', {
    action: 'import', requestId: 'rtl-caption-native-zip-import', sourcePath: retainedPath,
  });
  assert.equal(importedArchive.projects.length, 1);
  const restoredId = importedArchive.projects[0].projectId;
  assert(restoredId && restoredId !== projectId);
  const restored = await client.call('openmotion_get_project', {
    projectId: restoredId, file: { path: 'index.html' },
  });
  assert.equal(restored.file.content, finalSrc, 'Independent imported project lost native caption source');
  check('Offline ZIP reimport preserves authored transform, Unicode, stable IDs and font/license bytes', {
    archiveSha256: sha(bytes), importedProjectId: restoredId, sourceSha256: sha(restored.file.content),
  });
  const exportState = await client.call('openmotion_get_project', { projectId: restoredId });
  const queued = await client.call('openmotion_export_request', {
    projectId: restoredId, versionId: exportState.currentVersionId,
    expectedRevision: exportState.revision,
    requestId: 'rtl-caption-native-mp4-export', compositionPath: 'index.html', audio: 'silent',
  });
  let completed;
  for (let attempt = 0; attempt < 360; attempt++) {
    const { exportJob } = await client.call('openmotion_get_project', {
      projectId: restoredId, exportJobId: queued.job.id,
    });
    assert.notEqual(exportJob.state, 'failed', 'Native MP4 render failed: ' + JSON.stringify(exportJob));
    if (exportJob.state === 'completed') { completed = exportJob; break; }
    await sleep(500);
  }
  assert(completed?.verification?.status === 'passed', 'Native MP4 export was not verified');
  const mp4 = path.join(output, 'rtl-native-caption-authored.mp4');
  await copyFile(completed.path, mp4);
  const ffprobe = process.env.HYPERFRAMES_FFPROBE_PATH || 'ffprobe';
  const info = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height', '-of', 'json', mp4]).toString('utf8'));
  assert.equal(info.streams?.[0]?.codec_name, 'h264');
  assert.equal(info.streams?.[0]?.width, width); assert.equal(info.streams?.[0]?.height, height);
  const decoded = decode(mp4, at);
  const videoInk = geometry(decoded);
  const parity = Object.fromEntries(['hebrew', 'latin'].map(id => {
    const actual = videoInk[id], expected = finalPreview.ink[id];
    const drift = Math.hypot(actual.x - expected.x, actual.y - expected.y);
    assert(drift <= 8, id + ' native MP4 glyph centroid does not match saved Chrome preview: ' +
      JSON.stringify({ actual, expected, drift }));
    const ratio = Math.abs(actual.pixels - expected.pixels) / Math.max(actual.pixels, expected.pixels);
    assert(ratio <= 0.4, id + ' native MP4 glyph ink differs beyond the authored preview');
    return [id, { drift, inkAreaDrift: ratio, actual, expected }];
  }));
  check('Independently decoded native MP4 preserves dragged Hebrew word and unaffected Latin control', {
    parity, nativeExportVerification: completed.verification,
  });
  result.passed = true;
  result.browser = await browser.version();
  result.preview = { baseline, finalPreview, delta };
  result.gesture = { moved, sourceSha256: sha(finalSrc) };
  result.native = { parity, mp4Sha256: sha(await readFile(mp4)), projectZipSha256: sha(bytes) };
} catch (e) {
  error = e;
  result.error = String(e?.stack || e);
  await page?.screenshot({ path: path.join(output, 'rtl-native-caption-failure.png') }).catch(() => {});
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  const failures = [];
  try { await browser?.close(); } catch (e) { failures.push('browser: ' + String(e)); }
  try { await client.close(); } catch (e) { failures.push('MCP: ' + String(e)); }
  if (process.platform === 'win32' && previewUrl) {
    try { await stopOwnedWindowsPreviewTree(data, previewUrl); }
    catch (e) { failures.push('Windows owned preview: ' + String(e)); }
  }
  try { await closeFixtureEditor(data); }
  catch (e) { failures.push('fixture editor: ' + String(e)); }
  try { await removeTemporaryRtlProject(data); }
  catch (e) { failures.push('temporary project: ' + String(e)); }
  result.cleanup = { errors: failures };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (!error && failures.length) error = Error('Managed RTL acceptance teardown failed: ' + failures.join('; '));
}
if (error) throw error;
