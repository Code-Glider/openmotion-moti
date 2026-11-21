import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyArtifactFiles, verifyCrossOsFontEvidence, verifyFromDirectory, runners } from '../scripts/rtl-verify-cross-os-fonts.mjs';

const dir = process.env.RTL_CROSS_OS_FIXTURES;
async function load() {
  const reports = {};
  for (const os of Object.keys(runners)) {
    reports[os] = JSON.parse(await readFile(path.join(dir, os, 'result.json'), 'utf8'));
  }
  return reports;
}

// Always consume this workflow run's real three-OS artifacts, never an in-repo
// sample or synthetic passing fixture. Mutate copies to prove fail-closed cases.
test('require identical actual converted WOFF2 and six licenses across OS', async () => {
  const result = verifyCrossOsFontEvidence(await load());
  assert.equal(result.passed, true);
  assert.match(result.hebrewWoff2Sha256, /^[a-f0-9]{64}$/);
});
test('refuse cross-runner WOFF2 hash divergence even when all reports pass', async () => {
  const reports = await load();
  reports['windows-2025'].fonts[0].fontSha256 = 'f'.repeat(64);
  reports['windows-2025'].checks.find(x => x.hebrewWoff2).hebrewWoff2.sha256 = 'f'.repeat(64);
  reports['windows-2025'].checks.find(x => x.assets).assets[0].sha256 = 'f'.repeat(64);
  assert.throws(() => verifyCrossOsFontEvidence(reports), /font or license bytes differ/);
});
test('refuse missing platform and absent offline license assets', async () => {
  const reports = await load();
  delete reports['macos-15'];
  assert.throws(() => verifyCrossOsFontEvidence(reports), /Three exact OS reports required/);
  const restored = await load();
  restored['macos-15'].checks.find(x => x.assets).assets.pop();
  assert.throws(() => verifyCrossOsFontEvidence(restored), /six fonts and six licenses/);
});
test('refuse nominal success without actual native MP4 or caption-seek evidence', async () => {
  const reports = await load();
  reports['ubuntu-24.04'].comparison = [];
  assert.throws(() => verifyCrossOsFontEvidence(reports), /seven-script native MP4 check missing/);
});

test('hash all actual Studio PNGs, browser seek captures and exported MP4 bytes', async () => {
  const evidence = await verifyFromDirectory(dir);
  for (const os of Object.keys(runners)) {
    assert.equal(Object.keys(evidence.artifactSha256[os]).length, 11);
    for (const hash of Object.values(evidence.artifactSha256[os])) assert.match(hash, /^[a-f0-9]{64}$/);
  }
});

test('reject corrupt PNG evidence even when every JSON report claims pass', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rtl-actual-media-tamper-'));
  try {
    await cp(path.join(dir, 'ubuntu-24.04'), path.join(root, 'ubuntu-24.04'), { recursive: true });
    await writeFile(path.join(root, 'ubuntu-24.04', 'preview-frame.png'), Buffer.from('not-a-png'));
    await assert.rejects(() => verifyArtifactFiles(root, 'ubuntu-24.04'),
      /empty\/truncated media evidence|invalid PNG signature/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reject forged green MP4 comparison with zero actual glyph overlap', async () => {
  const reports = await load();
  const linux = reports['ubuntu-24.04'];
  linux.comparison[0].intersectionOverUnion = 0;
  linux.checks.find(check => check.rows).rows[0].intersectionOverUnion = 0;
  assert.throws(() => verifyCrossOsFontEvidence(reports),
    /MP4 glyph overlap below acceptance threshold/);
});

test('reject timed MP4 caption pass with no visible selected-word highlight', async () => {
  const reports = await load();
  reports['macos-15'].temporalCaptions[0].videoYellow.he = 0;
  assert.throws(() => verifyCrossOsFontEvidence(reports),
    /active caption highlight not visible/);
});

test('reject inactive word highlight contamination above the original browser/MP4 pixel contract', async () => {
  const reports = await load();
  const windows = reports['windows-2025'].temporalCaptions[0];
  // The real source-backed browser test already requires <25; its cross-OS
  // gate must ALSO reject a tiny stale region that exceeds 2% active ink.
  windows.browserYellow.ar = 25;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /wrong browser highlight/);
  windows.browserYellow.ar = 24;
  windows.browserYellow.he = 500;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /wrong browser highlight/);
  windows.browserYellow.ar = 0;
  windows.browserYellow.he = 1197;
  windows.videoYellow.ar = 25;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /wrong native MP4 highlight/);
});

test('reject missing and negative inactive pixel counters instead of treating them as zero', async () => {
  const reports = await load();
  const row = reports['macos-15'].temporalCaptions[1];
  delete row.browserYellow.he;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /wrong browser highlight/);
  row.browserYellow.he = -1;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /wrong browser highlight/);
});
