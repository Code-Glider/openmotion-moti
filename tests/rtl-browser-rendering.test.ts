import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

// Actual Chromium HTML layout reference; never substitute this for Studio or MP4 evidence.
test('Chromium measures logical Hebrew, Arabic, Persian, Urdu, Syriac and Ethiopic/LTR browser text', { timeout: 60_000 }, async t => {
  // A skipped test must not become a green browser qualification gate.
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setContent(await readFile(new URL('./rtl-browser-fixture.html', import.meta.url), 'utf8'), { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; });
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
      browser: await browser.version(),
      limitation: 'System fallback not pinned; not Studio editing, semantic shaping certification or MP4 parity.',
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
  assert.equal(evidence.documentDirection, 'ltr', 'English UI retains LTR direction');
  assert.equal(evidence.englishIsolate, 'ltr', 'Latin brand is isolated LTR');
  for (const sample of evidence.samples) {
    assert.deepEqual([sample.lang, sample.direction, sample.copy], expected[sample.id], sample.id);
    assert.ok(sample.width > 0 && sample.height > 0, sample.id + ' is measurable');
  }
  assert.equal(evidence.audit.heFirstGlyphRightmost, true);
  assert.equal(evidence.audit.arFirstGlyphRightmost, true);
  assert.equal(evidence.audit.arAutoDir, 'rtl');
});
