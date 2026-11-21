import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { auditFont, assertRequiredScriptLayout } from '../scripts/rtl-font-audit.ts';

const sources = [
  { id: 'hebrew', language: 'he', cssId: 'he-basic', selector: '#he-basic, #he-mixed', probe: 'שָׁלוֹם' },
  { id: 'arabic', language: 'ar', cssId: 'ar-basic', selector: '#ar-basic, #ar-mixed, #fa-basic', probe: 'السَّلَامُ', extra: ['fa'] },
  { id: 'urdu', language: 'ur', cssId: 'ur-basic', selector: '#ur-basic', probe: 'اردو ٹ ڈ ڑ ں ے' },
  { id: 'syriac', language: 'syr', cssId: 'syr-basic', selector: '#syr-basic', probe: 'ܫܠܡܐ ܒܪܝܟܐ' },
  { id: 'ethiopic', language: 'am', cssId: 'am-basic', selector: '#am-basic', probe: 'ሰላም ኢትዮጵያ' },
] as const;

// Real browser reference only: not Studio editing or MP4 parity.
test('Chromium preserves five-script Unicode and renders pinned licensed fonts without tofu fallback', { timeout: 120_000 }, async t => {
  const fontDir = process.env.RTL_BROWSER_FONT_DIR;
  if (process.env.RTL_BROWSER_PINNED_REQUIRED === '1' && !fontDir)
    throw new Error('PINNED_RTL_BROWSER_FONTS_REQUIRED');
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setContent(await readFile(new URL('./rtl-browser-fixture.html', import.meta.url), 'utf8'), { waitUntil: 'load' });
  let manifest: { sourceCommit: string; faces: Array<{ id: string; filename: string; fontSha256: string; licenseFilename: string; licenseSha256: string }> } | undefined;
  let platformFonts: Record<string, Array<{ familyName: string; isCustomFont: boolean; glyphCount: number }>> | undefined;
  if (fontDir) {
    manifest = JSON.parse(await readFile(path.join(fontDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest!.faces.length, sources.length);
    const css: string[] = [];
    for (const source of sources) {
      const face = manifest!.faces.find(item => item.id === source.id);
      assert.ok(face, 'missing pinned face ' + source.id);
      const bytes = await readFile(path.join(fontDir, face.filename));
      const licenseBytes = await readFile(path.join(fontDir, face.licenseFilename));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), face.fontSha256);
      assert.equal(createHash('sha256').update(licenseBytes).digest('hex'), face.licenseSha256);
      const report = await auditFont(path.join(fontDir, face.filename), source.probe);
      assert.equal(report.missingCodepoints.length, 0, source.id + ' has missing authored sample glyphs');
      assertRequiredScriptLayout(report, [source.language, ...('extra' in source ? source.extra : [])]);
      const family = 'OpenMotion RTL QA ' + source.id;
      css.push('@font-face{font-family:"' + family + '";src:url("data:font/ttf;base64,' + bytes.toString('base64') + '") format("truetype");font-style:normal;font-weight:100 900;font-display:block}');
      css.push(source.selector + '{font-family:"' + family + '" !important;}');
    }
    await page.addStyleTag({ content: css.join('\n') });
    await page.evaluate(async () => { await document.fonts.ready; });
    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const root = await cdp.send('DOM.getDocument');
    platformFonts = {};
    for (const source of sources) {
      const node = await cdp.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#' + source.cssId });
      assert.ok(node.nodeId, source.cssId);
      const actual = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
      platformFonts[source.id] = actual.fonts.map(font => ({ familyName: font.familyName, isCustomFont: font.isCustomFont, glyphCount: font.glyphCount }));
    }
  } else await page.evaluate(async () => { await document.fonts.ready; });

  const evidence = await page.evaluate(() => {
    const auditElement = document.querySelector('#rtl-audit')!;
    const audit = JSON.parse(auditElement.textContent || '{}') as Record<string, string | boolean>;
    const samples = ['he-basic', 'ar-basic', 'fa-basic', 'ur-basic', 'syr-basic', 'am-basic', 'ltr-control'].map(id => {
      const el = document.getElementById(id)!;
      const rect = el.getBoundingClientRect();
      return { id, lang: el.getAttribute('lang'), direction: getComputedStyle(el).direction,
        copy: el.textContent, width: rect.width, height: rect.height, cssFont: getComputedStyle(el).fontFamily };
    });
    return { pass: auditElement.getAttribute('data-pass'), audit, samples,
      documentDirection: getComputedStyle(document.documentElement).direction,
      englishIsolate: getComputedStyle(document.getElementById('ltr-brand')!).direction };
  });
  const outputDir = process.env.RTL_BROWSER_ARTIFACT_DIR;
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, 'chromium-rtl-reference.png'), fullPage: true });
    await writeFile(path.join(outputDir, 'chromium-rtl-reference.json'), JSON.stringify({
      browser: await browser.version(), pins: manifest, actualPlatformFonts: platformFonts,
      limitation: 'Real pinned-font Chromium reference, not Studio edit, contextual shaping certification, or OpenMotion MP4 parity.',
      ...evidence,
    }, null, 2) + '\n');
  }
  const expected: Record<string, [string, string, string]> = {
    'he-basic':['he','rtl','שלום'],
    'ar-basic':['ar','rtl','سلام'],
    'fa-basic':['fa','rtl','فارسی پ چ ژ گ'],
    'ur-basic':['ur','rtl','اردو ٹ ڈ ڑ ں ے'],
    'syr-basic':['syr','rtl','ܫܠܡܐ ܒܪܝܟܐ'],
    'am-basic':['am','ltr','ሰላም ኢትዮጵያ'],
    'ltr-control':['en','ltr','Render ABC-123 at 10:30'],
  };
  assert.equal(evidence.pass, 'yes', JSON.stringify(evidence.audit));
  assert.equal(evidence.documentDirection, 'ltr', 'English UI remains LTR');
  assert.equal(evidence.englishIsolate, 'ltr', 'Latin brand remains LTR isolated');
  for (const sample of evidence.samples) {
    assert.deepEqual([sample.lang, sample.direction, sample.copy], expected[sample.id], sample.id);
    assert.ok(sample.width > 0 && sample.height > 0, sample.id + ' has measurable geometry');
  }
  assert.equal(evidence.audit.heFirstGlyphRightmost, true);
  assert.equal(evidence.audit.arFirstGlyphRightmost, true);
  assert.equal(evidence.audit.arAutoDir, 'rtl');
  if (platformFonts) for (const source of sources) {
    const fonts = platformFonts[source.id];
    assert.ok(fonts.length > 0, source.id + ': no Chromium font-use evidence');
    assert.ok(fonts.some(font => font.isCustomFont && font.glyphCount > 0), source.id + ': pinned font not used');
    assert.ok(fonts.every(font => font.isCustomFont), source.id + ': browser substituted an unpinned fallback: ' + JSON.stringify(fonts));
  }
});
