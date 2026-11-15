import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pageMetadata, renderPageMetadata, socialImage } from '../packages/design-system/metadata.js';
import { designTokens } from '../scripts/design-tokens.ts';

test('generated entry heads contain one complete metadata set before JavaScript runs', async () => {
  await designTokens(true);
  for (const [file, surface] of [['studio/index.html', 'studio'], ['packages/design-system/index.html', 'design-system']]) {
    const html = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.ok(html.includes(renderPageMetadata('zh-CN', surface)));
    const head = html.split('</head>')[0];
    for (const key of ['description', 'og:title', 'og:description', 'og:image', 'og:locale', 'twitter:card', 'twitter:title', 'twitter:image']) {
      assert.equal([...head.matchAll(new RegExp(`(?:name|property)="${key}"`, 'g'))].length, 1, `${file}: ${key}`);
    }
    assert.equal([...head.matchAll(/<title>/g)].length, 1);
    assert.match(head, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(head, /rel="canonical"|property="og:url"/);
  }
});

test('sharing copy stays public, localized and HTML-safe', () => {
  for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr']) {
    const meta = pageMetadata(locale);
    assert.equal(meta.title, 'OpenDesign Motion — The fullstack agentic video editor');
    assert.equal(meta.property['og:site_name'], 'OpenDesign Motion');
    assert.equal(meta.name['application-name'], 'OpenDesign Motion');
    assert.equal(meta.property['og:title'], meta.name['twitter:title']);
    assert.equal(meta.property['og:description'], meta.name.description);
    assert.match(meta.property['og:locale'], /^[a-z]{2}_[A-Z]{2}$/);
    assert.doesNotMatch(JSON.stringify(meta), /localhost|127\.0\.0\.1|session=|project=/);
  }
  assert.match(renderPageMetadata('en'), /images &amp; video/);
  assert.equal(pageMetadata('unsupported').title, pageMetadata('en').title);
  assert.equal(new URL(socialImage.url).protocol, 'https:');
});

test('bookmark assets retain the product symbol and correctly sized PNG fallbacks', async () => {
  const directory = new URL('../packages/design-system/brand/', import.meta.url);
  const mark = await readFile(new URL('loading-mark.svg', directory), 'utf8');
  const icon = await readFile(new URL('favicon.svg', directory), 'utf8');
  assert.deepEqual([...icon.matchAll(/ d="([^"]+)"/g)].map(m => m[1]), [...mark.matchAll(/ d="([^"]+)"/g)].map(m => m[1]));
  assert.match(icon, /prefers-color-scheme:dark/);
  for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]] as const) {
    const png = await readFile(new URL(file, directory));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
