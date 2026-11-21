/**
 * Offline, read-only WOFF/WOFF2/TTF/OTF/TTC Semitic font audit.
 * Check Unicode codepoint coverage, face metadata and parsing/shaping readiness.
 * Does not install fonts, modify projects, prove browser fallback or license rights.
 * Run: node --experimental-strip-types scripts/rtl-font-audit.ts FILE 'שלום עולם'
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FONT_FILE = 64 * 1024 * 1024;
const MAX_DECOMPRESSED = 128 * 1024 * 1024;
// Representative script probes, not a Unicode coverage census or shaping certification.
// Explicit Urdu/Persian-only letters, Hebrew niqqud and Arabic/Syriac vowel marks
// catch common fallback gaps. Ethiopic is an LTR non-regression probe.
export const FONT_SCRIPT_PROBES = [
  { language: 'he', direction: 'rtl', sampleText: 'שָׁלוֹם' },
  { language: 'ar', direction: 'rtl', sampleText: 'السَّلَامُ' },
  { language: 'fa', direction: 'rtl', sampleText: 'فارسی پ چ ژ گ' },
  { language: 'ur', direction: 'rtl', sampleText: 'اردو ٹ ڈ ڑ ں ے' },
  { language: 'syr', direction: 'rtl', sampleText: 'ܫܠܡܐ ܒܪܝܟܐ ܰ ܳ' },
  { language: 'am', direction: 'ltr', sampleText: 'ሰላም ኢትዮጵያ' },
  { language: 'en', direction: 'ltr', sampleText: 'ABC123' },
] as const;

export type FontAudit = {
  family: string;
  postscriptName: string;
  format: 'ttf' | 'otf' | 'ttc' | 'woff' | 'woff2';
  size: number;
  sha256: string;
  checkedCodepoints: number;
  missingCodepoints: Array<{ hex: string; character: string }>;
  /** Probe-only cmap coverage; this is not joining, mark positioning or MP4 evidence. */
  scriptSamples: Array<{
    language: (typeof FONT_SCRIPT_PROBES)[number]['language'];
    direction: 'rtl' | 'ltr';
    sampleText: string;
    checkedCodepoints: number;
    missingCodepoints: Array<{ hex: string; character: string }>;
    allProbeCodepointsPresent: boolean;
  }>;
  shapedGlyphCount: number | null;
  shapingError?: string;
};

function detectFormat(bytes: Buffer): FontAudit['format'] {
  const signature = bytes.toString('ascii', 0, 4);
  if (signature === 'wOF2' || signature === 'wOFF') {
    if (bytes.length < 20 || bytes.readUInt32BE(16) > MAX_DECOMPRESSED)
      throw new Error('INVALID_COMPRESSED_FONT_SIZE');
    return signature === 'wOF2' ? 'woff2' : 'woff';
  }
  if (signature === 'OTTO') return 'otf';
  if (signature === 'ttcf') return 'ttc';
  if (bytes.readUInt32BE(0) === 0x00010000 || signature === 'true') return 'ttf';
  throw new Error('UNSUPPORTED_FONT_SIGNATURE');
}

/** Count actual cmap-dependent characters, not Unicode control/format codepoints.
 * RTL embeddings, isolates, ZWJ/ZWNJ and directional marks have no glyph of
 * their own; combining vowel marks (Mn/Mc/Me) still require coverage.
 */
function coverageForText(font: { hasGlyphForCodePoint: (cp: number) => boolean }, text: string) {
  const unique = new Set(Array.from(text, ch => ch.codePointAt(0)!));
  const missingCodepoints: FontAudit['missingCodepoints'] = [];
  let checkedCodepoints = 0;
  for (const cp of unique) {
    if (/[\p{Cc}\p{Cf}]/u.test(String.fromCodePoint(cp))) continue;
    checkedCodepoints += 1;
    if (!font.hasGlyphForCodePoint(cp)) missingCodepoints.push({
      hex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
      character: String.fromCodePoint(cp),
    });
  }
  return { checkedCodepoints, missingCodepoints };
}

export async function auditFont(fontPath: string, text: string, runtimeRoot: string = process.cwd()): Promise<FontAudit> {
  if (!text) throw new Error('SUPPLY_REAL_TEXT');
  const bytes = await readFile(fontPath);
  if (!bytes.length || bytes.length > MAX_FONT_FILE) throw new Error('FONT_FILE_TOO_LARGE');
  const format = detectFormat(bytes);
  const require = createRequire(path.resolve(runtimeRoot, 'package.json'));
  const fontkit = require('fontkit') as { create: (bytes: Buffer) => any };
  const parsed = fontkit.create(bytes);
  const font = parsed.fonts?.[0] ?? parsed;
  const { checkedCodepoints, missingCodepoints } = coverageForText(font, text);
  const scriptSamples: FontAudit['scriptSamples'] = FONT_SCRIPT_PROBES.map(probe => {
    const coverage = coverageForText(font, probe.sampleText);
    return {
      ...probe,
      ...coverage,
      allProbeCodepointsPresent: coverage.missingCodepoints.length === 0,
    };
  });
  let shapedGlyphCount: number | null = null;
  let shapingError: string | undefined;
  try { shapedGlyphCount = font.layout(text).glyphs.length; }
  catch (error) { shapingError = error instanceof Error ? error.message : String(error); }
  return {
    family: font.getName?.('preferredFamily') || font.familyName || '(unnamed)',
    postscriptName: font.postscriptName || '(unnamed)',format,size:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),
    checkedCodepoints,missingCodepoints,scriptSamples,shapedGlyphCount,
    ...(shapingError ? {shapingError}:{}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [filename, text] = process.argv.slice(2);
  if (!filename || !text) throw new Error('Usage: rtl-font-audit.ts FONT-FILE SAMPLE-TEXT');
  console.log(JSON.stringify(await auditFont(path.resolve(filename), text), null, 2));
}
