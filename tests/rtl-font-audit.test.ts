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
