import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyCrossOsFontEvidence, runners } from '../scripts/rtl-verify-cross-os-fonts.mjs';

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
