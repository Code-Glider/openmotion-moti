import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLiveFrameText } from './rtl-preview-frame-read.mjs';

test('return exact logical mixed-script and combining-mark text from a live iframe', async () => {
  const expected = 'ܒܪܝܟܐ שָׁלוֹם 52%';
  const frame = { detached: false, async evaluate(_callback, selector) {
    assert.equal(selector, '#syriac');
    return expected;
  } };
  assert.equal(await readLiveFrameText(frame, '#syriac'), expected);
});

test('skip a frame that is already detached without evaluating it', async () => {
  const frame = { detached: true, evaluate() { throw Error('Should not read detached iframe'); } };
  assert.equal(await readLiveFrameText(frame, '#syriac'), null);
});

test('catch synchronous decorator throw when the iframe detaches between enumeration and evaluation', async () => {
  const frame = { detached: false, evaluate() { throw Error("Attempted to use detached Frame 'ABCD'."); } };
  assert.equal(await readLiveFrameText(frame, '#syriac'), null);
});

test('skip asynchronous execution-context destruction during navigation', async () => {
  const frame = { detached: false, async evaluate() { throw Error('Execution context was destroyed, most likely because of a navigation.'); } };
  assert.equal(await readLiveFrameText(frame, '#syriac'), null);
});

test('skip a concurrent detach even when the exception message changes', async () => {
  const frame = { detached: false, evaluate() { this.detached = true; throw Error('Browser target unavailable'); } };
  assert.equal(await readLiveFrameText(frame, '#syriac'), null);
});

test('fail closed on actual evaluation defects in a live iframe', async () => {
  const frame = { detached: false, async evaluate() { throw Error('Unexpected Studio evaluation failure'); } };
  await assert.rejects(readLiveFrameText(frame, '#syriac'), /Unexpected Studio evaluation failure/);
});

test('return null when the live frame does not yet expose an authored selector', async () => {
  const frame = { detached: false, async evaluate() { return null; } };
  assert.equal(await readLiveFrameText(frame, '#syriac'), null);
});
