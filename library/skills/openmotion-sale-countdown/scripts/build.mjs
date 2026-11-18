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
import { SIZES, esc, width, theme, project, readData, credit, parseDate, validISO, fit, tape, badge, checkImage } from './film.mjs';

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
const images = data.images || [];
if (!Array.isArray(images) || images.length > 4) errors.push('images must be a list of up to 4 photos');
else images.forEach((im, i) => checkImage(im, inputDir, `images[${i}]`, errors));
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
// The photos (if any) fill the frame and change on each flip; a sale tape scrolls and a badge
// spins for the whole film; the number itself is giant display type rolling through a mask.
const [W, H] = SIZES[aspect];
const t = theme(data);
const wide = W > H, portrait = H / W > 1.5;
const u = Math.min(W, H) / 1080;
const px = n => Math.round(n * u);
const B = { kick: 0, roll: 1.2, date: 5.2, cta: 7.5, end: 9.6 };
const start = Math.min(99, value + Math.max(4, Math.min(9, Math.ceil(value * 0.6))));
const steps = []; for (let v = start; v >= value; v--) steps.push(v);
const numSize = Math.min(fit(String(start), wide ? W * 0.42 : W * 0.8, px(wide ? 640 : 760), 0.55), Math.round(H * (portrait ? 0.4 : wide ? 0.36 : 0.3)));
const occSize = fit(String(data.occasion), wide ? W * 0.8 : W * 0.88, px(wide ? 140 : 200), 0.5);
const teaserSize = data.teaser ? fit(data.teaser, W * 0.86, px(wide ? 150 : 170), 0.5) : 0;
const shade = `rgba(${t.shade},`;
const tapeText = `${data.occasion} · ${L[mode]} ${value} ${L[unit]}`;
const css = `
#bg{position:absolute;inset:0;background:radial-gradient(110% 80% at 60% 25%,${t.panel} 0,${t.bg} 70%)}
.ph{position:absolute;inset:0;background:${t.bg} center/cover no-repeat;transform-origin:50% 40%}
#shade{position:absolute;inset:0;background:linear-gradient(180deg,${shade}.7) 0,${shade}.25) 40%,${shade}.55) 70%,${shade}.92) 100%)}
.brand{position:absolute;top:${px(54)}px;left:${px(54)}px;font-weight:600;font-size:${px(30)}px;letter-spacing:.22em;text-transform:uppercase;color:${t.ink}}
.mask{overflow:hidden}
.cta{display:inline-block;background:${t.ink};color:${t.bg};font-weight:700;font-size:${px(64)}px;padding:${px(26)}px ${px(64)}px;border-radius:${px(999)}px}`;
const rowH = Math.round(numSize * 1.05);
const reel = steps.map(v => `<div class="d" style="height:${rowH}px;line-height:${rowH}px">${v}</div>`).join('');
const top = wide ? H * 0.06 : H * 0.12;
const body = src => `<div id="bg"></div>
${images.map((im, i) => `<div id="ph${i}" class="ph" style="background-image:url('${src(im)}')"></div>`).join('')}
<div id="shade"></div><div class="grain" id="grain"></div>
<div class="brand">${esc(data.brand.name)}</div>
<div id="cnt" style="position:absolute;left:0;right:0;top:${top}px;text-align:center;color:${t.ink}">
  <div class="mask" style="height:${Math.round(occSize * 0.92)}px"><div id="occ" class="d" style="font-size:${occSize}px;white-space:nowrap">${esc(data.occasion)}</div></div>
  <div id="kick" style="margin-top:${px(18)}px;font-size:${px(40)}px;letter-spacing:.3em;text-transform:uppercase;font-weight:600;color:${t.ink};opacity:.85">${esc(L[mode])}</div>
  <div class="mask" style="height:${rowH}px;margin-top:${px(4)}px;position:relative">
    <div id="reel" style="font-size:${numSize}px;color:${t.ink}">${reel}</div>
  </div>
  <div class="mask" style="height:${px(150)}px;margin-top:${px(6)}px"><div id="unit" class="d" style="display:inline-block;font-size:${px(118)}px;line-height:1.1;padding:0 ${px(26)}px;background:${t.accent};color:${t.accentInk}">${esc(L[unit])} ${esc(L.left)}</div></div>
</div>
<div id="dt" style="opacity:0;position:absolute;left:0;right:0;top:${wide ? H * 0.22 : H * 0.3}px;text-align:center;color:${t.ink}">
  <div id="date" style="font-size:${px(54)}px;font-weight:600;letter-spacing:.04em;opacity:0">${esc(data.target.label)}</div>
  ${data.teaser ? `<div class="mask" style="height:${Math.round(teaserSize * 1.9)}px;margin-top:${px(30)}px"><div id="teaser" class="d" style="font-size:${teaserSize}px;color:${t.ink};line-height:.95;padding:0 ${px(40)}px">${esc(data.teaser)}</div></div>` : ''}
  <div id="cta" class="cta" style="margin-top:${px(50)}px;opacity:0">${esc(data.cta)}</div>
  ${data.url ? `<div id="url" style="margin-top:${px(24)}px;font-size:${px(40)}px;font-weight:600;opacity:0">${esc(data.url)}</div>` : ''}
</div>
${tape('tape', tapeText, t, W, H, { y: portrait ? 0.9 : 0.88, size: px(wide ? 56 : 62) })}
<div id="badgewrap" style="position:absolute;left:${W * 0.05}px;top:${H * (portrait ? 0.7 : 0.52)}px;width:${px(230)}px;height:${px(230)}px;opacity:0">${badge('bdg', `${data.occasion} • ${data.target.label} • `, t, px(230))}</div>
${noCredit ? '' : credit(t, px(26)).replace('opacity:.72', 'opacity:0').replace(/bottom:\d+px/, `bottom:${Math.round(H * (portrait ? 0.15 : 0.17))}px`)}`;

const f = v => v.toFixed(2);
const stepDur = (B.date - 1.0 - B.roll) / Math.max(1, steps.length - 1);
const rH = rowH;
let rollJs = '', swapJs = '';
steps.forEach((_, i) => { if (i) rollJs += `tl.to('#reel',{y:${-i * rH},duration:${f(Math.min(0.3, stepDur * 0.8))},ease:'power3.inOut'},${f(B.roll + 0.3 + (i - 1) * stepDur)});\n`; });
// Photos change in step with the roll, each one wiping up over the last.
images.forEach((_, i) => {
  const at = i === 0 ? 0 : B.roll + 0.3 + (i * (steps.length - 1) / images.length) * stepDur;
  swapJs += i === 0 ? `tl.set('#ph0',{clipPath:'inset(0% 0% 0% 0%)'},0);\n` : `tl.fromTo('#ph${i}',{clipPath:'inset(100% 0% 0% 0%)'},{clipPath:'inset(0% 0% 0% 0%)',duration:.45,ease:'power3.inOut'},${f(at)});\n`;
  swapJs += `tl.fromTo('#ph${i}',{scale:1.18},{scale:1.02,duration:${f(B.end - at)},ease:'none'},${f(at)});\n`;
});
const script = `
${swapJs}tl.fromTo('#grain',{x:0,y:0},{x:-40,y:30,duration:${f(B.end)},ease:'steps(${Math.round(B.end * 12)})'},0);
tl.fromTo('#tape',{xPercent:-30,opacity:0},{xPercent:0,opacity:1,duration:.5,ease:'power3.out'},0.3);
tl.fromTo('#tape-run',{xPercent:0},{xPercent:-50,duration:${f(B.end + 4)},ease:'none'},0);
tl.fromTo('#bdg',{rotation:0},{rotation:${Math.round(B.end * 24)},transformOrigin:'50% 50%',duration:${f(B.end)},ease:'none'},0);
tl.fromTo('#badgewrap',{opacity:0,scale:.6},{opacity:1,scale:1,duration:.4,ease:'back.out(1.8)'},0.8);
tl.fromTo('#occ',{yPercent:105},{yPercent:0,duration:.55,ease:'power4.out'},0.1);
tl.fromTo('#kick',{opacity:0,y:20},{opacity:.85,y:0,duration:.5,ease:'power3.out'},0.4);
tl.fromTo('#reel',{yPercent:0,opacity:0},{opacity:1,duration:.3},${f(B.roll)});
${rollJs}tl.fromTo('#unit',{yPercent:125},{yPercent:0,duration:.45,ease:'power4.out'},${f(B.roll + 0.4)});
tl.fromTo('#cnt',{scale:1},{scale:1.08,duration:.15,yoyo:true,repeat:1,transformOrigin:'50% 50%'},${f(B.date - 0.95)});
tl.to('#cnt',{yPercent:-12,opacity:0,duration:.4,ease:'power3.in'},${f(B.date - 0.3)});
tl.set('#dt',{opacity:1},${f(B.date - 0.01)});
tl.fromTo('#date',{opacity:0,y:${px(30)}},{opacity:1,y:0,duration:.4,ease:'power3.out'},${f(B.date)});
${data.teaser ? `tl.fromTo('#teaser',{yPercent:105},{yPercent:0,duration:.55,ease:'power4.out'},${f(B.date + 0.3)});` : ''}
tl.fromTo('#cta',{opacity:0,scale:.6},{opacity:1,scale:1,duration:.4,ease:'back.out(2)'},${f(B.cta)});
${data.url ? `tl.fromTo('#url',{opacity:0},{opacity:.85,duration:.3},${f(B.cta + 0.2)});` : ''}
${noCredit ? '' : `tl.fromTo('#credit',{opacity:0},{opacity:.75,duration:.4},${f(B.cta + 0.4)});`}
tl.set({}, {}, ${f(B.end)});`;

const out = path.resolve(outDir);
const { total } = await project({ here, out, inputDir, W, H, dur: B.end, title: `${data.brand.name} · ${data.occasion} countdown`, css, body, script, images });
await writeFile(path.join(out, 'countdown.json'), JSON.stringify({ ...data, aspect, computed: { value, unit, from: start } }, null, 2));
console.log(`✓ ${data.brand.name}: ${data.occasion} ${L[mode]} ${value} ${L[unit]}, ${aspect}, ${total.toFixed(1)} s → ${out}`);
