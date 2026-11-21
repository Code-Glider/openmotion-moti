// Pinned, licensed Chromium qualification faces. Never use mutable /main URLs
// or treat a missing download as a passing browser rendering check.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GOOGLE_FONTS_COMMIT = '06bfe0d62a98375cb09c942fa18e68bd32cff057';
const pins = [
  { id: 'hebrew', lang: 'he', directory: 'notosanshebrew', filename: 'NotoSansHebrew[wdth,wght].ttf', blob: 'f31f73b8be8086692ff0156544f80975640e5a42', licenseBlob: '56662b6243717dbe8acee6d87c3f0e795f9c4295' },
  { id: 'arabic', lang: 'ar', directory: 'notonaskharabic', filename: 'NotoNaskhArabic[wght].ttf', blob: 'a8d2867262dc7bb28492ad746de5d56235735c8b', licenseBlob: 'd4e170557fc8bcf8d1dcb317d9f1accaf8acf223' },
  { id: 'urdu', lang: 'ur', directory: 'notonastaliqurdu', filename: 'NotoNastaliqUrdu[wght].ttf', blob: '896bb7953039c81192d4b62a6968cae1a52bfc52', licenseBlob: '38833b0693a30ee6820edc3bf807ba7c0ab8804a' },
  { id: 'syriac', lang: 'syr', directory: 'notosanssyriac', filename: 'NotoSansSyriac[wght].ttf', blob: 'ca4a46b400e7b3615006d727fd6052680aa40ee4', licenseBlob: '4b0064f9c08cab737605f7363ebf1b53e8c5c3dc' },
  { id: 'ethiopic', lang: 'am', directory: 'notosansethiopic', filename: 'NotoSansEthiopic[wdth,wght].ttf', blob: '0910ed80aac7398582c515225304623a60d6f35a', licenseBlob: '23e1a135d51a4bfba0ef048fba7f3bce61465475' },
];
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function gitBlob(bytes) { return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'); }
async function verifiedDownload(directory, name, expectedBlob) {
  const url = 'https://raw.githubusercontent.com/google/fonts/' + GOOGLE_FONTS_COMMIT + '/ofl/' + directory + '/' + encodeURIComponent(name);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(40_000) });
      if (!response.ok) throw new Error('PINNED_FONT_HTTP_' + response.status + ': ' + url);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (gitBlob(bytes) !== expectedBlob) throw new Error('PINNED_FONT_INTEGRITY_MISMATCH: ' + directory + '/' + name);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}
async function main() {
  const destination = process.argv[2];
  if (!destination || !path.isAbsolute(destination)) throw new Error('Usage: node scripts/rtl-reference-fonts.mjs ABSOLUTE_NEW_OUTPUT_DIRECTORY');
  await mkdir(destination, { recursive: true });
  const evidence = [];
  for (const pin of pins) {
    const [font, license] = await Promise.all([
      verifiedDownload(pin.directory, pin.filename, pin.blob),
      verifiedDownload(pin.directory, 'OFL.txt', pin.licenseBlob),
    ]);
    const file = pin.id + '.ttf';
    const licenseFile = pin.id + '.OFL.txt';
    await writeFile(path.join(destination, file), font, { flag: 'wx' });
    await writeFile(path.join(destination, licenseFile), license, { flag: 'wx' });
    evidence.push({ id: pin.id, lang: pin.lang, filename: file, licenseFilename: licenseFile,
      source: 'google/fonts/ofl/' + pin.directory + '/' + pin.filename,
      fontGitBlob: pin.blob, licenseGitBlob: pin.licenseBlob,
      fontSha256: sha256(font), licenseSha256: sha256(license), bytes: font.length });
  }
  const manifest = { sourceRepository: 'google/fonts', sourceCommit: GOOGLE_FONTS_COMMIT, faces: evidence,
    limitation: 'Reference font files and OFL licenses are ephemeral CI inputs, not installed OpenMotion project assets.' };
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ sourceCommit: GOOGLE_FONTS_COMMIT, pinnedFamilies: evidence.map(row => row.id), verifiedFiles: evidence.length * 2 }));
}
await main();
