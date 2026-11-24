// Pinned, licensed Chromium qualification faces. Never use mutable /main URLs
// or treat a missing download as a passing browser rendering check.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GOOGLE_FONTS_COMMIT = '06bfe0d62a98375cb09c942fa18e68bd32cff057';
const pins = [
  { id: 'hebrew', lang: 'he', directory: 'notosanshebrew', filename: 'NotoSansHebrew[wdth,wght].ttf', blob: 'f31f73b8be8086692ff0156544f80975640e5a42', licenseBlob: '56662b6243717dbe8acee6d87c3f0e795f9c4295' },
  { id: 'arabic', lang: 'ar', directory: 'notonaskharabic', filename: 'NotoNaskhArabic[wght].ttf', blob: 'a8d2867262dc7bb28492ad746de5d56235735c8b', licenseBlob: 'd4e170557fc8bcf8d1dcb317d9f1accaf8acf223' },
  { id: 'urdu', lang: 'ur', directory: 'notosansarabic', filename: 'NotoSansArabic[wdth,wght].ttf', blob: 'f1d01edce4ebaedcbe9a06fc75fec07b304ec3df', licenseBlob: '14c589f6384505ede3f8e52627d397513af3662d' },
  { id: 'syriac', lang: 'syr', directory: 'notosanssyriac', filename: 'NotoSansSyriac[wght].ttf', blob: 'ca4a46b400e7b3615006d727fd6052680aa40ee4', licenseBlob: '4b0064f9c08cab737605f7363ebf1b53e8c5c3dc' },
  { id: 'ethiopic', lang: 'am', directory: 'notosansethiopic', filename: 'NotoSansEthiopic[wdth,wght].ttf', blob: '0910ed80aac7398582c515225304623a60d6f35a', licenseBlob: '23e1a135d51a4bfba0ef048fba7f3bce61465475' },
];
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function gitBlob(bytes) { return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'); }
// Retry availability failures only; an integrity mismatch is never retried.
const retryDelays = [2_000, 8_000, 25_000];
const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);
export async function verifiedDownload(directory, name, expectedBlob, {
  request = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onRetry = ({ attempt, error, delay }) => console.warn('Pinned font download retry ' + attempt + ' after ' + delay + 'ms: ' + error.message),
} = {}) {
  const url = 'https://raw.githubusercontent.com/google/fonts/' + GOOGLE_FONTS_COMMIT + '/ofl/' + directory + '/' + encodeURIComponent(name);
  for (let attempt = 0; ; attempt++) {
    let response, bytes, error;
    try {
      response = await request(url, { signal: AbortSignal.timeout(40_000) });
      if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
    } catch (failure) {
      if (!(failure instanceof TypeError) && !['TimeoutError', 'AbortError'].includes(failure?.name)) throw failure;
      error = failure;
    }
    if (!error) {
      if (response.ok) {
        if (gitBlob(bytes) !== expectedBlob) throw new Error('PINNED_FONT_INTEGRITY_MISMATCH: ' + directory + '/' + name);
        return bytes;
      }
      error = new Error('PINNED_FONT_HTTP_' + response.status + ': ' + url);
      if (response.body) await response.body.cancel().catch(() => {});
      if (!retryStatuses.has(response.status)) throw error;
    }
    if (attempt >= retryDelays.length) throw error;
    const delay = retryDelays[attempt];
    onRetry({ attempt: attempt + 1, error, delay });
    await sleep(delay);
  }
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
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
