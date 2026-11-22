import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyArtifactFiles, verifyCrossOsFontEvidence, verifyFromDirectory, verifyWoff1File, runners } from '../scripts/rtl-verify-cross-os-fonts.mjs';

const dir = process.env.RTL_CROSS_OS_FIXTURES;
async function load(root = dir) {
  const reports = {};
  for (const os of Object.keys(runners)) {
    reports[os] = JSON.parse(await readFile(path.join(root, os, 'result.json'), 'utf8'));
  }
  return reports;
}

// Always consume this workflow run's real three-OS artifacts, never an in-repo
// sample or synthetic passing fixture. Mutate copies to prove fail-closed cases.
test('require identical actual converted WOFF2 and six licenses across OS', async () => {
  const result = verifyCrossOsFontEvidence(await load());
  assert.equal(result.passed, true);
  assert.match(result.hebrewWoff2Sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.scriptWoff2Sha256), ['hebrew', 'arabic', 'urdu', 'syriac']);
  for (const hash of Object.values(result.scriptWoff2Sha256)) assert.match(hash, /^[a-f0-9]{64}$/);
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
    assert.equal(Object.keys(evidence.artifactSha256[os]).length, 16);
    for (const hash of Object.values(evidence.artifactSha256[os])) assert.match(hash, /^[a-f0-9]{64}$/);
  }
});

test('reject missing hide/reveal states and any invisible caption ink in either renderer', async () => {
  const reports = await load();
  const linux = reports['ubuntu-24.04'];
  const hidden = linux.temporalCaptions[1];
  const originalBrowserInk = hidden.browserInk;
  const originalVideoInk = hidden.videoInk;
  const originalVideoYellow = hidden.videoYellow.he;
  hidden.browserInk = 25;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /hidden caption browser ink leaked/);
  hidden.browserInk = originalBrowserInk;
  hidden.videoInk = 25;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /hidden caption native MP4 ink leaked/);
  hidden.videoInk = originalVideoInk;
  hidden.videoYellow.he = 25;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /hidden caption native MP4 ink leaked/);
  hidden.videoYellow.he = originalVideoYellow;
  hidden.visible = true;
  assert.throws(() => verifyCrossOsFontEvidence(reports), /visibility receipt mismatch/);
  hidden.visible = false;
  linux.temporalCaptions.splice(3, 1);
  assert.throws(() => verifyCrossOsFontEvidence(reports), /reverse\/hide\/seek evidence missing/);
});

test('reject missing, reordered or forged real Studio playback transport evidence', async () => {
  const original = await load();
  const withoutPlay = structuredClone(original);
  delete withoutPlay['ubuntu-24.04'].livePlayback;
  assert.throws(() => verifyCrossOsFontEvidence(withoutPlay),
    /real Studio transport evidence differs/);
  const missing = structuredClone(original);
  missing['ubuntu-24.04'].livePlayback.phases.pop();
  missing['ubuntu-24.04'].checks.find(check => check.pauseClockDrift != null).phases.pop();
  assert.throws(() => verifyCrossOsFontEvidence(missing),
    /real Play\/Pause\/Resume caption state sequence missing/);
  for (const field of ['unchangedNodes', 'text', 'parentOpacity', 'timelineTime']) {
    const forged = structuredClone(original);
    const item = forged['macos-15'].livePlayback.phases[1];
    const receipt = forged['macos-15'].checks.find(check => check.pauseClockDrift != null).phases[1];
    const bad = field === 'text' ? 'NOT ORIGINAL' : field === 'unchangedNodes' ? false : 10;
    item[field] = receipt[field] = bad;
    const errors = {
      unchangedNodes: /live transport replaced authored caption nodes/,
      text: /live transport mutated exact logical Unicode/,
      parentOpacity: /real transport parent opacity/,
      timelineTime: /slider and playback composition clock disagree/,
    };
    assert.throws(() => verifyCrossOsFontEvidence(forged), errors[field]);
  }
  const moving = structuredClone(original);
  moving['windows-2025'].livePlayback.pauseClockDrift = 0.1;
  moving['windows-2025'].checks.find(check => check.pauseClockDrift != null).pauseClockDrift = 0.1;
  assert.throws(() => verifyCrossOsFontEvidence(moving), /Pause did not hold its clock/);
});

test('reject claimed hidden CSS state without actual Studio parent opacity', async () => {
  const reports = await load();
  const linux = reports['ubuntu-24.04'];
  const item = linux.checks.find(check => check.studioSeeks)?.studioSeeks?.[1];
  assert(item, 'Real current-run Studio hide evidence required');
  item.parentOpacity = '1';
  assert.throws(() => verifyCrossOsFontEvidence(reports), /actual Studio caption parent opacity/);
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

test('reject absent and malformed actual pixel counters and ink on visible and hidden frames', async () => {
  const pristine = await load();
  // Mutate the actual current-run reports, not a fabricated passing fixture.
  // Missing counters are rejected *before* the separate highlight/ink limits;
  // require the exact fail-closed error so an unrelated gate cannot mask this.
  for (const seekIndex of [0, 1]) {
    for (const [kind, pixelKey, inkKey] of [
      ['browser', 'browserYellow', 'browserInk'],
      ['native MP4', 'videoYellow', 'videoInk'],
    ]) {
      const pixelError = new RegExp('macos-15: missing or invalid ' + kind + ' caption pixel counters');
      const inkError = new RegExp('macos-15: missing or invalid ' + kind + ' caption ink');
      for (const invalid of [-1, 0.5, '0', null, Number.NaN]) {
        const badPixels = structuredClone(pristine);
        badPixels['macos-15'].temporalCaptions[seekIndex][pixelKey].he = invalid;
        assert.throws(() => verifyCrossOsFontEvidence(badPixels), pixelError);
        const badInk = structuredClone(pristine);
        badInk['macos-15'].temporalCaptions[seekIndex][inkKey] = invalid;
        assert.throws(() => verifyCrossOsFontEvidence(badInk), inkError);
      }
      const missingPixel = structuredClone(pristine);
      delete missingPixel['macos-15'].temporalCaptions[seekIndex][pixelKey].he;
      assert.throws(() => verifyCrossOsFontEvidence(missingPixel), pixelError);
      const missingInk = structuredClone(pristine);
      delete missingInk['macos-15'].temporalCaptions[seekIndex][inkKey];
      assert.throws(() => verifyCrossOsFontEvidence(missingInk), inkError);
    }
  }
});

test('reject converted non-Hebrew WOFF2 bytes that disagree with imported font receipts', async () => {
  const reports = await load();
  const windows = reports['windows-2025'];
  const converted = windows.scriptWoff2.find(face => face.id === 'urdu');
  const used = windows.checks.find(check => Array.isArray(check.scriptWoff2))
    .scriptWoff2.find(face => face.id === 'urdu');
  assert(converted && used, 'Real current-run Urdu conversion evidence required');
  converted.sha256 = 'f'.repeat(64);
  used.sha256 = 'f'.repeat(64);
  assert.throws(() => verifyCrossOsFontEvidence(reports), /converted WOFF2 differs from actual imported font/);
});
test('reject missing Semitic converter evidence even when native MP4 and ZIP were green', async () => {
  const reports = await load();
  reports['macos-15'].scriptWoff2 = reports['macos-15'].scriptWoff2.filter(face => face.id !== 'syriac');
  assert.throws(() => verifyCrossOsFontEvidence(reports), /reported font conversions contradict browser evidence/);
});

const woff1Dir = process.env.RTL_CROSS_OS_WOFF1_FIXTURES;
if (woff1Dir) {
  test('WOFF1 binds actual WOFF archive bytes, decoded SFNT, licenses and media to all three OS receipts', async () => {
    const result = await verifyFromDirectory(woff1Dir, 'woff');
    assert.equal(result.passed, true);
    assert.equal(result.format, 'woff');
    for (const os of Object.keys(runners)) {
      assert.equal(Object.keys(result.artifactSha256[os]).length, 16);
      assert.equal(Object.keys(result.woffArchiveSha256[os]).length, 4);
      assert.equal(typeof result.runnerEncodings[os].zlibRuntimeVersion, 'string');
    }
  });

  test('WOFF1 reports distinct runner container bytes without weakening decoded font identity', async () => {
    const reports = await load(woff1Dir);
    const windows = reports['windows-2025'];
    const alias = windows.checks.find(x => x.scriptWoff);
    const different = 'f'.repeat(64);
    const previous = windows.scriptWoff[0].sha256;
    windows.scriptWoff[0].sha256 = alias.scriptWoff[0].sha256 = different;
    alias.servedWoffSha256.hebrew = windows.fonts.find(f => f.id === 'hebrew').fontSha256 = different;
    windows.checks.find(x => x.assets).assets.find(asset => asset.sha256 === previous).sha256 = different;
    const result = verifyCrossOsFontEvidence(reports, 'woff');
    assert.equal(result.byteIdenticalAcrossOs, false);
    assert.equal(result.runnerEncodings['windows-2025'].scriptWoffSha256.hebrew, different);
    windows.scriptWoff[0].decodedSfntTables.GSUB = alias.scriptWoff[0].decodedSfntTables.GSUB = different;
    assert.throws(() => verifyCrossOsFontEvidence(reports, 'woff'), /decoded WOFF1 SFNT differs/);
  });

  test('WOFF1 fails closed on absent zlib provenance, wrong magic or mismatched decoded table digest', async () => {
    const reports = await load(woff1Dir);
    const linux = reports['ubuntu-24.04'];
    const encoded = linux.scriptWoff[0];
    const bytes = await readFile(path.join(woff1Dir, 'ubuntu-24.04', 'woff1-fonts', encoded.filename));
    const wrongMagic = Buffer.from(bytes);
    wrongMagic.write('wOF2', 0, 'ascii');
    assert.throws(() => verifyWoff1File(wrongMagic, encoded), /Invalid WOFF1 signature/);
    const oversized = Buffer.from(bytes);
    oversized.writeUInt32BE(16 * 1024 * 1024 + 1, 16);
    assert.throws(() => verifyWoff1File(oversized, encoded), /Invalid WOFF1 decoded SFNT size/);
    const wrongAggregate = Buffer.from(bytes);
    wrongAggregate.writeUInt32BE(wrongAggregate.readUInt32BE(16) + 4, 16);
    const forgedReceipt = { ...encoded, sha256: createHash('sha256').update(wrongAggregate).digest('hex') };
    assert.throws(() => verifyWoff1File(wrongAggregate, forgedReceipt), /Invalid WOFF1 aggregate SFNT size/);
    const wrongTable = structuredClone(encoded);
    wrongTable.decodedSfntTables.GPOS = '0'.repeat(64);
    assert.throws(() => verifyWoff1File(bytes, wrongTable), /WOFF1 table digest changed/);
    delete encoded.zlibRuntimeVersion;
    delete linux.checks.find(x => x.scriptWoff).scriptWoff[0].zlibRuntimeVersion;
    assert.throws(() => verifyCrossOsFontEvidence(reports, 'woff'), /missing exact zlib runtime version/);
  });
}
