// Real OpenMotion Studio -> source-backed text edit -> native MP4 qualification.
// Uses the existing Puppeteer/native-render integration harness, not a mock DOM.
// Fails closed if the licensed fonts, Studio edit, actual export, or glyph pixels are absent.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { configureNativeEnvironment } from '../scripts/npm-runtime.mjs';
import { pluginRoot } from '../hyperframes.ts';
import { Client } from './shared-editor-client.mjs';
import { closeFixtureEditor } from './fixtures.ts';

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
let browser, page;
function decodeToRgb(input, isVideo) {
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (isVideo) args.push('-ss', '0.5');
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
function compositionHtml(fontPaths) {
  const css = Object.entries(fontPaths).map(([face, url]) => '@font-face{font-family:"OM RTL ' + face + '";src:url("' + url + '") format("truetype");font-weight:100 900;font-style:normal;font-display:block}').join('\n');
  const rows = samples.map((sample, index) => '<div class="sample" id="' + sample.id + '" dir="' + sample.dir + '" lang="' + sample.lang + '" data-start="0" data-duration="1" data-track-index="' + index + '" style="top:' + (16 + index * 62) + 'px;font-family:' + (sample.face ? "'OM RTL " + sample.face + "'" : 'Arial,sans-serif') + ';">' + sample.copy + '</div>').join('\n');
  return '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>body{margin:0}' + css + '#main{width:640px;height:480px;position:relative;overflow:hidden;background:#18382f;color:#fff}.sample{position:absolute;left:24px;width:592px;height:57px;line-height:1.45;font-size:30px;font-weight:400;white-space:nowrap;overflow:hidden;text-align:start}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="1" data-width="640" data-height="480" data-fps="10">' + rows + '</div><script>window.__timelines={main:gsap.timeline({paused:true}).to("#label",{opacity:1,duration:1,ease:"none"})};</script></body></html>';
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
  let edited = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    current = await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } });
    if (JSON.stringify(current.file).includes(editedHebrew)) { edited = true; break; }
    await sleep(200);
  }
  assert(edited, 'Real Studio text edit did not persist the exact logical Unicode string');
  assert(!JSON.stringify(current.file).includes(originalHebrew), 'Old Hebrew source text still present after Studio edit');
  frame = await findStudioFrame(page, editedHebrew);
  await page.screenshot({ path: path.join(output, 'studio-after-edit.png') });
  assertStep('UI Content editor persisted Hebrew niqqud and mixed English/numerals', { newText: editedHebrew, revision: current.revision });
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
  assert.deepEqual(consoleErrors, [], 'Studio page errors');
  evidence.passed = true;
  evidence.browser = await browser.version();
  evidence.fonts = fontSources.map(({ id, fontSha256, licenseSha256 }) => ({ id, fontSha256, licenseSha256 }));
  evidence.comparison = rows;
} catch (error) {
  evidence.error = String(error?.stack || error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  evidence.mcpStderr = client.stderr?.slice(-2500);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await client.close();
  await closeFixtureEditor(data).catch(() => {});
  // Windows can retain native-editor handles briefly. Do not let cleanup
  // overwrite the primary test failure already recorded in result.json.
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
    .catch(error => {
      if (evidence.passed) throw error;
      console.error('Cleanup after test failure:', error);
    });
}
