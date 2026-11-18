#!/usr/bin/env node
// Generate an editable HyperFrames multi-product sale carousel from carousel.json.
// Usage:
//   node scripts/build.mjs --check carousel.json
//   node scripts/build.mjs carousel.json out/ [--aspect 9:16|4:5|1:1|16:9] [--no-credit]
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SIZES, esc, width, money, price, theme, checkImage, project, readData, credit, parseDate, ISO } from './film.mjs';

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
  if (!ISO.test(data.deadline.date || '')) errors.push('deadline.date must be an ISO date-time with an offset');
  else if (data.postDate && parseDate(data.postDate) >= parseDate(data.deadline.date)) errors.push('deadline.date is not after postDate');
}
if (!data.cta) errors.push('cta is required, e.g. "Shop the gift guide"');
else if (width(data.cta) > 20) errors.push(`cta "${data.cta}" is longer than 20 characters`);
if (data.url && width(data.url) > 32) errors.push(`url "${data.url}" is longer than 32 characters`);
if (errors.length) { console.error(errors.map(e => '✗ ' + e).join('\n')); process.exit(1); }
const cur = data.currency || 'USD', loc = data.locale || 'en-US';
const $ = v => money(v, cur, loc);
const L = { off: 'off', useCode: 'Code', ...(data.labels || {}) };
if (checkOnly) { console.log(`✓ ${data.brand.name} · ${data.title}: ${items.map((it, i) => `${it.name} ${$(prices[i].was)}→${$(prices[i].now)}`).join(', ')}; ${aspect}`); process.exit(0); }

// ---------- layout ----------
const [W, H] = SIZES[aspect];
const t = theme(data);
const wide = W > H, portrait = H / W > 1.5, square = !wide && !portrait;
const u = Math.min(W, H) / 1080;
const px = n => Math.round(n * u);
const n = items.length;
const INTRO = 1.5, PER = 1.7, END = 2.8;
const dur = INTRO + n * PER + END;
// Card geometry: portrait stacks photo over text; square and landscape put them side by side.
const side = !portrait;
const cardW = portrait ? px(900) : wide ? Math.round(W * 0.8) : px(980);
const cardH = portrait ? px(1380) : wide ? Math.round(H * 0.72) : px(760);
const photoW = side ? Math.round(cardW * 0.56) : cardW, photoH = side ? cardH : Math.round(cardH * 0.66);
const occ = String(data.occasion).toUpperCase();
const cols = n <= 3 ? n : n === 4 ? 2 : (portrait ? 2 : (n <= 6 ? 3 : 4));
const rows = Math.ceil(n / cols);
const gridW = Math.round(W * (portrait ? 0.86 : 0.8)), gridGap = px(22);
const tile = Math.min(Math.round((gridW - (cols - 1) * gridGap) / cols), Math.round((H * (portrait ? 0.5 : wide ? 0.34 : 0.4) - (rows - 1) * gridGap) / rows));

const css = `
#bg{position:absolute;inset:0;background:${t.bg}}
.top{position:absolute;top:${px(64)}px;left:0;right:0;text-align:center;font-weight:600;font-size:${px(32)}px;letter-spacing:.18em;text-transform:uppercase;color:${t.ink};opacity:.9}
.beat{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:${t.ink};opacity:0}
.occ{font-weight:800;font-size:${Math.min(px(portrait ? 170 : 150), Math.round(W * 0.86 / (0.6 * occ.length)))}px;letter-spacing:-.03em;line-height:.9;color:${t.accent}}
.title{margin-top:${px(28)}px;font-weight:800;font-size:${Math.min(px(110), Math.round(W * 0.9 / (0.56 * Math.max(8, width(data.title)))))}px;letter-spacing:-.03em;line-height:1}
.count{margin-top:${px(30)}px;font-size:${px(42)}px;color:${t.sub};font-weight:600;letter-spacing:.06em}
.card{position:absolute;left:${Math.round((W - cardW) / 2)}px;top:${Math.round((H - cardH) / 2 + (portrait ? px(40) : px(20)))}px;width:${cardW}px;height:${cardH}px;border-radius:${px(40)}px;background:${t.panel};overflow:hidden;display:flex;flex-direction:${side ? 'row' : 'column'};box-shadow:0 ${px(30)}px ${px(90)}px rgba(0,0,0,.35);opacity:0}
.ph{width:${photoW}px;height:${photoH}px;background:${t.bg} center/cover no-repeat;flex:none}
.info{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:${side ? 'flex-start' : 'center'};padding:${px(side ? 50 : 30)}px;gap:${px(10)}px;text-align:${side ? 'left' : 'center'};color:${t.ink}}
.idx{font-size:${px(30)}px;color:${t.sub};font-weight:600;letter-spacing:.1em}
.nm{font-size:${px(side ? 52 : 58)}px;font-weight:700;line-height:1.08;letter-spacing:-.01em}
.row{display:flex;align-items:baseline;gap:${px(22)}px;${side ? '' : 'justify-content:center;'}margin-top:${px(6)}px;flex-wrap:wrap}
.was{position:relative;font-size:${px(48)}px;color:${t.sub};font-weight:600}
.was i{position:absolute;left:-4%;right:-4%;top:52%;height:${px(6)}px;background:${t.accent};transform:scaleX(0);transform-origin:left center}
.now{font-size:${px(side ? 100 : 112)}px;font-weight:800;letter-spacing:-.04em;line-height:1}
.badge{position:absolute;top:${px(28)}px;${side ? `left:${photoW - px(210)}px` : `right:${px(28)}px`};width:${px(180)}px;height:${px(180)}px;border-radius:50%;background:${t.accent};color:${t.accentInk};display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:800;font-size:${px(56)}px;line-height:.9;box-shadow:0 ${px(10)}px ${px(30)}px rgba(0,0,0,.3)}
.badge small{font-size:${px(30)}px;font-weight:700;text-transform:uppercase}
.grid{display:grid;grid-template-columns:repeat(${cols},${tile}px);gap:${gridGap}px;justify-content:center}
.tile{position:relative;width:${tile}px;height:${tile}px;border-radius:${px(24)}px;background:${t.panel} center/cover no-repeat;overflow:hidden}
.tile b{position:absolute;left:${px(12)}px;bottom:${px(12)}px;background:${t.accent};color:${t.accentInk};font-size:${Math.max(px(26), Math.round(tile * 0.12))}px;padding:${px(6)}px ${px(14)}px;border-radius:${px(999)}px}
.code{margin-top:${px(40)}px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-weight:700;font-size:${px(56)}px;border:${px(5)}px dashed ${t.accent};border-radius:${px(20)}px;padding:${px(12)}px ${px(34)}px}
.dl{margin-top:${px(22)}px;font-size:${px(38)}px;color:${t.sub};font-weight:600}
.cta{margin-top:${px(40)}px;font-weight:800;font-size:${px(72)}px;background:${t.accent};color:${t.accentInk};padding:${px(26)}px ${px(64)}px;border-radius:${px(999)}px}
.url{margin-top:${px(22)}px;font-size:${px(40)}px;color:${t.sub};font-weight:600}`;

const body = src => `<div id="bg"></div>
<div id="top" class="top">${esc(data.brand.name)}</div>
<div id="b-intro" class="beat"><div id="occ" class="occ">${esc(occ)}</div><div id="title" class="title">${esc(data.title)}</div><div id="count" class="count">${n} picks</div></div>
${items.map((it, i) => { const p = prices[i]; return `<div id="card${i}" class="card"><div class="ph" style="background-image:url('${src(it.image)}')"></div>
  <div class="info"><div class="idx">${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</div><div class="nm">${esc(it.name)}</div>
  <div class="row"><span class="was">${esc($(p.was))}<i id="st${i}"></i></span><span class="now">${esc($(p.now))}</span></div></div>
  <div id="bd${i}" class="badge">${p.framing === 'percent' ? `${p.percent}%<small>${esc(L.off)}</small>` : `${esc($(p.save).replace(/\.00$/, ''))}<small>${esc(L.off)}</small>`}</div></div>`; }).join('\n')}
<div id="b-end" class="beat" style="padding-bottom:${px(70)}px"><div class="grid">${items.map((it, i) => `<div id="tile${i}" class="tile" style="background-image:url('${src(it.image)}')"><b>${esc($(prices[i].now))}</b></div>`).join('')}</div>
  ${data.code ? `<div class="code">${esc(L.useCode)} ${esc(data.code)}</div>` : ''}${data.deadline ? `<div class="dl">${esc(data.deadline.label)}</div>` : ''}
  <div id="cta" class="cta">${esc(data.cta)}</div>${data.url ? `<div class="url">${esc(data.url)}</div>` : ''}${noCredit ? '' : credit(t, px(26))}</div>`;

const f = v => v.toFixed(2);
let cards = '';
items.forEach((_, i) => {
  const a = INTRO + i * PER;
  cards += `tl.fromTo('#card${i}',{x:${W},opacity:1,rotation:4},{x:0,rotation:0,duration:.45,ease:'power3.out'},${f(a)});
tl.fromTo('#st${i}',{scaleX:0},{scaleX:1,duration:.3,ease:'power2.out'},${f(a + 0.5)});
tl.fromTo('#bd${i}',{scale:0,rotation:-30},{scale:1,rotation:-8,duration:.35,ease:'back.out(2)'},${f(a + 0.7)});
tl.to('#card${i}',{x:${-W},rotation:-4,duration:.4,ease:'power3.in'},${f(a + PER - 0.3)});\n`;
});
const endAt = INTRO + n * PER;
const script = `
tl.fromTo('#b-intro',{opacity:0},{opacity:1,duration:.15},0);
tl.fromTo('#occ',{scale:1.5,opacity:0},{scale:1,opacity:1,duration:.35,ease:'power4.out'},0.05);
tl.fromTo('#title',{y:${px(40)},opacity:0},{y:0,opacity:1,duration:.35,ease:'power3.out'},0.35);
tl.fromTo('#count',{opacity:0},{opacity:1,duration:.3},0.65);
tl.to('#b-intro',{opacity:0,duration:.2},${f(INTRO - 0.2)});
${cards}tl.to('#top',{opacity:0,duration:.2},${f(endAt - 0.2)});
tl.fromTo('#b-end',{opacity:0},{opacity:1,duration:.2},${f(endAt - 0.1)});
${items.map((_, i) => `tl.fromTo('#tile${i}',{scale:.6,opacity:0},{scale:1,opacity:1,duration:.3,ease:'back.out(1.6)'},${f(endAt + i * 0.06)});`).join('\n')}
tl.fromTo('#cta',{scale:.7,opacity:0},{scale:1,opacity:1,duration:.35,ease:'back.out(1.8)'},${f(endAt + 0.5)});
tl.set({}, {}, ${f(dur)});`;

const out = path.resolve(outDir);
const { total } = await project({ here, out, inputDir, W, H, dur, title: `${data.brand.name} · ${data.title}`, css, body, script, images: items.map(it => it.image) });
await writeFile(path.join(out, 'carousel.json'), JSON.stringify({ ...data, aspect, computed: items.map((it, i) => ({ name: it.name, was: prices[i].was, now: prices[i].now, percentOff: prices[i].percent })) }, null, 2));
console.log(`✓ ${data.brand.name}: ${n} products, ${aspect}, ${total.toFixed(1)} s → ${out}`);
