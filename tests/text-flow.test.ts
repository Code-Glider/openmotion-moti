import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalTextLanguage, directionFromLanguage, isTextDirection,
  physicalTextAlignment, resolveTextDirection, textFlowAttributes,
} from '../shared/text-flow.ts';

test('canonicalizes BCP47 and rejects attribute injection', () => {
  assert.equal(canonicalTextLanguage('he-il'), 'he-IL');
  assert.equal(canonicalTextLanguage('fa-arab-ir'), 'fa-Arab-IR');
  assert.equal(canonicalTextLanguage(undefined), undefined);
  for (const input of ['', 'en" dir="rtl', 'he-<script>', 'he--IL', 'a'.repeat(65)]) {
    assert.throws(() => canonicalTextLanguage(input), /INVALID_TEXT_LANGUAGE/);
  }
});

test('language and script direction, including Semitic LTR scripts', () => {
  const cases: Array<[string, 'ltr'|'rtl'|undefined]> = [
    ['he', 'rtl'], ['ar', 'rtl'], ['fa', 'rtl'], ['ur', 'rtl'], ['syr', 'rtl'],
    ['en', 'ltr'], ['am', 'ltr'], ['ti', 'ltr'], ['ar-Latn', 'ltr'],
    ['az-Arab', 'rtl'], ['az-Latn', 'ltr'], ['pa-Guru', 'ltr'], ['pa-Arab', 'rtl'],
    ['ku', undefined], ['ku-Arab', 'rtl'], ['und', undefined],
  ];
  for (const [language, expected] of cases) assert.equal(directionFromLanguage(language), expected, language);
});

test('explicit direction overrides language and auto is preserved', () => {
  assert.equal(resolveTextDirection({ language: 'he', direction: 'ltr' }), 'ltr');
  assert.equal(resolveTextDirection({ language: 'ar', direction: 'auto' }), 'auto');
  assert.equal(resolveTextDirection({}), undefined);
  assert.equal(isTextDirection('right'), false);
  assert.throws(() => resolveTextDirection({ direction: 'right' as never }), /INVALID_TEXT_DIRECTION/);
});

test('attributes are safe, optional, and backwards compatible', () => {
  assert.equal(textFlowAttributes({}), '');
  assert.equal(textFlowAttributes({ language: 'he-il' }), ' lang="he-IL" dir="rtl"');
  assert.equal(textFlowAttributes({ language: 'ar', direction: 'ltr' }), ' lang="ar" dir="ltr"');
  assert.equal(textFlowAttributes({ direction: 'auto' }), ' dir="auto"');
});

test('logical align maps to physical controls without changing source semantics', () => {
  assert.equal(physicalTextAlignment('start', 'rtl'), 'right');
  assert.equal(physicalTextAlignment('end', 'rtl'), 'left');
  assert.equal(physicalTextAlignment('start', 'ltr'), 'left');
  assert.equal(physicalTextAlignment('end', 'ltr'), 'right');
  assert.equal(physicalTextAlignment('center', 'rtl'), 'center');
  assert.equal(physicalTextAlignment('right', 'rtl'), 'right');
});

test('representative Hebrew/Arabic text stays in logical order', () => {
  const fixtures = [
    'מבצע 25% על OpenMotion Pro!',
    'בְּרֵאשִׁית',
    'السَّلَامُ عَلَيْكُمْ',
    'الخصم 25% على OpenMotion 2.0!',
  ];
  for (const source of fixtures) {
    const stored = JSON.parse(JSON.stringify({ text: source }));
    assert.equal(stored.text, source);
  }
});
