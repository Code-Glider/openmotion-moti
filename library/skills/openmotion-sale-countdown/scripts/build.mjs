#!/usr/bin/env node
// Generate an editable HyperFrames sale countdown teaser from countdown.json.
// The number on screen is computed from postAt and the target time, so the teaser is true
// on the day it is posted.
// Usage:
//   node scripts/build.mjs --check countdown.json
//   node scripts/build.mjs countdown.json out/ [--aspect 9:16|4:5|1:1|16:9] [--no-credit]
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SIZES, esc, width, theme, project, readData, credit, parseDate, validISO } from './film.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const checkOnly = bool('--check');
const noCredit = bool('--no-credit');
const aspectArg = flag('--aspect');
const [input, outDir] = args;
if (!input || (!checkOnly && !outDir)) { console.error('Usage: node scripts/build.mjs [--check] countdown.json [out/] [--aspect 9:16] [--no-credit]'); process.exit(2); }
const inputDir = path.dirname(path.resolve(input));
const data = await readData(input);

// ---------- validation ----------
const errors = [];
const aspect = aspectArg || data.aspect || '9:16';
if (!SIZES[aspect]) errors.push(`aspect must be one of ${Object.keys(SIZES).join(', ')}`);
if (!data.brand?.name) errors.push('brand.name is required');
else if (width(data.brand.name) > 24) errors.push(`brand.name "${data.brand.name}" is longer than 24 characters`);
if (!data.occasion) errors.push('occasion is required (e.g. "Black Friday")');
else if (width(data.occasion) > 18) errors.push(`occasion "${data.occasion}" is longer than 18 characters`);
const mode = data.mode || 'starts';
if (!['starts', 'ends'].includes(mode)) errors.push('mode must be "starts" (counting down to the sale) or "ends" (last hours of the sale)');
if (!validISO(data.postAt || '')) errors.push('postAt is required: the ISO date-time with offset when the video goes live, e.g. 2026-11-20T09:00:00-05:00');
if (!validISO(data.target?.date || '')) errors.push('target.date must be an ISO date-time with an offset: when the sale starts (mode starts) or ends (mode ends)');
if (!data.target?.label) errors.push('target.label is required, e.g. "Fri, Nov 27 · 12:00 am ET"');
else if (width(data.target.label) > 34) errors.push(`target.label is ${width(data.target.label)} characters; keep it under 34`);
let unit = null, value = null;
if (validISO(data.postAt || '') && validISO(data.target?.date || '')) {
  const ms = parseDate(data.target.date) - parseDate(data.postAt);
  if (ms <= 0) errors.push('target.date must be after postAt');
  else {
    // Whole units remaining, rounded down so the claim is never overstated.
    const hours = Math.floor(ms / 36e5), days = Math.floor(ms / 864e5);
    unit = data.unit || (days >= 2 ? 'days' : 'hours');
    if (!['days', 'hours'].includes(unit)) errors.push('unit must be "days" or "hours"');
    value = unit === 'days' ? days : hours;
    if (value < 1) errors.push(`less than one ${unit === 'days' ? 'day' : 'hour'} is left between postAt and target.date; use unit "hours" or post earlier`);
    if (value > 99) errors.push(`${value} ${unit} is too far out for a countdown; post closer to the date`);
  }
}
if (data.teaser && width(data.teaser) > 30) errors.push(`teaser is ${width(data.teaser)} characters; keep it under 30`);
if (!data.cta) errors.push('cta is required, e.g. "Get early access"');
else if (width(data.cta) > 20) errors.push(`cta "${data.cta}" is longer than 20 characters`);
if (data.url && width(data.url) > 32) errors.push(`url "${data.url}" is longer than 32 characters`);
if (errors.length) { console.error(errors.map(e => '✗ ' + e).join('\n')); process.exit(1); }
const L = {
  starts: 'starts in', ends: 'ends in', days: value === 1 ? 'day' : 'days', hours: value === 1 ? 'hour' : 'hours',
  left: mode === 'ends' ? 'left' : 'to go', ...(data.labels || {}),
};
if (checkOnly) { console.log(`✓ ${data.brand.name}: ${data.occasion} ${L[mode]} ${value} ${L[unit]} (posted ${data.postAt}), ${aspect}`); process.exit(0); }

// ---------- layout ----------
const [W, H] = SIZES[aspect];
const t = theme(data);
const wide = W > H;
const portrait = H / W > 1.5;
const u = Math.min(W, H) / 1080;
const px = n => Math.round(n * u);
// Beats: kicker → digits roll down to the true value → date + teaser → call to action.
const B = { kick: 0, roll: 1.3, date: 5.2, cta: 7.6, end: 9.6 };
const start = Math.min(99, value + Math.max(4, Math.min(9, Math.ceil(value * 0.6))));
const steps = []; for (let v = start; v >= value; v--) steps.push(v);
const digits = String(value).length < 2 && start < 10 ? 1 : 2;
const dH = px(portrait ? 470 : 340), dW = Math.round(dH * 0.64);
const occ = String(data.occasion).toUpperCase();

const css = `
#bg{position:absolute;inset:0;background:${t.bg}}
#glow{position:absolute;left:50%;top:44%;width:${px(1300)}px;height:${px(1300)}px;margin:${-px(650)}px 0 0 ${-px(650)}px;border-radius:50%;background:radial-gradient(circle,${t.accent}33 0,transparent 62%);opacity:0}
.beat{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:${t.ink}}
.brand{position:absolute;top:${px(70)}px;left:0;right:0;text-align:center;font-weight:600;font-size:${px(34)}px;letter-spacing:.18em;text-transform:uppercase;color:${t.ink};opacity:.9}
.occ{font-weight:800;font-size:${Math.min(px(portrait ? 190 : 140), Math.round(W * 0.86 / (0.6 * occ.length)))}px;letter-spacing:-.03em;line-height:.9}
.kick{font-size:${px(56)}px;color:${t.sub};font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-top:${px(26)}px}
.board{display:flex;gap:${px(18)}px;margin-top:${px(60)}px}
.cell{position:relative;width:${dW}px;height:${dH}px;border-radius:${px(28)}px;background:${t.panel};overflow:hidden;box-shadow:inset 0 0 0 ${px(3)}px ${t.accent}55}
.cell:after{content:'';position:absolute;left:0;right:0;top:50%;height:${px(4)}px;background:${t.bg};opacity:.8}
.reel{position:absolute;left:0;right:0;top:0}
.reel div{height:${dH}px;line-height:${dH}px;font-weight:800;font-size:${Math.round(dH * 0.78)}px;color:${t.ink};letter-spacing:-.04em}
.unit{margin-top:${px(40)}px;font-weight:800;font-size:${px(96)}px;color:${t.accent};letter-spacing:.04em;text-transform:uppercase}
.date{font-weight:700;font-size:${px(66)}px;line-height:1.15;max-width:${Math.round(W * 0.86)}px}
.teaser{margin-top:${px(44)}px;font-weight:800;font-size:${px(104)}px;line-height:1;letter-spacing:-.03em;color:${t.accent};max-width:${Math.round(W * 0.9)}px}
.cta{font-weight:800;font-size:${px(84)}px;background:${t.accent};color:${t.accentInk};padding:${px(32)}px ${px(76)}px;border-radius:${px(999)}px}
.url{margin-top:${px(40)}px;font-size:${px(48)}px;color:${t.sub};font-weight:600}`;

// Each digit is a vertical reel; the timeline moves reels, so every frame is deterministic.
const digitAt = (v, i) => String(v).padStart(digits, '0')[i];
const reels = Array.from({ length: digits }, (_, i) => `<div class="cell"><div id="reel${i}" class="reel">${steps.map(v => `<div>${digitAt(v, i)}</div>`).join('')}</div></div>`).join('');
const body = `<div id="bg"></div><div id="glow"></div>
<div class="brand">${esc(data.brand.name)}</div>
<div id="b-count" class="beat">
  <div id="occ" class="occ">${esc(occ)}</div>
  <div id="kick" class="kick">${esc(L[mode])}</div>
  <div id="board" class="board">${reels}</div>
  <div id="unit" class="unit">${esc(L[unit])} ${esc(L.left)}</div>
</div>
<div id="b-date" class="beat" style="opacity:0"><div id="date" class="date">${esc(data.target.label)}</div>${data.teaser ? `<div id="teaser" class="teaser">${esc(data.teaser)}</div>` : ''}</div>
<div id="b-cta" class="beat" style="opacity:0"><div id="cta" class="cta">${esc(data.cta)}</div>${data.url ? `<div class="url">${esc(data.url)}</div>` : ''}${noCredit ? '' : credit(t, px(30))}</div>`;

const f = v => v.toFixed(2);
const stepDur = (B.date - 0.9 - B.roll) / Math.max(1, steps.length - 1);
let rollJs = '';
steps.forEach((v, k) => {
  if (!k) return;
  const at = B.roll + 0.4 + (k - 1) * stepDur;
  for (let i = 0; i < digits; i++) {
    if (digitAt(v, i) === digitAt(steps[k - 1], i)) continue;
    rollJs += `tl.to('#reel${i}',{y:${-k * dH},duration:${f(Math.min(0.32, stepDur * 0.8))},ease:'power3.inOut'},${f(at)});\n`;
  }
});
const script = `
tl.fromTo('#occ',{scale:1.5,opacity:0},{scale:1,opacity:1,duration:.35,ease:'power4.out'},${f(B.kick + 0.05)});
tl.fromTo('#kick',{y:${px(30)},opacity:0},{y:0,opacity:1,duration:.3},${f(B.kick + 0.35)});
tl.fromTo('#board',{y:${px(60)},opacity:0},{y:0,opacity:1,duration:.4,ease:'power3.out'},${f(B.roll)});
${rollJs}tl.fromTo('#unit',{opacity:0},{opacity:1,duration:.3},${f(B.roll + 0.3)});
tl.fromTo('#glow',{opacity:0,scale:.7},{opacity:1,scale:1.05,duration:.5,ease:'power2.out'},${f(B.date - 0.9)});
tl.fromTo('#board',{scale:1},{scale:1.08,duration:.14,yoyo:true,repeat:1},${f(B.date - 0.9)});
tl.to('#b-count',{opacity:0,duration:.2},${f(B.date - 0.2)});
tl.fromTo('#b-date',{opacity:0},{opacity:1,duration:.2},${f(B.date)});
tl.fromTo('#date',{y:${px(40)},opacity:0},{y:0,opacity:1,duration:.35,ease:'power3.out'},${f(B.date + 0.05)});
${data.teaser ? `tl.fromTo('#teaser',{scale:.8,opacity:0},{scale:1,opacity:1,duration:.35,ease:'back.out(1.7)'},${f(B.date + 0.45)});` : ''}
tl.to('#b-date',{opacity:0,duration:.2},${f(B.cta - 0.2)});
tl.fromTo('#b-cta',{opacity:0},{opacity:1,duration:.2},${f(B.cta)});
tl.fromTo('#cta',{scale:.7,opacity:0},{scale:1,opacity:1,duration:.35,ease:'back.out(1.8)'},${f(B.cta + 0.05)});
tl.set({}, {}, ${f(B.end)});`;

const out = path.resolve(outDir);
const { total } = await project({ here, out, inputDir, W, H, dur: B.end, title: `${data.brand.name} · ${data.occasion} countdown`, css, body, script });
await writeFile(path.join(out, 'countdown.json'), JSON.stringify({ ...data, aspect, computed: { value, unit, from: start } }, null, 2));
console.log(`✓ ${data.brand.name}: ${data.occasion} ${L[mode]} ${value} ${L[unit]}, ${aspect}, ${total.toFixed(1)} s → ${out}`);
