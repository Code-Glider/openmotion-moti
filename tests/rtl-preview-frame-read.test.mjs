import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLiveFrameText, readLiveFrameTexts, waitForLiveFrameTexts } from './rtl-preview-frame-read.mjs';

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

const expectedRows = { '#label': 'שָׁלוֹם 2030', '#syriac': 'ܫܠܡܐ ܒܪܝܟܐ', '#latin': 'ABC-123' };

test('skip exact Linux detached execution-context failure even before detached flag updates', async () => {
  const frame = { detached: false, async evaluate() {
    throw Error('Execution context is not available in detached frame or worker "preview" (are you trying to evaluate?)');
  } };
  assert.equal(await readLiveFrameText(frame, '#label'), null);
  assert.equal(await readLiveFrameTexts(frame, Object.keys(expectedRows)), null);
});

test('discard a snapshot from a frame detached before its evaluation response arrives', async () => {
  const frame = { detached: false, async evaluate() { this.detached = true; return expectedRows; } };
  assert.equal(await readLiveFrameTexts(frame, Object.keys(expectedRows)), null);
});

test('reacquire the new player after history remount and require every logical row together', async () => {
  const old = { detached: false, async evaluate() {
    throw Error('Execution context is not available in detached frame or worker "preview"');
  } };
  const fresh = { detached: false, async evaluate(_callback, selectors) {
    assert.deepEqual(selectors, Object.keys(expectedRows));
    return expectedRows;
  } };
  let scans = 0;
  const page = { frames() { return ++scans === 1 ? [old] : [fresh]; } };
  assert.deepEqual(await waitForLiveFrameTexts(page, expectedRows, { timeoutMs: 1000, pollMs: 0 }), expectedRows);
  assert.equal(scans, 2);
});

test('reject mixed generations and persistent collateral Unicode regressions', async () => {
  const first = { detached: false, async evaluate() { return { ...expectedRows, '#latin': 'wrong' }; } };
  const second = { detached: false, async evaluate() { return { ...expectedRows, '#syriac': 'wrong' }; } };
  await assert.rejects(waitForLiveFrameTexts({ frames: () => [first, second] }, expectedRows,
    { timeoutMs: 0, label: 'history undo' }), /history undo did not reach exact authored Unicode.*last snapshot/);
});

test('do not swallow unexpected live-frame evaluation defects while polling', async () => {
  const frame = { detached: false, async evaluate() { throw Error('Invalid selector'); } };
  await assert.rejects(waitForLiveFrameTexts({ frames: () => [frame] }, expectedRows,
    { timeoutMs: 0 }), /Invalid selector/);
});
