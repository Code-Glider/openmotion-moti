import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
