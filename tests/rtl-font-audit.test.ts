import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditFont } from '../scripts/rtl-font-audit.ts';

test('font audit rejects invalid and oversized WOFF2 without needing a browser', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'rtl-font-audit-'));
  try {
    const unknown = path.join(folder,'unsupported.bin');
    await writeFile(unknown,Buffer.alloc(40,0x61));
    await assert.rejects(() => auditFont(unknown,'שלום'), /UNSUPPORTED_FONT_SIGNATURE/);
    const malformed = Buffer.alloc(24);
    malformed.write('wOF2');
    malformed.writeUInt32BE(129 * 1024 * 1024,16);
    const oversized=path.join(folder,'over-limit.woff2');
    await writeFile(oversized,malformed);
    await assert.rejects(() => auditFont(oversized,'العربية'), /INVALID_COMPRESSED_FONT_SIZE/);
  } finally {await rm(folder,{recursive:true,force:true});}
});

test('font audit requires actual sample text', async () => {
  await assert.rejects(() => auditFont('/not/needed.ttf',''), /SUPPLY_REAL_TEXT/);
});

test('real font audit reports Hebrew, Arabic and Syriac glyph gaps rather than claiming shaping coverage', async () => {
  const font = new URL('./fixtures/fonts/orbitron.ttf', import.meta.url);
  const result = await auditFont(fileURLToPath(font), 'A א ع ܐ');
  assert.equal(result.format, 'ttf');
  assert.equal(result.family, 'Orbitron');
  const missing = new Set(result.missingCodepoints.map(point => point.hex));
  assert.equal(missing.has('U+0041'), false);
  assert.equal(missing.has('U+05D0'), true);
  assert.equal(missing.has('U+0639'), true);
  assert.equal(missing.has('U+0710'), true);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  // A successful fontkit layout only counts glyph objects; it never proves
  // contextual shaping or combining-mark placement in an actual browser.
  assert.equal(typeof result.shapedGlyphCount, 'number');
});

test('font audit records bounded five-script probes plus Ethiopic/LTR without claiming shaping', async () => {
  const font = fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
  const result = await auditFont(font, 'A');
  const byLang = new Map(result.scriptSamples.map(row => [row.language, row]));
  assert.deepEqual([...byLang.keys()], ['he', 'ar', 'fa', 'ur', 'syr', 'am', 'en']);
  const absent = new Map([
    ['he', 'U+05E9'], // Hebrew shin
    ['ar', 'U+0633'], // Arabic seen
    ['fa', 'U+067E'], // Persian peh
    ['ur', 'U+0679'], // Urdu tteh
    ['syr', 'U+0710'], // Syriac alaph
    ['am', 'U+1230'], // Ethiopic sa
  ]);
  for (const [lang, missingCp] of absent) {
    const probe = byLang.get(lang)!;
    assert.ok(probe.checkedCodepoints > 0);
    assert.equal(probe.allProbeCodepointsPresent, false, lang);
    assert.ok(probe.missingCodepoints.some(point => point.hex === missingCp), lang);
  }
  assert.equal(byLang.get('am')?.direction, 'ltr');
  assert.equal(byLang.get('en')?.direction, 'ltr');
  assert.equal(byLang.get('en')?.allProbeCodepointsPresent, true);
  assert.equal(byLang.get('en')?.missingCodepoints.length, 0);
});

test('font audit excludes RTL format controls but never silently skips vowel marks', async () => {
  const font = fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
  // RLO, isolate and PDF must not be reported as missing glyphs; niqqud must.
  const result = await auditFont(font, 'A\u202E\u2067\u05E9\u05B8\u202C\u2069\uFE0F\u200D');
  assert.equal(result.checkedCodepoints, 3);
  const missing = new Set(result.missingCodepoints.map(point => point.hex));
  assert.deepEqual(missing, new Set(['U+05E9', 'U+05B8']));
  assert.equal(result.missingCodepoints.some(point => point.hex === 'U+202E'), false);
  assert.equal(result.missingCodepoints.some(point => point.hex === 'U+FE0F' || point.hex === 'U+200D'), false, 'Variation selectors and joiners are not standalone glyphs');
});
