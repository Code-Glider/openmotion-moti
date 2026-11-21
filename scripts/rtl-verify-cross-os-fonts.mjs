/** Fail-closed cross-runner attestation for actual Studio/MP4/ZIP font evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const runners = Object.freeze({
  'ubuntu-24.04': 'linux',
  'macos-15': 'darwin',
  'windows-2025': 'win32',
});
const requiredFaces = ['hebrew', 'arabic', 'urdu', 'syriac', 'ethiopic', 'latin'];
const requiredScripts = ['he', 'ar', 'fa', 'ur', 'syr', 'am', 'en'];
const hexSha = /^[a-f0-9]{64}$/;
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10]);
const mediaNames = [
  'exported-rtl.mp4', 'exported-mp4-frame.png', 'preview-frame.png',
  'studio-before-edit.png', 'studio-after-edit.png',
  'studio-all-scripts-edited.png', 'studio-after-reverse-seek.png',
  'preview-caption-seek-0-0.25.png', 'preview-caption-seek-1-0.75.png',
  'preview-caption-seek-2-0.25.png', 'preview-caption-seek-3-0.75.png',
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


export function verifyCrossOsFontEvidence(reports) {
  assert.deepEqual(Object.keys(reports).sort(), Object.keys(runners).sort(), 'Three exact OS reports required');
  const hashes = new Map();
  let expectedFaces = null;
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
    const sortedFaces = Object.fromEntries([...faces].sort(([a], [b]) => a.localeCompare(b)));
    if (!expectedFaces) expectedFaces = sortedFaces;
    else assert.deepEqual(sortedFaces, expectedFaces, os + ': font or license bytes differ from other runner');

    const fontCheck = report.checks?.find(item => item.name ===
      'Project-local licensed fonts actually used by Chromium, including Hebrew WOFF2');
    const conversion = fontCheck?.hebrewWoff2;
    for (const lang of requiredScripts) {
      assert(fontCheck?.fontUsage?.[lang]?.some(face =>
        face.isCustomFont === true && Number.isInteger(face.glyphCount) && face.glyphCount > 0),
        os + ': actual Chromium custom-font use missing for ' + lang);
    }
    assert.equal(conversion?.format, 'woff2', os + ': actual WOFF2 converter result absent');
    assert.equal(conversion?.filename, 'hebrew.woff2', os + ': unexpected converted filename');
    assert.equal(conversion?.converter, 'fonttools 4.59.0 + Brotli 1.1.0', os + ': unpinned converter');
    assert.equal(conversion?.sourceTtfSha256,
      '7ef36a2c3593758cdb622e1bdef4f84523e92fbc3ccc667438dd80ff54c2de88',
      os + ': changed original pinned Hebrew font');
    assert.equal(conversion?.sha256, faces.get('hebrew').fontSha256, os + ': converted-font hash mismatch');
    assert(conversion.encodedBytes > 0 && conversion.numGlyphs >= 470,
      os + ': invalid font conversion inventory');
    assert(['GSUB', 'GPOS', 'GDEF'].every(tag => conversion.layoutTables?.includes(tag)),
      os + ': missing shaping table after WOFF2 conversion');
    hashes.set(os, conversion.sha256);

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
    assert(files.some(f => f.path?.endsWith('.woff2') && f.sha256 === conversion.sha256),
      os + ': offline archive lost actual WOFF2 format');
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
    const times = [0.25, 0.75, 0.25, 0.75];
    const words = ['he', 'ar', 'he', 'ar'];
    assert.deepEqual(report.temporalCaptions?.map(row => row.time), times,
      os + ': real timed native caption reverse/seek evidence missing');
    const studio = report.checks.find(item =>
      item.name === 'Actual Studio seek control reverses and replays RTL word highlights without mutation')?.studioSeeks;
    assert.deepEqual(studio?.map(row => row.expectedTime), times,
      os + ': Studio reverse-seek evidence missing');
    for (let i = 0; i < times.length; i++) {
      const row = report.temporalCaptions[i], seek = studio[i];
      const active = words[i], inactive = active === 'he' ? 'ar' : 'he';
      assert.equal(row.seekIndex, i, os + ': timed caption seek index mismatch');
      assert.equal(row.active, active, os + ': wrong active caption after seek');
      assert(row.browserYellow?.[active] > 90 && row.videoYellow?.[active] > 90,
        os + ': active caption highlight not visible in browser and MP4');
      // The real browser pixel analyzer accepts <25 stray yellow pixels in
      // an inactive caption bounding rect (antialiasing/adjacent glyph edges).
      // Windows Chrome yielded 14 on a real passed seek while the word's
      // computed style was inactive. Demand BOTH the renderer's absolute
      // tolerance and a stricter <2% contamination relative to active ink.
      // Never accept missing, negative, NaN, or forged non-integer counts.
      for (const [kind, pixels] of [
        ['browser', row.browserYellow],
        ['native MP4', row.videoYellow],
      ]) {
        const ghost = pixels?.[inactive], ink = pixels?.[active];
        assert(Number.isInteger(ghost) && ghost >= 0 && ghost < 25 &&
          Number.isInteger(ink) && ghost / ink < 0.02,
          os + ': wrong ' + kind + ' highlight');
      }
      assert(Number.isFinite(row.areaDrift) && row.areaDrift >= 0 && row.areaDrift <= 0.35,
        os + ': timed native caption area drift exceeds acceptance threshold');
      assert.equal(seek.seekIndex, i, os + ': Studio seek index mismatch');
      assert.equal(seek.unchangedNodes, true, os + ': seek mutated authored caption DOM');
      assert(Math.abs(seek.actualTime - times[i]) <= 0.02,
        os + ': Studio seek time did not match slider request');
    }
    assert.equal(report.cleanup?.errors?.length, 0, os + ': test cleanup failures');
  }
  assert.equal(new Set(hashes.values()).size, 1,
    'Converted Hebrew WOFF2 must be byte-identical on Windows, macOS and Linux');
  return { passed: true, os: [...hashes.keys()], hebrewWoff2Sha256: hashes.get('ubuntu-24.04'), faces: requiredFaces };
}

export async function verifyFromDirectory(root) {
  assert(path.isAbsolute(root), 'Expected absolute evidence directory');
  const reports = {};
  for (const os of Object.keys(runners)) {
    reports[os] = JSON.parse(await readFile(path.join(root, os, 'result.json'), 'utf8'));
  }
  const verified = verifyCrossOsFontEvidence(reports);
  const artifactSha256 = {};
  for (const os of Object.keys(runners)) artifactSha256[os] = await verifyArtifactFiles(root, os);
  return { ...verified, artifactSha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyFromDirectory(process.argv[2] || '');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write('RTL_CROSS_OS_FONT_ATTESTATION_FAILED: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
