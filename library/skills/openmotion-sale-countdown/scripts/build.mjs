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
// A timer, not a poster: a wall of scrolling type behind, a dial whose ring drains as the number
// rolls down, and the product photos as a stack of cards that deal in one after another.
const [W, H] = SIZES[aspect];
const t = theme(data);
const wide = W > H, portrait = H / W > 1.5;
const u = Math.min(W, H) / 1080;
const px = n => Math.round(n * u);
const B = { kick: 0, roll: 1.2, date: 5.2, cta: 7.5, end: 9.6 };
const start = Math.min(99, value + Math.max(4, Math.min(9, Math.ceil(value * 0.6))));
const steps = []; for (let v = start; v >= value; v--) steps.push(v);
const D = Math.round(Math.min(W, H) * (portrait ? 0.74 : 0.56));            // dial diameter
const dialX = wide ? W * 0.62 : W / 2, dialY = wide ? H * 0.56 : portrait ? H * 0.47 : H * 0.58;
const numSize = Math.min(fit(String(start), D * 0.62, px(520), 0.55), Math.round(D * 0.42));
const rowH = Math.round(numSize * 1.3);
const occSize = fit(String(data.occasion), wide ? W * 0.9 : W * 0.88, px(wide ? 120 : 150), 0.57);
const teaserSize = data.teaser ? fit(data.teaser, W * 0.8, px(wide ? 120 : 130), 0.57) : 0;
const wallSize = px(wide ? 120 : 140);
const wallText = `${data.occasion} · ${L[mode]} · `.toUpperCase().repeat(6);
const cardW = Math.round(Math.min(W, H) * (portrait ? 0.46 : 0.36)), cardH = Math.round(cardW * 1.3);
const R = D / 2 - px(14), C = 2 * Math.PI * R;
const css = `
#bg{position:absolute;inset:0;background:${t.bg}}
.row{position:absolute;left:0;white-space:nowrap;font-size:${wallSize}px;color:transparent;-webkit-text-stroke:${px(2)}px ${t.ink};opacity:.16}
.row.hot{color:${t.accent};-webkit-text-stroke:0;opacity:.9}
.card{position:absolute;width:${cardW}px;height:${cardH}px;border-radius:${px(22)}px;background:${t.panel} center/cover no-repeat;box-shadow:0 ${px(24)}px ${px(60)}px rgba(0,0,0,.45);border:${px(8)}px solid ${t.ink}}
.mask{overflow:hidden}
.brand{position:absolute;top:${px(54)}px;left:${px(54)}px;font-weight:600;font-size:${px(30)}px;letter-spacing:.22em;text-transform:uppercase;color:${t.ink}}
.ticket{display:inline-block;background:${t.ink};color:${t.bg};border-radius:${px(30)}px;padding:${px(48)}px ${px(70)}px;position:relative;max-width:${Math.round(W * 0.86)}px}
.ticket:before,.ticket:after{content:'';position:absolute;top:50%;width:${px(44)}px;height:${px(44)}px;margin-top:${-px(22)}px;border-radius:50%;background:${t.bg}}
.ticket:before{left:${-px(22)}px}.ticket:after{right:${-px(22)}px}
.cta{display:inline-block;background:${t.accent};color:${t.accentInk};font-weight:700;font-size:${px(52)}px;padding:${px(22)}px ${px(54)}px;border-radius:${px(999)}px;white-space:nowrap}`;
const rows = Math.ceil(H / (wallSize * 0.95)) + 1;
const hotRow = Math.floor(rows * (portrait ? 0.82 : 0.86));
const wall = Array.from({ length: rows }, (_, i) => `<div id="w${i}" class="row d${i === hotRow ? ' hot' : ''}" style="top:${Math.round(i * wallSize * 0.95)}px">${esc(wallText)}${esc(wallText)}</div>`).join('');
const spots = wide ? [[0.06, 0.2, -8], [0.2, 0.26, 6], [0.1, 0.4, -3], [0.24, 0.12, 9]] : portrait ? [[0.04, 0.6, -9], [0.52, 0.63, 8], [0.08, 0.08, 7], [0.55, 0.1, -6]] : [[0.02, 0.5, -9], [0.66, 0.48, 8], [0.03, 0.06, 6], [0.66, 0.08, -7]];
const reel = steps.map(v => `<div class="d" style="height:${rowH}px;line-height:${rowH}px">${v}</div>`).join('');
const body = src => `<div id="bg"></div>${wall}
${images.map((im, i) => { const [x, y, r] = spots[i % spots.length]; return `<div id="cd${i}" class="card" style="left:${Math.round(W * x)}px;top:${Math.round(H * y)}px;background-image:url('${src(im)}');opacity:0"></div>`; }).join('')}
<div class="grain" id="grain"></div>
<div class="brand">${esc(data.brand.name)}</div>
<div id="head" style="position:absolute;left:${wide ? W * 0.04 : 0}px;right:${wide ? W * 0.44 : 0}px;top:${Math.max(px(110), wide ? H * 0.08 : H * 0.07)}px;text-align:${wide ? 'left' : 'center'};color:${t.ink}">
  <div class="mask" style="height:${Math.round(occSize * 0.92)}px"><div id="occ" class="d" style="font-size:${occSize}px;white-space:nowrap">${esc(data.occasion)}</div></div>
</div>
<div id="dial" style="position:absolute;left:${Math.round(dialX - D / 2)}px;top:${Math.round(dialY - D / 2)}px;width:${D}px;height:${D}px;border-radius:50%;background:${t.bg};box-shadow:0 ${px(30)}px ${px(90)}px rgba(0,0,0,.5)">
  <svg width="${D}" height="${D}" style="position:absolute;inset:0;transform:rotate(-90deg)"><circle cx="${D / 2}" cy="${D / 2}" r="${R}" fill="none" stroke="${t.ink}" stroke-opacity=".14" stroke-width="${px(18)}"/>
  <circle id="arc" cx="${D / 2}" cy="${D / 2}" r="${R}" fill="none" stroke="${t.accent}" stroke-width="${px(18)}" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0"/></svg>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${t.ink}">
    <div id="kick" style="font-size:${px(34)}px;letter-spacing:.3em;text-transform:uppercase;font-weight:600;opacity:.8">${esc(L[mode])}</div>
    <div class="mask" style="height:${rowH}px;margin-top:${px(4)}px"><div id="reel" style="font-size:${numSize}px;text-align:center">${reel}</div></div>
    <div id="unit" class="d" style="font-size:${Math.min(px(64), Math.round(D * 0.085))}px;color:${t.accent};margin-top:${px(2)}px">${esc(L[unit])} ${esc(L.left)}</div>
  </div>
</div>
${(() => {
  // End: the type wall dims, the hero photo returns large, and the date, offer and button sit beside it.
  const hero = images[images.length - 1];
  const side = hero && !portrait;
  const headBottom = Math.max(px(110), wide ? H * 0.08 : H * 0.07) + occSize * 0.92 + px(34);
  const hx = side ? W * 0.06 : W * 0.15, hy = headBottom, hw = side ? W * (wide ? 0.34 : 0.42) : W * 0.7, hh = side ? H * 0.92 - headBottom : H * 0.4;
  const tx = side ? hx + hw + W * 0.05 : W * 0.08, ty = side ? headBottom + px(20) : hero ? headBottom + hh + px(50) : H * 0.3, tw = side ? W - tx - W * 0.06 : W * 0.84;
  const dateSize = fit(data.target.label, tw, px(56), 0.55), tsz = data.teaser ? fit(data.teaser, tw, px(side ? 130 : 150), 0.57) : 0;
  return `${hero ? `<div id="hero" style="position:absolute;left:${Math.round(hx)}px;top:${Math.round(hy)}px;width:${Math.round(hw)}px;height:${Math.round(hh)}px;border-radius:${px(28)}px;background:url('${src(hero)}') center/cover no-repeat;box-shadow:0 ${px(40)}px ${px(100)}px rgba(0,0,0,.55);opacity:0"></div>` : ''}
<div id="dt" style="opacity:0;position:absolute;left:${Math.round(tx)}px;top:${Math.round(ty)}px;width:${Math.round(tw)}px;text-align:${side ? 'left' : 'center'};color:${t.ink}">
  <div id="dlabel" style="font-size:${px(30)}px;letter-spacing:.3em;text-transform:uppercase;font-weight:600;color:${t.accent}">${esc(mode === 'ends' ? (L.lastCall || 'Last call') : (L.saveDate || 'Save the date'))}</div>
  <div id="date" style="margin-top:${px(12)}px;font-size:${dateSize}px;font-weight:600">${esc(data.target.label)}</div>
  <div id="rule" style="margin:${px(26)}px ${side ? '0' : 'auto'} ${px(22)}px;width:${Math.round(tw * 0.5)}px;height:${px(4)}px;background:${t.ink};opacity:.35;transform-origin:${side ? 'left' : 'center'} center"></div>
  ${data.teaser ? `<div class="mask" style="padding-bottom:${px(6)}px"><div id="teaser" class="d" style="font-size:${tsz}px;line-height:.95">${esc(data.teaser)}</div></div>` : ''}
  <div><div id="cta" class="cta" style="margin-top:${px(40)}px;font-size:${fit(data.cta, tw - px(110), px(52), 0.55)}px">${esc(data.cta)}</div></div>
  ${data.url ? `<div id="url" style="margin-top:${px(18)}px;font-size:${px(36)}px;font-weight:600;opacity:.8">${esc(data.url)}</div>` : ''}
</div>`; })()}
${noCredit ? '' : credit(t, px(26)).replace('opacity:.72', 'opacity:0')}`;

const f = v => v.toFixed(2);
const stepDur = (B.date - 1.0 - B.roll) / Math.max(1, steps.length - 1);
const rH = rowH;
let rollJs = '';
steps.forEach((_, i) => { if (i) rollJs += `tl.to('#reel',{y:${-i * rH},duration:${f(Math.min(0.3, stepDur * 0.8))},ease:'power3.inOut'},${f(B.roll + 0.3 + (i - 1) * stepDur)});\n`; });
// Cards deal in one after another during the roll.
const dealJs = images.map((_, i) => { const r = spots[i % spots.length][2]; const at = B.roll + 0.2 + i * ((B.date - 1.2 - B.roll) / Math.max(1, images.length)); return `tl.fromTo('#cd${i}',{opacity:0,y:${px(160)},rotation:${r * 3}},{opacity:1,y:0,rotation:${r},duration:.55,ease:'back.out(1.4)'},${f(at)});`; }).join('\n');
const script = `
tl.fromTo('#grain',{x:0,y:0},{x:-40,y:30,duration:${f(B.end)},ease:'steps(${Math.round(B.end * 12)})'},0);
${Array.from({ length: rows }, (_, i) => `tl.fromTo('#w${i}',{xPercent:${i % 2 ? -50 : 0}},{xPercent:${i % 2 ? 0 : -50},duration:${f(B.end * (1.6 + (i % 3) * 0.4))},ease:'none'},0);`).join('\n')}
tl.fromTo('#occ',{yPercent:110},{yPercent:0,duration:.55,ease:'power4.out'},0.1);
tl.fromTo('#dial',{scale:.3,opacity:0,rotation:-60},{scale:1,opacity:1,rotation:0,duration:.7,ease:'back.out(1.3)'},0.25);
tl.fromTo('#reel',{opacity:0},{opacity:1,duration:.3},0.55);
${rollJs}// the ring drains to the share of time still left between the first and the true number
tl.fromTo('#arc',{strokeDashoffset:0},{strokeDashoffset:${(C * (1 - value / start)).toFixed(1)},duration:${f(B.date - 1.0 - B.roll)},ease:'none'},${f(B.roll + 0.3)});
${dealJs}
tl.fromTo('#dial',{scale:1},{scale:1.07,duration:.15,yoyo:true,repeat:1},${f(B.date - 0.95)});
tl.to('#dial',{scale:.25,opacity:0,duration:.4,ease:'power3.in'},${f(B.date - 0.35)});
tl.to(${JSON.stringify(images.map((_, i) => `#cd${i}`))},{y:${px(260)},opacity:0,duration:.4,ease:'power3.in',stagger:.05},${f(B.date - 0.35)});
${Array.from({ length: rows }, (_, i) => `tl.to('#w${i}',{opacity:${i === hotRow ? 0.25 : 0.05},duration:.5},${f(B.date - 0.3)});`).join('\n')}
${images.length ? `tl.fromTo('#hero',{opacity:0,scale:.82,rotation:-5,y:${px(80)}},{opacity:1,scale:1,rotation:-2,y:0,duration:.6,ease:'back.out(1.3)'},${f(B.date - 0.1)});
tl.to('#hero',{scale:1.04,rotation:0,duration:${f(B.end - B.date - 0.5)},ease:'none'},${f(B.date + 0.5)});` : ''}
tl.set('#dt',{opacity:1},${f(B.date - 0.01)});
tl.fromTo('#dlabel',{opacity:0,x:${px(-30)}},{opacity:1,x:0,duration:.35},${f(B.date + 0.1)});
tl.fromTo('#date',{opacity:0,y:${px(24)}},{opacity:1,y:0,duration:.4,ease:'power3.out'},${f(B.date + 0.2)});
tl.fromTo('#rule',{scaleX:0},{scaleX:1,duration:.4,ease:'power2.out'},${f(B.date + 0.35)});
${data.teaser ? `tl.fromTo('#teaser',{yPercent:110},{yPercent:0,duration:.5,ease:'power4.out'},${f(B.date + 0.45)});` : ''}
tl.fromTo('#cta',{opacity:0,scale:.6},{opacity:1,scale:1,duration:.4,ease:'back.out(2)'},${f(B.cta)});
${data.url ? `tl.fromTo('#url',{opacity:0},{opacity:.85,duration:.3},${f(B.cta + 0.2)});` : ''}
${noCredit ? '' : `tl.fromTo('#credit',{opacity:0},{opacity:.75,duration:.4},${f(B.cta + 0.4)});`}
tl.set({}, {}, ${f(B.end)});`;

const out = path.resolve(outDir);
const { total } = await project({ here, out, inputDir, W, H, dur: B.end, title: `${data.brand.name} · ${data.occasion} countdown`, css, body, script, images });
await writeFile(path.join(out, 'countdown.json'), JSON.stringify({ ...data, aspect, computed: { value, unit, from: start } }, null, 2));
console.log(`✓ ${data.brand.name}: ${data.occasion} ${L[mode]} ${value} ${L[unit]}, ${aspect}, ${total.toFixed(1)} s → ${out}`);
