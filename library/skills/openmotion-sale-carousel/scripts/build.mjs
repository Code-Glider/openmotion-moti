#!/usr/bin/env node
// Generate an editable HyperFrames multi-product sale carousel from carousel.json.
// Usage:
//   node scripts/build.mjs --check carousel.json
//   node scripts/build.mjs carousel.json out/ [--aspect 9:16|4:5|1:1|16:9] [--no-credit]
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SIZES, esc, width, money, price, theme, checkImage, project, readData, credit, parseDate, validISO, fit, tape, badge } from './film.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const checkOnly = bool('--check');
const noCredit = bool('--no-credit');
const aspectArg = flag('--aspect');
const [input, outDir] = args;
if (!input || (!checkOnly && !outDir)) { console.error('Usage: node scripts/build.mjs [--check] carousel.json [out/] [--aspect 9:16] [--no-credit]'); process.exit(2); }
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
if (!data.title) errors.push('title is required, e.g. "Gifts under $100"');
else if (width(data.title) > 26) errors.push(`title "${data.title}" is longer than 26 characters`);
const items = data.products || [];
if (items.length < 3 || items.length > 7) errors.push(`use 3-7 products (got ${items.length})`);
const prices = items.map((it, i) => {
  if (!it.name) errors.push(`products[${i}].name is required`);
  else if (width(it.name) > 26) errors.push(`products[${i}].name "${it.name}" is longer than 26 characters`);
  if (!it.image) errors.push(`products[${i}].image is required: every card shows the real product`);
  checkImage(it.image, inputDir, `products[${i}].image`, errors);
  return price(it, `products[${i}]`, errors);
});
try { new Intl.NumberFormat(data.locale || 'en-US', { style: 'currency', currency: data.currency || 'USD' }); } catch { errors.push(`currency "${data.currency}" or locale "${data.locale}" is not valid`); }
if (data.code && !/^[A-Z0-9-]{3,16}$/.test(data.code)) errors.push(`code "${data.code}" must be 3-16 capital letters, digits or hyphens`);
if (data.deadline) {
  if (!data.deadline.label) errors.push('deadline.label is required when deadline is given');
  else if (width(data.deadline.label) > 34) errors.push('deadline.label is longer than 34 characters');
  if (!validISO(data.deadline.date || '')) errors.push('deadline.date must be an ISO date-time with an offset');
  else if (data.postDate && parseDate(data.postDate) >= parseDate(data.deadline.date)) errors.push('deadline.date is not after postDate');
}
if (data.postDate != null && !validISO(data.postDate)) errors.push('postDate must be a real ISO date-time with an offset');
if (!data.cta) errors.push('cta is required, e.g. "Shop the gift guide"');
else if (width(data.cta) > 20) errors.push(`cta "${data.cta}" is longer than 20 characters`);
if (data.url && width(data.url) > 32) errors.push(`url "${data.url}" is longer than 32 characters`);
if (errors.length) { console.error(errors.map(e => '✗ ' + e).join('\n')); process.exit(1); }
const cur = data.currency || 'USD', loc = data.locale || 'en-US';
const $ = v => money(v, cur, loc);
const L = { off: 'off', useCode: 'Code', ...(data.labels || {}) };
if (checkOnly) { console.log(`✓ ${data.brand.name} · ${data.title}: ${items.map((it, i) => `${it.name} ${$(prices[i].was)}→${$(prices[i].now)}`).join(', ')}; ${aspect}`); process.exit(0); }

// ---------- layout ----------
// Each product fills the frame in turn and wipes in over the last one; the counter, the sale
// tape and the badge stay on screen the whole time; the end grid collects every pick.
const [W, H] = SIZES[aspect];
const t = theme(data);
const wide = W > H, portrait = H / W > 1.5;
const u = Math.min(W, H) / 1080;
const px = n => Math.round(n * u);
const n = items.length;
const INTRO = 1.5, PER = 1.8, END = 2.8;
const dur = INTRO + n * PER + END;
const shade = `rgba(${t.shade},`;
const titleSize = fit(data.title, wide ? W * 0.6 : W * 0.88, px(wide ? 180 : 190), 0.5);
const occSize = fit(String(data.occasion), wide ? W * 0.6 : W * 0.88, px(110), 0.5);
const textL = wide ? W * 0.06 : W * 0.07, textW = wide ? W * 0.46 : W * 0.86;
const cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
const rows = Math.ceil(n / cols);
const gridW = Math.round(W * (portrait ? 0.86 : 0.8)), gridGap = px(18);
const tile = Math.min(Math.round((gridW - (cols - 1) * gridGap) / cols), Math.round((H * (portrait ? 0.46 : wide ? 0.4 : 0.42) - (rows - 1) * gridGap) / rows));
const tapeText = `${data.occasion} · ${data.title}${data.code ? ` · ${L.useCode} ${data.code}` : ''}`;
const css = `
#bg{position:absolute;inset:0;background:${t.bg}}
.ph{position:absolute;inset:0;background:${t.bg} center/cover no-repeat;transform-origin:50% 40%}
.sh{position:absolute;inset:0;background:linear-gradient(${wide ? '90deg' : '180deg'},${shade}.1) 0,${shade}.05) ${wide ? 35 : 45}%,${shade}.92) 100%)}
.brand{position:absolute;top:${px(54)}px;left:${px(54)}px;font-weight:600;font-size:${px(30)}px;letter-spacing:.22em;text-transform:uppercase;color:${t.ink}}
.mask{overflow:hidden}
.info{position:absolute;${wide ? `right:${W * 0.05}px;top:${H * 0.24}px;width:${W * 0.4}px` : `left:${textL}px;width:${textW}px;bottom:${H * (portrait ? 0.15 : 0.17)}px`};color:${t.ink}}
.was{position:relative;display:inline-block;font-size:${px(56)}px;color:${t.ink};opacity:.78;margin-right:${px(20)}px}
.was i{position:absolute;left:-4%;right:-4%;top:50%;height:${px(7)}px;background:${t.accent};transform:scaleX(0);transform-origin:left center}
.tag{position:absolute;border-radius:50%;background:${t.accent};color:${t.accentInk};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.grid{display:grid;grid-template-columns:repeat(${cols},${tile}px);gap:${gridGap}px;justify-content:center}
.tile{position:relative;width:${tile}px;height:${tile}px;border-radius:${px(20)}px;background:${t.panel} center/cover no-repeat;overflow:hidden}
.tile b{position:absolute;left:${px(10)}px;bottom:${px(10)}px;background:${t.accent};color:${t.accentInk};padding:${px(4)}px ${px(12)}px;border-radius:${px(999)}px}
.cta{display:inline-block;background:${t.ink};color:${t.bg};font-weight:700;font-size:${px(56)}px;padding:${px(22)}px ${px(56)}px;border-radius:${px(999)}px}`;
const nameSize = it => fit(it.name, wide ? W * 0.4 : textW, px(wide ? 150 : 170), 0.5);
const body = src => `<div id="bg"></div>
<div id="wall" style="position:absolute;inset:-6%;display:grid;grid-template-columns:repeat(${portrait ? 3 : 4},1fr);gap:${px(10)}px;opacity:.38">${[...items, ...items, ...items].slice(0, portrait ? 12 : 12).map(it => `<div style="background:url('${src(it.image)}') center/cover;aspect-ratio:${portrait ? '3/4' : '4/3'};border-radius:${px(14)}px"></div>`).join('')}</div>
<div id="wallshade" style="position:absolute;inset:0;background:radial-gradient(70% 50% at 50% 45%,${shade}.92) 0,${shade}.55) 100%)"></div>
<div id="intro" style="position:absolute;left:0;right:0;top:${H * (portrait ? 0.32 : 0.28)}px;text-align:center;color:${t.ink}">
  <div class="mask" style="height:${Math.round(occSize * 0.92)}px"><div id="occ" class="d" style="font-size:${occSize}px;color:${t.accent};white-space:nowrap">${esc(data.occasion)}</div></div>
  <div class="mask" style="height:${Math.round(titleSize * 0.92)}px;margin-top:${px(10)}px"><div id="title" class="d" style="font-size:${titleSize}px;white-space:nowrap">${esc(data.title)}</div></div>
  <div id="count" style="margin-top:${px(26)}px;font-size:${px(38)}px;letter-spacing:.3em;text-transform:uppercase;font-weight:600;opacity:0">${n} picks</div>
</div>
${items.map((it, i) => { const p = prices[i], ns = nameSize(it); return `<div id="s${i}" style="position:absolute;inset:0;clip-path:inset(0% 0% 0% 100%)">
  <div id="ph${i}" class="ph" style="background-image:url('${src(it.image)}')"></div><div class="sh"></div>
  <div class="info">
    <div style="font-size:${px(32)}px;letter-spacing:.28em;font-weight:600;opacity:.8">${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</div>
    <div class="mask" style="height:${Math.round(ns * 1.0)}px;margin-top:${px(10)}px"><div id="nm${i}" class="d" style="font-size:${ns}px;white-space:nowrap">${esc(it.name)}</div></div>
    <div style="margin-top:${px(16)}px;display:flex;align-items:baseline;flex-wrap:wrap"><span class="was" style="font-size:${fit($(p.was), textW * 0.4, px(56), 0.6)}px">${esc($(p.was))}<i id="st${i}"></i></span><span id="nw${i}" class="d" style="font-size:${fit($(p.now), textW * 0.6, px(wide ? 130 : 150), 0.55)}px;color:${t.ink}">${esc($(p.now))}</span></div>
  </div>
  <div id="tg${i}" class="tag d" style="width:${px(210)}px;height:${px(210)}px;${wide ? `left:${W * 0.4}px;top:${H * 0.12}px` : `right:${W * 0.06}px;top:${H * (portrait ? 0.1 : 0.12)}px`};font-size:${px(70)}px;line-height:.9">${p.framing === 'percent' ? `${p.percent}%` : esc($(p.save).replace(/\.00$/, ''))}<span style="font-size:${px(34)}px">${esc(L.off)}</span></div>
</div>`; }).join('\n')}
<div id="end" style="position:absolute;inset:0;background:${t.bg};clip-path:inset(0% 0% 0% 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;color:${t.ink};padding-bottom:${px(120)}px">
  <div class="grid">${items.map((it, i) => `<div id="tile${i}" class="tile" style="background-image:url('${src(it.image)}')"><b class="d" style="font-size:${fit($(prices[i].now), tile - px(40), Math.max(px(30), Math.round(tile * 0.14)), 0.55)}px">${esc($(prices[i].now))}</b></div>`).join('')}</div>
  ${data.code ? `<div class="d" style="margin-top:${px(34)}px;font-size:${px(70)}px;border:${px(5)}px dashed ${t.ink};border-radius:${px(18)}px;padding:${px(10)}px ${px(34)}px ${px(2)}px">${esc(L.useCode)} ${esc(data.code)}</div>` : ''}
  ${data.deadline ? `<div style="margin-top:${px(18)}px;font-size:${px(38)}px;font-weight:600;opacity:.85">${esc(data.deadline.label)}</div>` : ''}
  <div id="cta" class="cta" style="margin-top:${px(30)}px">${esc(data.cta)}</div>${data.url ? `<div style="margin-top:${px(16)}px;font-size:${px(36)}px;opacity:.8;font-weight:600">${esc(data.url)}</div>` : ''}
</div>
<div class="grain" id="grain"></div>
<div class="brand">${esc(data.brand.name)}</div>
${tape('tape', tapeText, t, W, H, { y: portrait ? 0.93 : 0.92, size: px(wide ? 46 : 52) })}
${noCredit ? '' : credit(t, px(24)).replace('opacity:.72', 'opacity:0').replace(/bottom:\d+px/, `bottom:${px(portrait ? 250 : 190)}px`)}`;

const f = v => v.toFixed(2);
let cards = '';
items.forEach((_, i) => {
  const a = INTRO + i * PER;
  cards += `tl.fromTo('#s${i}',{clipPath:'inset(0% 0% 0% 100%)'},{clipPath:'inset(0% 0% 0% 0%)',duration:.5,ease:'power3.inOut'},${f(a - 0.25)});
tl.fromTo('#ph${i}',{scale:1.2,xPercent:4},{scale:1.04,xPercent:-2,duration:${f(PER + 0.6)},ease:'none'},${f(a - 0.25)});
tl.fromTo('#nm${i}',{yPercent:105},{yPercent:0,duration:.5,ease:'power4.out'},${f(a + 0.1)});
tl.fromTo('#st${i}',{scaleX:0},{scaleX:1,duration:.3,ease:'power2.out'},${f(a + 0.55)});
tl.fromTo('#nw${i}',{opacity:0,x:${px(30)}},{opacity:1,x:0,duration:.35,ease:'power3.out'},${f(a + 0.75)});
tl.fromTo('#tg${i}',{scale:0,rotation:-40},{scale:1,rotation:-10,duration:.4,ease:'back.out(2)'},${f(a + 0.9)});\n`;
});
const endAt = INTRO + n * PER;
const script = `
tl.fromTo('#grain',{x:0,y:0},{x:-40,y:30,duration:${f(dur)},ease:'steps(${Math.round(dur * 12)})'},0);
tl.fromTo('#tape',{xPercent:-30,opacity:0},{xPercent:0,opacity:1,duration:.5,ease:'power3.out'},0.3);
tl.fromTo('#tape-run',{xPercent:0},{xPercent:-50,duration:${f(dur + 4)},ease:'none'},0);
tl.fromTo('#wall',{yPercent:4,scale:1.08},{yPercent:-4,scale:1,duration:${f(INTRO + 0.6)},ease:'none'},0);
tl.fromTo('#occ',{yPercent:105},{yPercent:0,duration:.5,ease:'power4.out'},0.1);
tl.set(['#intro','#wall','#wallshade'],{opacity:0},${f(INTRO + 0.3)});
tl.fromTo('#title',{yPercent:105},{yPercent:0,duration:.55,ease:'power4.out'},0.3);
tl.fromTo('#count',{opacity:0},{opacity:.8,duration:.3},0.7);
${cards}tl.fromTo('#end',{clipPath:'inset(0% 0% 0% 100%)'},{clipPath:'inset(0% 0% 0% 0%)',duration:.5,ease:'power3.inOut'},${f(endAt - 0.25)});
${items.map((_, i) => `tl.fromTo('#tile${i}',{scale:.6,opacity:0},{scale:1,opacity:1,duration:.35,ease:'back.out(1.6)'},${f(endAt + i * 0.07)});`).join('\n')}
tl.fromTo('#cta',{scale:.6,opacity:0},{scale:1,opacity:1,duration:.4,ease:'back.out(2)'},${f(endAt + 0.5)});
${noCredit ? '' : `tl.fromTo('#credit',{opacity:0},{opacity:.75,duration:.4},${f(endAt + 0.6)});`}
tl.set({}, {}, ${f(dur)});`;

const out = path.resolve(outDir);
const { total } = await project({ here, out, inputDir, W, H, dur, title: `${data.brand.name} · ${data.title}`, css, body, script, images: items.map(it => it.image) });
await writeFile(path.join(out, 'carousel.json'), JSON.stringify({ ...data, aspect, computed: items.map((it, i) => ({ name: it.name, was: prices[i].was, now: prices[i].now, percentOff: prices[i].percent })) }, null, 2));
console.log(`✓ ${data.brand.name}: ${n} products, ${aspect}, ${total.toFixed(1)} s → ${out}`);
