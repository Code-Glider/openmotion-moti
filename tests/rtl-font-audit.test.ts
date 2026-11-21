import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditFont, assertRequiredScriptCoverage, assertRequiredScriptLayout, inspectFontkitLayout } from '../scripts/rtl-font-audit.ts';

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

test('fontkit shaping evidence exposes .notdef glyphs and positioning without claiming visual correctness', () => {
  const layout = (text: string) => {
    assert.equal(text, 'سَلَام');
    return {
      glyphs: [{ id: 7 }, { id: 0 }, { id: 22 }],
      positions: [{ xOffset: 0, yOffset: 0 }, { xOffset: 0, yOffset: 4 }, { xOffset: 2, yOffset: 0 }],
    };
  };
  assert.deepEqual(inspectFontkitLayout({ layout }, 'سَلَام'), {
    glyphCount: 3, notdefGlyphCount: 1, positionedGlyphCount: 2,
  });
  assert.deepEqual(inspectFontkitLayout({ layout: () => { throw new Error('NO_SHAPING_TABLE'); } }, 'سَلَام'), { error: 'NO_SHAPING_TABLE' });
  assert.deepEqual(inspectFontkitLayout({ layout: () => ({
    glyphs: [{ id: 1 }], positions: [],
  }) }, 'سَلَام'), { error: 'LAYOUT_GLYPH_POSITION_MISMATCH' });
});

test('fontkit probes explicitly select OpenType script and direction', () => {
  const seen: Array<[string | undefined, string | undefined]> = [];
  const font = { layout: (_text: string, _features?: undefined, script?: string, _language?: undefined, direction?: 'rtl' | 'ltr') => {
    seen.push([script, direction]);
    return { glyphs: [{ id: 12 }], positions: [{ xOffset: 0, yOffset: 0 }] };
  } };
  assert.deepEqual(inspectFontkitLayout(font, 'ܫܠܡܐ', 'syrc', 'rtl'), {
    glyphCount: 1, notdefGlyphCount: 0, positionedGlyphCount: 0,
  });
  assert.deepEqual(inspectFontkitLayout(font, 'ABC', 'latn', 'ltr'), {
    glyphCount: 1, notdefGlyphCount: 0, positionedGlyphCount: 0,
  });
  assert.deepEqual(seen, [['syrc', 'rtl'], ['latn', 'ltr']]);
});

test('font audit records bounded five-script probes plus Ethiopic/LTR without claiming shaping', async () => {
  const font = fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
  const result = await auditFont(font, 'A');
  const byLang = new Map(result.scriptSamples.map(row => [row.language, row]));
  assert.deepEqual([...byLang.keys()], ['he', 'ar', 'fa', 'ur', 'syr', 'am', 'en']);
  assert.deepEqual(result.scriptSamples.map(probe => probe.fontkitScript), ['hebr', 'arab', 'arab', 'arab', 'syrc', 'ethi', 'latn']);
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
  const latin = byLang.get('en')!.fontkitLayout;
  assert.ok('glyphCount' in latin, JSON.stringify(latin));
  if ('glyphCount' in latin) {
    assert.ok(latin.glyphCount > 0);
    assert.equal(latin.notdefGlyphCount, 0, 'Orbitron has the Latin sample glyphs');
  }
  const arabic = byLang.get('ar')!.fontkitLayout;
  assert.ok('notdefGlyphCount' in arabic, JSON.stringify(arabic));
  if ('notdefGlyphCount' in arabic) assert.ok(arabic.notdefGlyphCount > 0, 'Absent Arabic glyphs must not be mistaken for shaping success');
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

test('required-script gate is opt-in, checks known probes, and refuses false Semitic coverage', async () => {
  const font = fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
  const result = await auditFont(font, 'A');
  assert.doesNotThrow(() => assertRequiredScriptCoverage(result, ['en']));
  assert.throws(() => assertRequiredScriptCoverage(result, ['en', 'he']), /MISSING_REQUIRED_SCRIPT_GLYPHS: he:.*U[+]05E9/);
  assert.throws(() => assertRequiredScriptCoverage(result, ['ar']), /MISSING_REQUIRED_SCRIPT_GLYPHS: ar/);
  assert.throws(() => assertRequiredScriptCoverage(result, ['syr']), /MISSING_REQUIRED_SCRIPT_GLYPHS: syr/);
  assert.throws(() => assertRequiredScriptCoverage(result, []), /REQUIRED_FONT_SCRIPT_PROBES_EMPTY/);
  assert.throws(() => assertRequiredScriptCoverage(result, ['unknown']), /UNKNOWN_FONT_SCRIPT_PROBE: unknown/);
});

test('layout gate checks cmap and fontkit runs, rejecting .notdef and missing shaping evidence', async () => {
  const font = fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
  const report = await auditFont(font, 'ABC');
  assert.doesNotThrow(() => assertRequiredScriptLayout(report, ['en']));
  assert.throws(() => assertRequiredScriptLayout(report, ['he']), /MISSING_REQUIRED_SCRIPT_GLYPHS: he/);
  const broken = structuredClone(report);
  const row = broken.scriptSamples.find(probe => probe.language === 'en')!;
  row.fontkitLayout = { error: 'SYNTHETIC_LAYOUT_FAILURE' };
  assert.throws(() => assertRequiredScriptLayout(broken, ['en']), /REQUIRED_SCRIPT_LAYOUT_ERROR: en: SYNTHETIC_LAYOUT_FAILURE/);
  row.fontkitLayout = { glyphCount: 3, notdefGlyphCount: 1, positionedGlyphCount: 0 };
  assert.throws(() => assertRequiredScriptLayout(broken, ['en']), /REQUIRED_SCRIPT_LAYOUT_INCOMPLETE: en: glyphs=3,notdef=1/);
  row.fontkitLayout = { glyphCount: 0, notdefGlyphCount: 0, positionedGlyphCount: 0 };
  assert.throws(() => assertRequiredScriptLayout(broken, ['en']), /REQUIRED_SCRIPT_LAYOUT_INCOMPLETE: en: glyphs=0,notdef=0/);
});

test('font audit CLI reports evidence but exits nonzero when required script glyphs are absent', () => {
  const font = fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
  const entry = fileURLToPath(new URL('../scripts/rtl-font-audit.ts', import.meta.url));
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const run = (language: string, gate = '--require-scripts') => spawnSync(process.execPath, [
    '--experimental-strip-types', entry, font, 'A', gate, language,
  ], { cwd, encoding: 'utf8', timeout: 15000 });
  const latin = run('en');
  assert.equal(latin.status, 0, latin.stderr);
  assert.equal(JSON.parse(latin.stdout).family, 'Orbitron');
  const hebrew = run('he');
  assert.notEqual(hebrew.status, 0, 'A Latin-only face cannot qualify as Hebrew');
  assert.equal(JSON.parse(hebrew.stdout).scriptSamples.some((row: { language: string }) => row.language === 'he'), true);
  assert.match(hebrew.stderr, /MISSING_REQUIRED_SCRIPT_GLYPHS: he/);
  const unsupported = run('xx');
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /UNKNOWN_FONT_SCRIPT_PROBE: xx/);
  const latinLayout = run('en', '--require-layout-scripts');
  assert.equal(latinLayout.status, 0, latinLayout.stderr);
  assert.equal(JSON.parse(latinLayout.stdout).scriptSamples.find((row: { language: string }) => row.language === 'en')?.fontkitScript, 'latn');
  const arabicLayout = run('ar', '--require-layout-scripts');
  assert.notEqual(arabicLayout.status, 0);
  assert.match(arabicLayout.stderr, /MISSING_REQUIRED_SCRIPT_GLYPHS: ar/);
  assert.equal(JSON.parse(arabicLayout.stdout).scriptSamples.find((row: { language: string }) => row.language === 'ar')?.fontkitScript, 'arab');
});
