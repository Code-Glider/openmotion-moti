#!/usr/bin/env node
// Generate an editable HyperFrames sale promo from offer.json.
// Usage:
//   node scripts/build.mjs --check offer.json
//   node scripts/build.mjs offer.json out/ [--aspect 9:16|4:5|1:1|16:9] [--duration 10|15] [--no-credit]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZES, esc, width, money, price, theme, checkImage, project, readData, credit, parseDate, validISO } from './film.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const checkOnly = bool('--check');
const noCredit = bool('--no-credit');
const aspectArg = flag('--aspect');
const durArg = flag('--duration');
const [input, outDir] = args;
if (!input || (!checkOnly && !outDir)) { console.error('Usage: node scripts/build.mjs [--check] offer.json [out/] [--aspect 9:16] [--duration 10|15] [--no-credit]'); process.exit(2); }
const inputDir = path.dirname(path.resolve(input));
const data = await readData(input);

// ---------- validation ----------
const errors = [];
const aspect = aspectArg || data.aspect || '9:16';
if (!SIZES[aspect]) errors.push(`aspect must be one of ${Object.keys(SIZES).join(', ')}`);
const dur = Number(durArg || data.duration || 10);
if (![10, 15].includes(dur)) errors.push('duration must be 10 or 15 seconds');
if (!data.brand?.name) errors.push('brand.name is required');
else if (width(data.brand.name) > 24) errors.push(`brand.name "${data.brand.name}" is longer than 24 characters`);
if (!data.occasion) errors.push('occasion is required (e.g. "Black Friday")');
else if (width(data.occasion) > 18) errors.push(`occasion "${data.occasion}" is longer than 18 characters`);
if (!data.product?.name) errors.push('product.name is required');
else if (width(data.product.name) > 30) errors.push(`product.name "${data.product.name}" is longer than 30 characters`);
checkImage(data.product?.image, inputDir, 'product.image', errors);
const p = data.product ? price(data.product, 'product', errors) : null;
try { new Intl.NumberFormat(data.locale || 'en-US', { style: 'currency', currency: data.currency || 'USD' }); } catch { errors.push(`currency "${data.currency}" or locale "${data.locale}" is not valid`); }
if (!data.code) errors.push('code is required: the promo code shown on screen');
else if (!/^[A-Z0-9-]{3,16}$/.test(data.code)) errors.push(`code "${data.code}" must be 3-16 capital letters, digits or hyphens`);
const dl = data.deadline || {};
if (!dl.label) errors.push('deadline.label is required, e.g. "Ends Mon, Dec 1 · 11:59 pm ET"');
else if (width(dl.label) > 34) errors.push(`deadline.label is ${width(dl.label)} characters; keep it under 34`);
if (!validISO(dl.date || '')) errors.push('deadline.date must be an ISO date-time with an offset, e.g. 2026-12-01T23:59:00-05:00');
if (data.postDate && validISO(dl.date || '') && parseDate(data.postDate) != null && parseDate(data.postDate) >= parseDate(dl.date)) errors.push('deadline.date is not after postDate: the offer would already be over');
if (data.postDate != null && !validISO(data.postDate)) errors.push('postDate must be a real ISO date-time with an offset');
if (!data.cta) errors.push('cta is required, e.g. "Shop now"');
else if (width(data.cta) > 18) errors.push(`cta "${data.cta}" is longer than 18 characters`);
if (data.url && width(data.url) > 32) errors.push(`url "${data.url}" is longer than 32 characters`);
if (errors.length) { console.error(errors.map(e => '✗ ' + e).join('\n')); process.exit(1); }
const cur = data.currency || 'USD', loc = data.locale || 'en-US';
const $ = v => money(v, cur, loc);
if (checkOnly) { console.log(`✓ ${data.brand.name} · ${data.product.name}: ${$(p.was)} → ${$(p.now)} (${p.percent}% off, save ${$(p.save)}), code ${data.code}, ${aspect}, ${dur} s`); process.exit(0); }

// ---------- layout ----------
const [W, H] = SIZES[aspect];
const t = theme(data);
const wide = W > H, portrait = H / W > 1.5;
const u = Math.min(W, H) / 1080 * (wide ? 1.3 : 1);   // scale unit; landscape frames get larger type
const px = n => Math.round(n * u);
const k = dur / 10;                            // beat stretch
const B = { hook: 0, disc: 1.6 * k, price: 4.0 * k, code: 7.0 * k, cta: 8.8 * k, end: dur };
const big = p.framing === 'percent' ? `${p.percent}%` : $(p.save).replace(/\.00$/, '');
const bigSize = Math.min(px(wide ? 420 : 400), Math.round((wide ? H * 1.3 : W * 0.9) / (0.62 * [...big].length)));
const occ = String(data.occasion).toUpperCase().split(/\s+/);
const occSize = Math.min(px(wide ? 230 : 250), Math.round((wide ? W * 0.8 : W * 0.88) / (0.6 * Math.max(...occ.map(w => w.length)))));
const img = data.product.image;
// Monospace glyphs are ~0.6 em plus 0.06 em tracking; leave room for the chip's padding and border.
const codeSize = Math.min(px(118), Math.floor((W * 0.9 - px(130)) / (0.68 * data.code.length)));
const L = { off: 'OFF', useCode: 'Use code', save: 'Save', ...(data.labels || {}) };

const css = `
#bg{position:absolute;inset:0;background:${t.bg}}
.beat{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:${t.ink};opacity:0}
.brand{position:absolute;top:${px(70)}px;left:0;right:0;text-align:center;font-weight:600;font-size:${px(34)}px;letter-spacing:.18em;text-transform:uppercase;color:${t.ink};opacity:0}
.occ{font-weight:800;line-height:.86;letter-spacing:-.03em;font-size:${occSize}px}
.bar{width:${px(260)}px;height:${px(16)}px;background:${t.accent};margin-top:${px(46)}px;transform-origin:left center}
.big{font-weight:800;line-height:.82;letter-spacing:-.05em;font-size:${bigSize}px;color:${t.accent}}
.off{font-weight:800;font-size:${px(150)}px;letter-spacing:-.02em;line-height:1;margin-top:${px(10)}px}
.ray{position:absolute;left:50%;top:50%;width:${px(1600)}px;height:${px(1600)}px;margin:${-px(800)}px 0 0 ${-px(800)}px;background:repeating-conic-gradient(${t.accent}22 0 6deg,transparent 6deg 18deg);border-radius:50%;opacity:0}
.card{display:flex;${wide ? 'flex-direction:row;gap:' + px(70) + 'px' : 'flex-direction:column;gap:' + px(portrait ? 56 : 30) + 'px'};align-items:center}
.photo{width:${px(wide ? 620 : portrait ? 900 : 600)}px;height:${px(wide ? 620 : portrait ? 960 : 500)}px;border-radius:${px(36)}px;background:${t.panel} center/cover no-repeat;box-shadow:0 ${px(30)}px ${px(80)}px rgba(0,0,0,.35)}
.noimg{display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${px(120)}px;color:${t.accent};letter-spacing:-.04em;padding:${px(40)}px;text-align:center;line-height:.95}
.pname{font-weight:600;font-size:${px(54)}px;letter-spacing:-.01em}
.was{position:relative;display:inline-block;font-size:${px(72)}px;color:${t.sub};font-weight:600}
.strike{position:absolute;left:-4%;right:-4%;top:52%;height:${px(9)}px;background:${t.accent};transform:scaleX(0);transform-origin:left center;border-radius:${px(5)}px}
.now{font-weight:800;font-size:${px(wide ? 170 : 190)}px;letter-spacing:-.04em;line-height:1;color:${t.ink}}
.save{display:inline-block;background:${t.accent};color:${t.accentInk};font-weight:700;font-size:${px(40)}px;padding:${px(12)}px ${px(26)}px;border-radius:${px(999)}px;margin-top:${px(18)}px}
.label{font-size:${px(44)}px;color:${t.sub};letter-spacing:.12em;text-transform:uppercase;font-weight:600}
.chip{margin-top:${px(28)}px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-weight:700;font-size:${codeSize}px;letter-spacing:.06em;padding:${px(26)}px ${px(56)}px;border:${px(7)}px dashed ${t.accent};border-radius:${px(28)}px;background:${t.panel};color:${t.ink}}
.dl{margin-top:${px(60)}px;font-size:${px(50)}px;font-weight:600;display:flex;align-items:center;gap:${px(18)}px}
.dot{width:${px(22)}px;height:${px(22)}px;border-radius:50%;background:${t.accent}}
.cta{font-weight:800;font-size:${px(96)}px;background:${t.accent};color:${t.accentInk};padding:${px(34)}px ${px(84)}px;border-radius:${px(999)}px;letter-spacing:-.01em}
.url{margin-top:${px(40)}px;font-size:${px(48)}px;color:${t.sub};font-weight:600}
.endocc{font-size:${px(46)}px;letter-spacing:.16em;text-transform:uppercase;color:${t.sub};font-weight:700;margin-bottom:${px(50)}px}`;

const body = src => `<div id="bg"></div>
<div id="ray" class="ray"></div>
<div id="brand" class="brand">${esc(data.brand.name)}</div>
<div id="b-hook" class="beat"><div class="occ">${occ.map((w, i) => `<div id="occ${i}">${esc(w)}</div>`).join('')}</div><div id="bar" class="bar"></div></div>
<div id="b-disc" class="beat"><div id="big" class="big">${esc(big)}</div><div id="off" class="off">${esc(L.off)}</div></div>
<div id="b-price" class="beat"><div class="card">
  ${img ? `<div id="photo" class="photo" style="background-image:url('${src(img)}')"></div>` : `<div id="photo" class="photo noimg">${esc(data.product.name)}</div>`}
  <div>
    ${img ? `<div class="pname">${esc(data.product.name)}</div>` : ''}
    <div style="margin-top:${px(18)}px"><span class="was">${esc($(p.was))}<span id="strike" class="strike"></span></span></div>
    <div id="now" class="now">${esc($(p.was))}</div>
    <div id="save" class="save">${esc(L.save)} ${esc($(p.save))}</div>
  </div></div></div>
<div id="b-code" class="beat"><div class="label">${esc(L.useCode)}</div><div id="chip" class="chip">${esc(data.code)}</div><div id="dl" class="dl"><span class="dot"></span>${esc(dl.label)}</div></div>
<div id="b-cta" class="beat"><div class="endocc">${esc(data.occasion)} · ${esc(data.brand.name)}</div><div id="cta" class="cta">${esc(data.cta)}</div>${data.url ? `<div class="url">${esc(data.url)}</div>` : ''}${noCredit ? '' : credit(t, px(30))}</div>`;

const f = v => v.toFixed(2);
const nowFmt = `new Intl.NumberFormat(${JSON.stringify(loc)},{style:'currency',currency:${JSON.stringify(cur)},minimumFractionDigits:${Math.abs(p.now - Math.round(p.now)) < 0.005 ? 0 : 2},maximumFractionDigits:2})`;
const script = `
const show=(id,a,b)=>{tl.fromTo(id,{opacity:0},{opacity:1,duration:.18},a);tl.to(id,{opacity:0,duration:.18},b-.18);};
// hook
show('#b-hook',${f(B.hook)},${f(B.disc)});
${occ.map((_, i) => `tl.fromTo('#occ${i}',{scale:1.6,opacity:0},{scale:1,opacity:1,duration:.32,ease:'power4.out'},${f(0.08 + i * 0.16)});`).join('\n')}
tl.fromTo('#bar',{scaleX:0},{scaleX:1,duration:.4,ease:'power3.out'},${f(0.2 + occ.length * 0.16)});
tl.fromTo('#brand',{opacity:0},{opacity:.9,duration:.3},${f(B.disc)});
// discount
show('#b-disc',${f(B.disc)},${f(B.price)});
tl.fromTo('#ray',{opacity:0,rotation:0},{opacity:1,rotation:40,duration:${f(B.price - B.disc)},ease:'none'},${f(B.disc)});
tl.to('#ray',{opacity:0,duration:.2},${f(B.price - 0.2)});
tl.fromTo('#big',{scale:2.4,opacity:0},{scale:1,opacity:1,duration:.38,ease:'back.out(1.6)'},${f(B.disc + 0.05)});
tl.fromTo('#off',{y:${px(60)},opacity:0},{y:0,opacity:1,duration:.3,ease:'power3.out'},${f(B.disc + 0.32)});
// was -> now: the strike draws first, then the new price lands
show('#b-price',${f(B.price)},${f(B.code)});
tl.to('#brand',{opacity:0,duration:.15},${f(B.price - 0.15)});
tl.to('#brand',{opacity:.9,duration:.2},${f(B.code)});
tl.fromTo('#photo',{y:${px(80)},opacity:0},{y:0,opacity:1,duration:.4,ease:'power3.out'},${f(B.price)});
tl.fromTo('#strike',{scaleX:0},{scaleX:1,duration:.35,ease:'power2.out'},${f(B.price + 0.45)});
const fmt=${nowFmt};const nowEl=document.querySelector('#root #now');const o={v:${p.was}};
tl.fromTo(o,{v:${p.was}},{v:${p.now},duration:.75,ease:'power3.out',onUpdate:()=>{nowEl.textContent=fmt.format(Math.round(o.v*100)/100)}},${f(B.price + 0.85)});
tl.fromTo('#now',{scale:1},{scale:1.12,duration:.12,yoyo:true,repeat:1,ease:'power2.out'},${f(B.price + 1.6)});
tl.fromTo('#save',{scale:.6,opacity:0},{scale:1,opacity:1,duration:.3,ease:'back.out(2)'},${f(B.price + 1.75)});
// code + deadline, held still so they can be read
show('#b-code',${f(B.code)},${f(B.cta)});
tl.fromTo('#chip',{scale:.85,opacity:0},{scale:1,opacity:1,duration:.3,ease:'back.out(1.8)'},${f(B.code + 0.1)});
tl.fromTo('#dl',{y:${px(30)},opacity:0},{y:0,opacity:1,duration:.3,ease:'power3.out'},${f(B.code + 0.3)});
tl.to('#brand',{opacity:0,duration:.2},${f(B.cta - 0.2)});
// call to action
tl.fromTo('#b-cta',{opacity:0},{opacity:1,duration:.2},${f(B.cta)});
tl.fromTo('#cta',{scale:.7,opacity:0},{scale:1,opacity:1,duration:.35,ease:'back.out(1.8)'},${f(B.cta + 0.05)});
tl.set({}, {}, ${f(B.end)});`;

const out = path.resolve(outDir);
const { total } = await project({ here, out, inputDir, W, H, dur, title: `${data.brand.name} · ${data.occasion} promo`, css, body, script, images: [img] });
const { writeFile } = await import('node:fs/promises');
await writeFile(path.join(out, 'offer.json'), JSON.stringify({ ...data, aspect, duration: dur, computed: { was: p.was, now: p.now, percentOff: p.percent, save: p.save } }, null, 2));
console.log(`✓ ${data.brand.name}: ${$(p.was)} → ${$(p.now)}, ${aspect}, ${total.toFixed(1)} s → ${out}`);
