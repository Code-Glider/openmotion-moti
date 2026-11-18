// Shared helpers for the OpenMotion holiday-sale Skills: sizes, themes, money, assets and the
// HyperFrames project writer. Each Skill ships its own copy so it installs on its own.
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const FPS = 30;
export const SIZES = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };

// Occasion palettes. A brand accent from the data replaces the theme accent.
export const THEMES = {
  'black-friday': { bg: '#0b0b0d', panel: '#18181c', ink: '#ffffff', sub: '#a3a3ad', accent: '#ff3b30', accentInk: '#ffffff' },
  'cyber-monday': { bg: '#070b24', panel: '#121a42', ink: '#f2f6ff', sub: '#93a0c8', accent: '#22d3ee', accentInk: '#04121a' },
  holiday: { bg: '#0f3b2c', panel: '#174b39', ink: '#fdf6e8', sub: '#b9cfc2', accent: '#e8453c', accentInk: '#ffffff' },
  'new-year': { bg: '#101012', panel: '#1d1b16', ink: '#fbf5e6', sub: '#b5ab93', accent: '#e2b44a', accentInk: '#16130a' },
  light: { bg: '#f5f5f2', panel: '#ffffff', ink: '#121214', sub: '#5d5d66', accent: '#e11d48', accentInk: '#ffffff' },
};
export const OCCASION_THEME = { 'black friday': 'black-friday', 'cyber monday': 'cyber-monday', christmas: 'holiday', holiday: 'holiday', 'new year': 'new-year' };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Display width in "Latin character" units; CJK counts double.
export const width = s => [...String(s ?? '')].reduce((n, ch) => n + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0);

export function money(value, currency = 'USD', locale = 'en-US') {
  const whole = Math.abs(value - Math.round(value)) < 0.005;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(value);
}
export const round2 = v => Math.round(v * 100) / 100;

// Resolve an offer's price fields into exact numbers. Exactly one of discount.percent,
// discount.amount or now may be given; everything shown on screen is derived from was.
export function price(item, where, errors) {
  const was = item.was;
  if (typeof was !== 'number' || !(was > 0)) { errors.push(`${where}.was must be a positive number`); return null; }
  const d = item.discount || {};
  const given = ['percent', 'amount'].filter(k => d[k] != null).length + (item.now != null ? 1 : 0);
  if (given !== 1) { errors.push(`${where} needs exactly one of discount.percent, discount.amount or now`); return null; }
  // Work in whole cents so rounding is exact; a percentage rounds half-cents up.
  const cents = v => Math.round(v * 100);
  const wasC = cents(was);
  let nowC;
  if (d.percent != null) {
    if (typeof d.percent !== 'number' || d.percent < 1 || d.percent > 95) { errors.push(`${where}.discount.percent must be 1-95`); return null; }
    nowC = Math.round(wasC * (100 - d.percent) / 100);
  } else if (d.amount != null) {
    if (typeof d.amount !== 'number' || d.amount <= 0) { errors.push(`${where}.discount.amount must be above 0 and below was`); return null; }
    nowC = wasC - cents(d.amount);
  } else {
    if (typeof item.now !== 'number') { errors.push(`${where}.now must be above 0 and below was`); return null; }
    nowC = cents(item.now);
  }
  // Check after rounding: what is shown must still be a real discount.
  if (!(nowC > 0 && nowC < wasC)) {
    errors.push(d.amount != null ? `${where}.discount.amount must be above 0 and below was` : d.percent != null ? `${where} rounds to no discount or a zero price` : `${where}.now must be above 0 and below was`);
    return null;
  }
  const percent = Math.round((1 - nowC / wasC) * 100);
  const saveC = wasC - nowC;
  // Headline framing: a percentage for higher prices, a flat amount for low prices, unless the data chose.
  const framing = d.amount != null ? 'amount' : d.percent != null ? 'percent' : (saveC < 1000 || percent < 10 ? 'amount' : 'percent');
  return { was: wasC / 100, now: nowC / 100, percent, save: saveC / 100, framing };
}

export const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-](\d{2}):(\d{2}))$/;
// A real calendar moment: rejects dates such as Feb 30 that Date.parse would silently roll over.
export function validISO(s) {
  const m = ISO.exec(String(s ?? ''));
  if (!m) return false;
  const [y, mo, d, h, mi, se = '0'] = m.slice(1, 7).map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d && h < 24 && mi < 60 && se < 60
    && (m[7] === 'Z' || (Number(m[8]) <= 14 && Number(m[9]) < 60));
}
export function parseDate(s) { if (!validISO(s)) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; }

export function theme(data) {
  const key = data.theme || OCCASION_THEME[String(data.occasion || '').toLowerCase()] || 'black-friday';
  const t = { ...(THEMES[key] || THEMES['black-friday']) };
  if (/^#[0-9a-f]{6}$/i.test(data.brand?.accent || '')) {
    t.accent = data.brand.accent;
    const v = t.accent.slice(1), [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    t.accentInk = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
  }
  return { key, ...t };
}

export function checkImage(file, baseDir, where, errors) {
  if (!file) return;
  if (!/\.(png|jpe?g|webp|svg)$/i.test(file)) errors.push(`${where} must be a png, jpg, webp or svg file`);
  else if (!existsSync(path.resolve(baseDir, file))) errors.push(`${where} "${file}" was not found next to the data file`);
}

// ---------- project writer ----------
export async function project({ here, out, inputDir, W, H, dur, title, lang = 'en', css, body, script, images = [] }) {
  await mkdir(path.join(out, 'compositions'), { recursive: true });
  await mkdir(path.join(out, 'assets', 'brand'), { recursive: true });
  await mkdir(path.join(out, 'assets', 'media'), { recursive: true });
  const require = createRequire(import.meta.url);
  const roots = [process.env.OPENMOTION_HOME, process.cwd(), here, path.resolve(here, '../../../..')].filter(Boolean);
  let gsap = null;
  for (const base of roots) { try { gsap = require.resolve('gsap/dist/gsap.min.js', { paths: [base] }); break; } catch {} }
  if (!gsap) throw new Error('GSAP was not found. Set OPENMOTION_HOME to your OpenMotion checkout, or run `npm install gsap` in the working directory.');
  await copyFile(gsap, path.join(out, 'assets', 'gsap.min.js'));
  for (const f of ['openmotion-logo.svg', 'loading-mark.svg']) await copyFile(path.join(here, '..', 'assets', 'brand', f), path.join(out, 'assets', 'brand', f));
  // Geist ships with OpenMotion (SIL OFL); without a checkout the film falls back to system sans.
  let fontCss = '';
  for (const base of roots) {
    const dir = path.join(base, 'library/components/showcase/glass-shard-title/assets/fonts');
    if (existsSync(path.join(dir, 'Geist-Bold.ttf'))) {
      await mkdir(path.join(out, 'assets', 'fonts'), { recursive: true });
      for (const [f, w] of [['Geist-Regular.ttf', 400], ['Geist-SemiBold.ttf', 600], ['Geist-Bold.ttf', 800]]) {
        await copyFile(path.join(dir, f), path.join(out, 'assets', 'fonts', f));
        fontCss += `@font-face{font-family:'Geist';src:url('assets/fonts/${f}') format('truetype');font-weight:${w};font-style:normal}`;
      }
      break;
    }
  }
  const copied = new Map();
  for (const rel of images) {
    if (!rel || copied.has(rel)) continue;
    const name = `assets/media/${copied.size + 1}-${path.basename(rel).replace(/[^\w.-]/g, '_')}`;
    await copyFile(path.resolve(inputDir, rel), path.join(out, name));
    copied.set(rel, name);
  }
  const src = rel => copied.get(rel) || '';
  const html = `<template>
<style>${fontCss}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:'Geist','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
#root *{box-sizing:border-box}
${css}</style>
<div id="root" data-composition-id="film" data-width="${W}" data-height="${H}">
${typeof body === 'function' ? body(src) : body}
</div>
<script>
(function(){
const tl = gsap.timeline({ paused: true });
${script}
window.__timelines["film"] = tl;
})();
</script>
</template>
`;
  const total = Math.round(dur * FPS) / FPS;
  await writeFile(path.join(out, 'compositions', 'film.html'), html);
  await writeFile(path.join(out, 'index.html'), `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <script src="assets/gsap.min.js"></script>
  <style>body{margin:0;background:#000}#main{position:relative;width:${W}px;height:${H}px;overflow:hidden}</style>
</head>
<body>
  <div id="main" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
    <div id="film" class="clip" data-composition-id="film" data-composition-src="compositions/film.html" data-start="0" data-duration="${total}" data-track-index="0" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines.main = gsap.timeline({ paused: true });
  </script>
</body>
</html>
`);
  return { total, src };
}

export async function readData(input) {
  return JSON.parse(await readFile(input, 'utf8'));
}

// "Made with OpenMotion" sign-off for the end card; the advertiser's brand stays the hero.
export function credit(t, size) {
  return `<div id="credit" style="position:absolute;left:0;right:0;bottom:${Math.round(size * 2.2)}px;display:flex;align-items:center;justify-content:center;gap:${Math.round(size * 0.6)}px;opacity:.72">
  <span style="font-size:${size}px;color:${t.sub};letter-spacing:.04em">Made with</span>
  <img src="assets/brand/openmotion-logo.svg" alt="OpenMotion" style="height:${Math.round(size * 1.5)}px;width:auto;filter:${t.key === 'light' ? 'none' : 'invert(1) grayscale(1) brightness(1.6)'}">
</div>`;
}
