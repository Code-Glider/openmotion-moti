/** Fail-closed cross-runner attestation for actual Studio/MP4/ZIP font evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const runners = Object.freeze({
  'ubuntu-24.04': 'linux',
  'macos-15': 'darwin',
  'windows-2025': 'win32',
});
const requiredFaces = ['hebrew', 'arabic', 'urdu', 'syriac', 'ethiopic', 'latin'];
const semiticWoff2Faces = ['hebrew', 'arabic', 'urdu', 'syriac'];
const requiredScripts = ['he', 'ar', 'fa', 'ur', 'syr', 'am', 'en'];
const hexSha = /^[a-f0-9]{64}$/;
const hexBlob = /^[a-f0-9]{40}$/;
const sourceCommit = '06bfe0d62a98375cb09c942fa18e68bd32cff057';
const requiredSfnt = ['cmap', 'GSUB', 'GPOS', 'GDEF', 'fvar', 'gvar', 'maxp', 'name', 'glyf', 'loca'];
// This verifier only consumes the four pinned sub-megabyte fixture faces.
// These are evidence caps, not production import limits.
const maxWoff1Bytes = 4 * 1024 * 1024;
const maxWoff1SfntBytes = 16 * 1024 * 1024;
const maxOflBytes = 128 * 1024;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const gitBlob = data => createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex');
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10]);
const studioSeekTimes = [0.25, 0.45, 0.75, 0.45, 0.25, 0.75];
export const paintedCaptionSeekTimes = Object.freeze([...studioSeekTimes, 0.1, 0.3, 0.7, 0.9]);

// Each word must move on its own: comparing just one visible frame per script
// (even if repeated) cannot distinguish a frozen raster from moving paint.
export function verifyPaintedCaptionMovement(rows, label) {
  for (const [word, earlyTime, lateTime] of [['he', 0.1, 0.3], ['ar', 0.7, 0.9]]) {
    const early = rows.find(row => row.time === earlyTime && row.visible && row.active === word);
    const late = rows.find(row => row.time === lateTime && row.visible && row.active === word);
    assert(early && late, label + ': missing two visible paint times for ' + word);
    const dom = late.wordMotion?.[word] - early.wordMotion?.[word];
    const browser = late.browserCentroid?.x - early.browserCentroid?.x;
    const video = late.videoCentroid?.x - early.videoCentroid?.x;
    const expected = -32 * (lateTime - earlyTime);
    assert(Number.isFinite(dom) && dom < -3 && Math.abs(dom - expected) <= 1,
      label + ': DOM caption moved incorrectly for ' + word);
    assert(Number.isFinite(browser) && browser < -3 && Math.abs(browser - dom) <= 2,
      label + ': browser caption paint did not move with DOM for ' + word);
    // Both endpoints are exact 10fps frame times. Allow residual subpixel
    // raster/codec differences, but never allow zero or rightward motion.
    assert(Number.isFinite(video) && video < -3 && Math.abs(video - browser) <= 2,
      label + ': decoded MP4 caption paint did not move with browser for ' + word);
  }
}

const mediaNames = [
  'exported-rtl.mp4', 'exported-mp4-frame.png', 'preview-frame.png',
  'studio-before-edit.png', 'studio-after-edit.png',
  'studio-all-scripts-edited.png', 'studio-caption-parent-hidden.png',
  'studio-after-reverse-seek.png',
  'studio-caption-playback-paused-hidden.png',
  'studio-caption-playback-paused-restored.png',
  ...paintedCaptionSeekTimes.map((time, i) => 'preview-caption-seek-' + i + '-' + time + '.png'),
];

// Read actual downloaded current-run media, not just self-reported JSON.
// Preserve immutable byte hashes for independent inspection.
export async function verifyArtifactFiles(root, os) {
  assert(Object.hasOwn(runners, os), 'Unknown media evidence runner');
  const hashes = {};
  for (const filename of mediaNames) {
    const bytes = await readFile(path.join(root, os, filename));
    assert(bytes.length > 1024, os + ': empty/truncated media evidence ' + filename);
    if (filename.endsWith('.png')) {
      assert(bytes.subarray(0, 8).equals(pngHeader), os + ': invalid PNG signature ' + filename);
      assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', os + ': missing PNG IHDR ' + filename);
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (filename.startsWith('studio-')) {
        assert(width >= 640 && height >= 480, os + ': invalid Studio screenshot dimensions ' + filename);
      } else {
        assert.equal(width, 640, os + ': preview/MP4 PNG width mismatch ' + filename);
        assert.equal(height, 480, os + ': preview/MP4 PNG height mismatch ' + filename);
      }
    } else {
      assert.equal(bytes.toString('ascii', 4, 8), 'ftyp', os + ': exported MP4 has no ftyp box');
    }
    hashes[filename] = createHash('sha256').update(bytes).digest('hex');
  }
  return hashes;
}


export function verifyCrossOsFontEvidence(reports, webfontFormat = 'woff2') {
  assert(['woff2', 'woff'].includes(webfontFormat), 'Unknown webfont evidence format');
  const woff1 = webfontFormat === 'woff';
  const webfontLabel = woff1 ? 'WOFF1' : 'WOFF2';
  assert.deepEqual(Object.keys(reports).sort(), Object.keys(runners).sort(), 'Three exact OS reports required');
  const hashes = new Map();
  let expectedFaces = null;
  let expectedScriptWoff2 = null;
  let expectedWoff1Source = null;
  const woff1ByOs = {};
  for (const [os, platform] of Object.entries(runners)) {
    const report = reports[os];
    assert(report && typeof report === 'object', os + ': missing actual result.json');
    assert.equal(report.passed, true, os + ': Studio-to-MP4 gate did not pass');
    assert(report.scope?.startsWith(platform + ' Studio browser'), os + ': artifact platform mismatch');
    assert(Array.isArray(report.fonts), os + ': font provenance missing');
    const faces = new Map();
    for (const face of report.fonts) {
      assert(requiredFaces.includes(face.id), os + ': unexpected font id ' + face.id);
      assert(!faces.has(face.id), os + ': duplicate font id ' + face.id);
      assert(hexSha.test(face.fontSha256), os + ': invalid font SHA for ' + face.id);
      assert(hexSha.test(face.licenseSha256), os + ': invalid license SHA for ' + face.id);
      faces.set(face.id, { fontSha256: face.fontSha256, licenseSha256: face.licenseSha256 });
    }
    assert.deepEqual([...faces.keys()].sort(), [...requiredFaces].sort(), os + ': missing pinned face/license');
    // The original WOFF2 gate still requires exact byte identity. For WOFF1,
    // compressed container hashes are per runner; compare source/SFNT/license
    // identity below instead. TTF control faces still require identical bytes.
    const sortedFaces = Object.fromEntries([...faces].sort(([a], [b]) => a.localeCompare(b))
      .map(([id, face]) => [id, woff1 && semiticWoff2Faces.includes(id)
        ? { licenseSha256: face.licenseSha256 } : face]));
    if (!expectedFaces) expectedFaces = sortedFaces;
    else assert.deepEqual(sortedFaces, expectedFaces, os + ': font or license bytes differ from other runner');

    const fontCheck = report.checks?.find(item => item.name ===
      'Project-local licensed fonts actually used by Chromium, including four Semitic ' + webfontLabel + ' faces');
    const conversion = fontCheck?.hebrewWoff2;
    for (const lang of requiredScripts) {
      assert(fontCheck?.fontUsage?.[lang]?.some(face =>
        face.isCustomFont === true && Number.isInteger(face.glyphCount) && face.glyphCount > 0),
        os + ': actual Chromium custom-font use missing for ' + lang);
    }
    const converted = woff1 ? fontCheck?.scriptWoff : fontCheck?.scriptWoff2;
    assert(Array.isArray(converted) && converted.length === 4,
      os + ': four actual Semitic ' + webfontLabel + ' converter results required');
    assert.deepEqual(woff1 ? report.scriptWoff : report.scriptWoff2, converted, os + ': reported font conversions contradict browser evidence');
    assert.deepEqual(converted.map(f => f.id), semiticWoff2Faces,
      os + ': conversion missing an ordered Semitic script');
    const hashesByScript = {};
    const woff1SourceByScript = {};
    for (const encoded of converted) {
      assert.equal(encoded.format, webfontFormat, os + ': converted ' + encoded.id + ' is not ' + webfontLabel);
      assert.equal(encoded.filename, encoded.id + '.' + webfontFormat, os + ': unexpected ' + webfontLabel + ' filename');
      assert.equal(encoded.converter, woff1 ? 'fonttools 4.59.0 + zlib' : 'fonttools 4.59.0 + Brotli 1.1.0',
        os + ': unpinned converter');
      if (woff1) {
        assert.equal(encoded.signature, 'wOFF', os + ': WOFF1 signature missing');
        assert(Number.isSafeInteger(encoded.encodedBytes) && encoded.encodedBytes >= 44 &&
          encoded.encodedBytes <= maxWoff1Bytes && Number.isSafeInteger(encoded.numGlyphs) &&
          Number.isSafeInteger(encoded.codepointCount), os + ': invalid WOFF1 receipt sizes');
        assert.equal(encoded.sourceCommit, sourceCommit, os + ': wrong pinned face source commit');
        assert(hexBlob.test(encoded.sourceFontGitBlob) && hexBlob.test(encoded.sourceLicenseGitBlob),
          os + ': missing pinned WOFF1 source/license blob');
        assert.equal(encoded.sourceLicense, encoded.id + '.OFL.txt', os + ': unexpected adjacent OFL name');
        assert.equal(encoded.deterministicOnRunner, true, os + ': WOFF1 local reproducibility not verified');
        assert(typeof encoded.zlibRuntimeVersion === 'string' && /^\d+\.\d+[0-9A-Za-z.+_-]*$/.test(encoded.zlibRuntimeVersion),
          os + ': missing exact zlib runtime version');
        assert.deepEqual(encoded.decodedSfntTables, encoded.sourceSfntTables, os + ': decoded WOFF1 SFNT differs from source');
        assert(requiredSfnt.every(tag => hexSha.test(encoded.sourceSfntTables?.[tag])),
          os + ': missing pinned WOFF1 shaping and glyph table hashes');
        assert.equal(fontCheck?.servedWoffSha256?.[encoded.id], encoded.sha256,
          os + ': actual Chromium WOFF bytes differ from import');
        woff1SourceByScript[encoded.id] = {
          sourceTtfSha256: encoded.sourceTtfSha256, sourceFontGitBlob: encoded.sourceFontGitBlob,
          sourceLicenseSha256: encoded.sourceLicenseSha256, sourceLicenseGitBlob: encoded.sourceLicenseGitBlob,
          sourceSfntTables: encoded.sourceSfntTables,
        };
      }
      assert(hexSha.test(encoded.sha256) && hexSha.test(encoded.sourceTtfSha256),
        os + ': missing converted source/hash');
      assert.equal(encoded.sha256, faces.get(encoded.id).fontSha256,
        os + ': converted ' + webfontLabel + ' differs from actual imported font: ' + encoded.id);
      assert.equal(encoded.sourceLicenseSha256, faces.get(encoded.id).licenseSha256,
        os + ': converted ' + webfontLabel + ' lost source OFL license: ' + encoded.id);
      assert(encoded.encodedBytes > 0 && encoded.numGlyphs > 0 && encoded.codepointCount > 0 &&
        ['GSUB', 'GPOS'].every(tag => encoded.layoutTables?.includes(tag)),
        os + ': missing glyph or shaping table after ' + webfontLabel + ' conversion for ' + encoded.id);
      hashesByScript[encoded.id] = encoded.sha256;
    }
    if (woff1) {
      const zlib = new Set(converted.map(face => face.zlibRuntimeVersion));
      assert.equal(zlib.size, 1, os + ': inconsistent WOFF1 zlib runtime');
      if (!expectedWoff1Source) expectedWoff1Source = woff1SourceByScript;
      else assert.deepEqual(woff1SourceByScript, expectedWoff1Source,
        os + ': pinned source, OFL or decoded WOFF1 SFNT differs across runners');
      woff1ByOs[os] = { zlibRuntimeVersion: converted[0].zlibRuntimeVersion, scriptWoffSha256: hashesByScript };
    } else {
      assert.equal(conversion?.sha256, hashesByScript.hebrew, os + ': Hebrew legacy conversion disagrees');
      assert.equal(conversion?.sourceTtfSha256,
        '7ef36a2c3593758cdb622e1bdef4f84523e92fbc3ccc667438dd80ff54c2de88',
        os + ': changed original pinned Hebrew font');
      assert(['GSUB', 'GPOS', 'GDEF'].every(tag => conversion.layoutTables?.includes(tag)),
        os + ': missing shaping table after Hebrew WOFF2 conversion');
      if (!expectedScriptWoff2) expectedScriptWoff2 = hashesByScript;
      else assert.deepEqual(hashesByScript, expectedScriptWoff2,
        os + ': Semitic WOFF2 byte hashes differ between runners');
      hashes.set(os, conversion.sha256);
    }

    // A changed inspector value alone did not guarantee native text persistence
    // on Windows WOFF1 (45082328771). Require proof that real browser input
    // events reached each authored script editor before source/MP4 qualification.
    const uiEdits = report.checks.find(item =>
      item.name === 'Actual Studio edited all five Semitic scripts without changing Ethiopic/LTR controls')?.scriptEdits;
    assert.deepEqual(uiEdits?.map(edit => edit.id), ['arabic', 'persian', 'urdu', 'syriac'],
      os + ': real Studio authored input receipts missing or reordered');
    for (const edit of uiEdits) {
      assert(Number.isInteger(edit.inputEvents) && edit.inputEvents >= 1,
        os + ': missing actual browser Unicode input event for ' + edit.id);
      assert(Number.isInteger(edit.blurEvents) && edit.blurEvents >= 0,
        os + ': invalid inspector blur receipt for ' + edit.id);
    }
    const zip = report.checks.find(item =>
      item.name === 'Offline ZIP reimport retained exact edited Unicode and six licensed font assets');
    assert.equal(zip?.assets?.length, 12, os + ': reimport must retain six fonts and six licenses');
    const files = zip.assets;
    assert(typeof zip.restoredProjectId === 'string' && zip.restoredProjectId.length > 0,
      os + ': offline ZIP reimport has no restored project');
    assert.equal(new Set(files.map(asset => asset.path)).size, 12,
      os + ': duplicate offline ZIP asset path');
    for (const [, { fontSha256, licenseSha256 }] of faces) {
      assert.equal(files.filter(f => f.sha256 === fontSha256).length, 1,
        os + ': font bytes not independently preserved by ZIP reimport');
      assert.equal(files.filter(f => f.sha256 === licenseSha256).length, 1,
        os + ': license bytes not independently preserved by ZIP reimport');
    }
    for (const script of semiticWoff2Faces) {
      assert(files.some(f => f.path?.endsWith('.' + webfontFormat) && f.sha256 === hashesByScript[script]),
        os + ': offline archive lost actual ' + script + ' ' + webfontLabel + ' bytes');
    }
    const video = report.checks.find(item =>
      item.name === 'Actual decoded MP4 preserves each script row and preview glyph geometry');
    assert.deepEqual(report.comparison?.map(row => row.script), requiredScripts,
      os + ': existing seven-script native MP4 check missing');
    assert.deepEqual(video?.rows, report.comparison, os + ': MP4 metrics disagree with source check');
    assert.equal(video?.exportVerification?.status, 'passed', os + ': native MP4 verifier failed');
    assert(Array.isArray(video.exportVerification.checks) &&
      video.exportVerification.checks.length >= 6 &&
      video.exportVerification.checks.every(check => check.status === 'passed'),
      os + ': missing/failed native MP4 container check');
    for (const row of report.comparison) {
      assert(Number.isInteger(row.expectedInk) && row.expectedInk > 90 &&
        Number.isInteger(row.exportedInk) && row.exportedInk > 90,
        os + ': empty preview or MP4 script row ' + row.script);
      assert(Number.isFinite(row.intersectionOverUnion) &&
        row.intersectionOverUnion >= 0.45 && row.intersectionOverUnion <= 1,
        os + ': MP4 glyph overlap below acceptance threshold ' + row.script);
      assert(Number.isFinite(row.meanRgbError) && row.meanRgbError >= 0 &&
        row.meanRgbError <= 22,
        os + ': MP4 color error exceeds acceptance threshold ' + row.script);
    }
    // Contract must track the actual six-state Studio and decoded-MP4
    // hide/reveal run. Do not drop the two hidden seek states or treat their
    // absence as a passing four-state highlight check.
    const times = paintedCaptionSeekTimes;
    const words = times.map(time => time < 0.5 ? 'he' : 'ar');
    const visible = times.map(time => time !== 0.45);
    assert.deepEqual(report.temporalCaptions?.map(row => row.time), times,
      os + ': real timed native caption reverse/hide/seek evidence missing');
    const studio = report.checks.find(item =>
      item.name === 'Actual Studio seek hides and restores authored RTL caption parent without mutation')?.studioSeeks;
    assert.deepEqual(studio?.map(row => row.expectedTime), studioSeekTimes,
      os + ': Studio hide/restore reverse-seek evidence missing');
    for (let i = 0; i < times.length; i++) {
      const row = report.temporalCaptions[i], seek = studio[i];
      const active = words[i], inactive = active === 'he' ? 'ar' : 'he';
      assert.equal(row.seekIndex, i, os + ': timed caption seek index mismatch');
      assert.equal(row.active, active, os + ': wrong active caption after seek');
      assert.equal(row.visible, visible[i], os + ': timed caption visibility receipt mismatch');
      assert.equal(Number(row.parentOpacity) < 0.02, !visible[i],
        os + ': wrong preview caption parent opacity');
      if (i < studioSeekTimes.length) {
        assert.equal(Number(seek.parentOpacity) < 0.02, !visible[i],
          os + ': wrong actual Studio caption parent opacity');
        assert.equal(seek.seekIndex, i, os + ': Studio seek index mismatch');
        assert.equal(seek.unchangedNodes, true, os + ': seek mutated authored caption DOM');
        assert(Math.abs(seek.actualTime - times[i]) <= 0.02,
          os + ': Studio seek time did not match slider request');
      }
      for (const [kind, pixels, ink] of [
        ['browser', row.browserYellow, row.browserInk],
        ['native MP4', row.videoYellow, row.videoInk],
      ]) {
        assert(['he', 'ar'].every(lang => Number.isInteger(pixels?.[lang]) && pixels[lang] >= 0),
          os + ': missing or invalid ' + kind + ' caption pixel counters');
        assert(Number.isInteger(ink) && ink >= 0, os + ': missing or invalid ' + kind + ' caption ink');
        if (!visible[i]) {
          // A styled yellow word can still be invisible because its parent
          // is transparent. Verify actual sampled pixels, not just CSS.
          assert(pixels.he < 25 && pixels.ar < 25 && ink < 25,
            os + ': hidden caption ' + kind + ' ink leaked into decoded pixels');
        } else {
          assert(ink > 90 && pixels[active] > 90,
            os + ': active caption highlight not visible in ' + kind);
          const ghost = pixels[inactive];
          // Preserve BOTH strict absolute and relative ghost thresholds.
          assert(ghost < 25 && ghost / pixels[active] < 0.02,
            os + ': wrong ' + kind + ' highlight');
        }
      }
      // Painted word-centroid drift is independent of yellow-area similarity:
      // a frozen native caption can have identical pixel area but be displaced.
      for (const id of ['he', 'ar']) {
        assert(Number.isFinite(row.wordMotion?.[id]) &&
          Math.abs(row.wordMotion[id] + 32 * times[i]) <= 2.1,
          os + ': authored caption word animation not observed');
      }
      if (!visible[i]) {
        assert.equal(row.browserCentroid, null, os + ': hidden animated caption reports a visible centroid');
        assert.equal(row.videoCentroid, null, os + ': hidden animated MP4 reports a visible centroid');
        assert.equal(row.centroidDriftPx, null, os + ': hidden animated caption claims centroid parity');
        assert.equal(row.areaDrift, null,
          os + ': hidden caption must not claim measured visible area parity');
      } else {
        for (const [kind, centroid] of [
          ['browser', row.browserCentroid], ['native MP4', row.videoCentroid],
        ]) {
          assert(centroid && Number.isFinite(centroid.x) && Number.isFinite(centroid.y) &&
            Number.isInteger(centroid.pixels) && centroid.pixels > 90 &&
            centroid.x >= 24 && centroid.x <= 616 && centroid.y >= 451 && centroid.y < 480,
            os + ': missing actual ' + kind + ' animated word centroid');
        }
        const measuredDrift = Math.hypot(row.videoCentroid.x - row.browserCentroid.x,
          row.videoCentroid.y - row.browserCentroid.y);
        assert(Number.isFinite(row.centroidDriftPx) && row.centroidDriftPx >= 0 &&
          row.centroidDriftPx <= 9 && Math.abs(measuredDrift - row.centroidDriftPx) <= 0.01,
          os + ': decoded MP4 animated word centroid drift');
        assert(Number.isFinite(row.areaDrift) && row.areaDrift >= 0 && row.areaDrift <= 0.35,
          os + ': timed native caption area drift exceeds acceptance threshold');
      }
    }
    verifyPaintedCaptionMovement(report.temporalCaptions, os);
    // Live Studio transport is separate from six externally sought static
    // frames: the physical Play/Pause/Resume button and clock must cross the
    // same visibility boundaries without replacing authored Hebrew/Arabic nodes.
    const live = report.checks.find(item => item.name ===
      'Real Studio Play Pause Resume crosses RTL caption hide and restore with intact authored nodes');
    assert.deepEqual(report.livePlayback, live && {
      phases: live.phases, pauseClockDrift: live.pauseClockDrift,
    }, os + ': real Studio transport evidence differs from source receipt');
    const phases = live?.phases;
    assert.deepEqual(phases?.map(row => row.phase),
      ['hebrew-playing', 'hidden-paused', 'arabic-paused'],
      os + ': real Play/Pause/Resume caption state sequence missing');
    assert.deepEqual(phases.map(row => row.playing), [true, false, false],
      os + ': real Studio transport state was not observed');
    assert.deepEqual(phases.map(row => row.visible), [true, false, true],
      os + ': real Studio transport caption hide/reveal is incomplete');
    const limits = [[0.18, 0.35], [0.35, 0.65], [0.65, 1.02]];
    for (let i = 0; i < phases.length; i++) {
      const row = phases[i];
      assert(Number.isFinite(row.actualTime) && row.actualTime >= limits[i][0] &&
        row.actualTime < limits[i][1], os + ': real transport time outside caption interval');
      assert(Number.isFinite(row.timelineTime) &&
        Math.abs(row.timelineTime - row.actualTime) <= 0.12,
        os + ': Studio slider and playback composition clock disagree');
      assert.equal(row.unchangedNodes, true, os + ': live transport replaced authored caption nodes');
      assert.equal(row.text, 'שָׁלוֹם السَّلَامُ',
        os + ': live transport mutated exact logical Unicode');
      assert(Number.isFinite(row.parentOpacity) &&
        (row.parentOpacity < 0.02) === !row.visible,
        os + ': real transport parent opacity does not match observed visibility');
    }
    assert(Number.isFinite(live.pauseClockDrift) &&
      live.pauseClockDrift >= 0 && live.pauseClockDrift < 0.025,
      os + ': live Studio Pause did not hold its clock');
    assert.equal(report.cleanup?.errors?.length, 0, os + ': test cleanup failures');
  }
  if (woff1) {
    const os = Object.keys(runners);
    return {
      passed: true, format: 'woff', os, sourceCommit, faces: requiredFaces,
      sourceByScript: expectedWoff1Source, runnerEncodings: woff1ByOs,
      byteIdenticalAcrossOs: semiticWoff2Faces.every(id =>
        new Set(os.map(name => woff1ByOs[name].scriptWoffSha256[id])).size === 1),
    };
  }
  assert.equal(new Set(hashes.values()).size, 1,
    'Converted Hebrew WOFF2 must be byte-identical on Windows, macOS and Linux');
  return { passed: true, os: [...hashes.keys()], hebrewWoff2Sha256: hashes.get('ubuntu-24.04'), scriptWoff2Sha256: expectedScriptWoff2, faces: requiredFaces };
}

// Independently verify the actual archived WOFF1, including zlib-decoded
// table bytes, rather than trusting the producer report's magic or hashes.
export function verifyWoff1File(bytes, encoded) {
  assert(bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'wOFF', 'Invalid WOFF1 signature');
  assert(bytes.length <= maxWoff1Bytes && bytes.length === encoded.encodedBytes, 'Invalid WOFF1 receipt length');
  assert.equal(bytes.length, bytes.readUInt32BE(8), 'Invalid WOFF1 length');
  const declaredSfntBytes = bytes.readUInt32BE(16);
  assert(declaredSfntBytes > 0 && declaredSfntBytes <= maxWoff1SfntBytes, 'Invalid WOFF1 decoded SFNT size');
  assert.equal(sha256(bytes), encoded.sha256, 'WOFF1 ZIP font bytes differ from browser/import');
  const tableCount = bytes.readUInt16BE(12);
  const directoryEnd = 44 + 20 * tableCount;
  assert(tableCount > 0 && tableCount <= 128 && directoryEnd <= bytes.length, 'Invalid WOFF1 table directory');
  const seen = new Set();
  const knownTables = [];
  let sfntBytes = 12 + 16 * tableCount;
  for (let i = 0; i < tableCount; i++) {
    const entry = 44 + 20 * i;
    const tag = bytes.toString('ascii', entry, entry + 4);
    assert(!seen.has(tag), 'Duplicate WOFF1 table ' + tag);
    seen.add(tag);
    const offset = bytes.readUInt32BE(entry + 4);
    const storedLength = bytes.readUInt32BE(entry + 8);
    const rawLength = bytes.readUInt32BE(entry + 12);
    assert(offset >= directoryEnd && offset + storedLength <= bytes.length &&
      storedLength <= rawLength && rawLength <= maxWoff1SfntBytes, 'Invalid WOFF1 table extent for ' + tag);
    sfntBytes += Math.ceil(rawLength / 4) * 4;
    if (Object.hasOwn(encoded.decodedSfntTables, tag)) {
      assert(storedLength > 0, 'Empty required WOFF1 table: ' + tag);
      knownTables.push({ tag, offset, storedLength, rawLength });
    }
  }
  assert.equal(sfntBytes, declaredSfntBytes, 'Invalid WOFF1 aggregate SFNT size');
  for (const { tag, offset, storedLength, rawLength } of knownTables) {
    const contents = bytes.subarray(offset, offset + storedLength);
    const data = storedLength === rawLength ? contents : inflateSync(contents, { maxOutputLength: rawLength });
    assert.equal(data.length, rawLength, 'WOFF1 table size changed: ' + tag);
    assert.equal(sha256(data), encoded.decodedSfntTables[tag], 'WOFF1 table digest changed: ' + tag);
  }
  for (const tag of requiredSfnt) assert(seen.has(tag), 'WOFF1 required table missing: ' + tag);
}

async function readBoundedFile(filename, limit) {
  const file = await open(filename, 'r');
  try {
    const info = await file.stat();
    assert(info.isFile() && info.size > 0 && info.size <= limit, 'Oversized or invalid WOFF1 archive file');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      assert(bytesRead > 0, 'Truncated WOFF1 archive file');
      offset += bytesRead;
    }
    const tail = await file.read(Buffer.alloc(1), 0, 1, offset);
    assert.equal(tail.bytesRead, 0, 'WOFF1 archive file changed while reading');
    return bytes;
  } finally {
    await file.close();
  }
}

export async function verifyFromDirectory(root, webfontFormat = 'woff2') {
  assert(path.isAbsolute(root), 'Expected absolute evidence directory');
  const reports = {};
  for (const os of Object.keys(runners)) {
    reports[os] = JSON.parse(await readFile(path.join(root, os, 'result.json'), 'utf8'));
  }
  const verified = verifyCrossOsFontEvidence(reports, webfontFormat);
  const artifactSha256 = {};
  for (const os of Object.keys(runners)) artifactSha256[os] = await verifyArtifactFiles(root, os);
  if (webfontFormat === 'woff') {
    const woffArchiveSha256 = {};
    for (const os of Object.keys(runners)) {
      const dir = path.join(root, os, 'woff1-fonts');
      woffArchiveSha256[os] = {};
      for (const encoded of reports[os].scriptWoff) {
        const font = await readBoundedFile(path.join(dir, encoded.filename), maxWoff1Bytes);
        const license = await readBoundedFile(path.join(dir, encoded.sourceLicense), maxOflBytes);
        verifyWoff1File(font, encoded);
        assert.equal(sha256(license), encoded.sourceLicenseSha256, os + ': WOFF1 ZIP OFL bytes changed');
        assert.equal(gitBlob(license), encoded.sourceLicenseGitBlob, os + ': WOFF1 ZIP OFL Git blob changed');
        woffArchiveSha256[os][encoded.id] = { font: sha256(font), ofl: sha256(license) };
      }
    }
    return { ...verified, artifactSha256, woffArchiveSha256 };
  }
  return { ...verified, artifactSha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length <= 4 && (process.argv[3] === undefined || process.argv[3] === '--woff1'),
      'Unknown webfont evidence mode');
    const result = await verifyFromDirectory(process.argv[2] || '', process.argv[3] === '--woff1' ? 'woff' : 'woff2');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('RTL_CROSS_OS_FONT_ATTESTATION_FAILED: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
