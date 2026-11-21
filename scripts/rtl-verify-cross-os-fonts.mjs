/** Fail-closed cross-runner attestation for actual Studio/MP4/ZIP font evidence. */
import assert from 'node:assert/strict';
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

    const conversion = report.checks?.find(item => item.name ===
      'Project-local licensed fonts actually used by Chromium, including Hebrew WOFF2')?.hebrewWoff2;
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
    for (const [, { fontSha256, licenseSha256 }] of faces) {
      assert.equal(files.filter(f => f.sha256 === fontSha256).length, 1,
        os + ': font bytes not independently preserved by ZIP reimport');
      assert.equal(files.filter(f => f.sha256 === licenseSha256).length, 1,
        os + ': license bytes not independently preserved by ZIP reimport');
    }
    assert(files.some(f => f.path?.endsWith('.woff2') && f.sha256 === conversion.sha256),
      os + ': offline archive lost actual WOFF2 format');
    assert.deepEqual(report.comparison?.map(row => row.script), requiredScripts,
      os + ': existing seven-script native MP4 check missing');
    assert.deepEqual(report.temporalCaptions?.map(row => row.time), [0.25, 0.75, 0.25, 0.75],
      os + ': real timed native caption reverse/seek evidence missing');
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
  return verifyCrossOsFontEvidence(reports);
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
