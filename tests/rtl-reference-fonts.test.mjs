import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifiedDownload } from '../scripts/rtl-reference-fonts.mjs';

const bytes = Buffer.from('pinned fixture bytes');
const pin = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function fixture(sequence) {
  const delays = [], retries = [], requests = [];
  return {
    delays, retries, requests,
    async download(expected = pin) {
      return verifiedDownload('notosanshebrew', 'NotoSansHebrew[wdth,wght].ttf', expected, {
        request: async (url, options) => {
          assert.match(url, /06bfe0d62a98375cb09c942fa18e68bd32cff057\/ofl\/notosanshebrew\/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf$/);
          assert.ok(options.signal instanceof AbortSignal);
          requests.push(url);
          assert.ok(sequence.length, 'unexpected extra download');
          const next = sequence.shift();
          if (next instanceof Error) throw next;
          return next;
        },
        sleep: async ms => { delays.push(ms); },
        onRetry: item => { retries.push(item); },
      });
    },
  };
}
const unavailable = () => new Response('unavailable', { status: 503 });
const success = () => new Response(bytes);

test('three consecutive 503s recover using bounded spaced retries and exact pinned bytes', async () => {
  const f = fixture([unavailable(), unavailable(), unavailable(), success()]);
  assert.deepEqual(await f.download(), bytes);
  assert.deepEqual(f.delays, [2000, 8000, 25000]);
  assert.equal(f.requests.length, 4);
  assert.deepEqual(f.retries.map(r => r.attempt), [1, 2, 3]);
  assert(f.retries.every(r => r.error.message.includes('PINNED_FONT_HTTP_503')));
});

test('persistent 503 fails closed after four requests', async () => {
  const f = fixture(Array.from({ length: 4 }, unavailable));
  await assert.rejects(f.download(), /PINNED_FONT_HTTP_503/);
  assert.equal(f.requests.length, 4);
  assert.deepEqual(f.delays, [2000, 8000, 25000]);
});

test('permanent HTTP errors are not retried', async () => {
  for (const status of [400, 401, 403, 404]) {
    const f = fixture([new Response('permanent', { status })]);
    await assert.rejects(f.download(), new RegExp('PINNED_FONT_HTTP_' + status));
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.delays, []);
  }
});

test('wrong successful bytes fail immediately; never fetch another copy', async () => {
  const f = fixture([new Response('wrong bytes'), success()]);
  await assert.rejects(f.download(), /PINNED_FONT_INTEGRITY_MISMATCH/);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.delays, []);
});

test('transient fetch and response body errors retry, preserving byte verification', async () => {
  const bodyFailure = { ok: true, arrayBuffer: async () => { throw new TypeError('terminated'); } };
  const f = fixture([new DOMException('timeout', 'TimeoutError'), bodyFailure, success()]);
  assert.deepEqual(await f.download(), bytes);
  assert.deepEqual(f.delays, [2000, 8000]);
});

test('unexpected errors propagate without retry', async () => {
  const error = new Error('unexpected programming error');
  const f = fixture([error]);
  await assert.rejects(f.download(), actual => actual === error);
  assert.deepEqual(f.delays, []);
});
