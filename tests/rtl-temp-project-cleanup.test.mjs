import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { removeTemporaryRtlProject } from './rtl-temp-project-cleanup.mjs';

const directory = path.join(tmpdir(), 'openmotion-rtl-studio-export-unit');

test('transient locked files get explicit bounded top-level retries', async () => {
  let calls = 0;
  const delays = [], retries = [];
  const result = await removeTemporaryRtlProject(directory, {
    remove: async (target, options) => {
      assert.equal(target, directory);
      assert.deepEqual(options, { recursive: true, force: true, maxRetries: 0 });
      if (++calls < 3) throw Object.assign(new Error('fixture lock'), {
        code: calls === 1 ? 'EBUSY' : 'ENOTEMPTY', path: path.join(directory, 'font.ttf'),
      });
    },
    sleep: async ms => { delays.push(ms); },
    onRetry: item => { retries.push(item); },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.deepEqual(result, { attempts: 3, retries });
  assert.deepEqual(retries.map(item => item.code), ['EBUSY', 'ENOTEMPTY']);
  assert(retries.every(item => item.path === path.join(directory, 'font.ttf')));
});

test('persistent lock fails closed with exact underlying OS error', async () => {
  const error = Object.assign(new Error('locked font'), { code: 'EPERM', path: path.join(directory, 'font.ttf') });
  let calls = 0;
  await assert.rejects(removeTemporaryRtlProject(directory, {
    maxAttempts: 3, remove: async () => { calls++; throw error; }, sleep: async () => {},
  }), thrown => thrown === error);
  assert.equal(calls, 3);
});

test('unexpected I/O errors are never hidden or retried', async () => {
  const error = Object.assign(new Error('disk I/O'), { code: 'EIO' });
  let calls = 0;
  await assert.rejects(removeTemporaryRtlProject(directory, {
    remove: async () => { calls++; throw error; },
    sleep: async () => { throw new Error('must not sleep'); },
  }), thrown => thrown === error);
  assert.equal(calls, 1);
});

test('refuses arbitrary recursive deletion targets', async () => {
  let called = false;
  await assert.rejects(removeTemporaryRtlProject(tmpdir(), {
    remove: async () => { called = true; },
  }), /Refusing to remove/);
  assert.equal(called, false);
});
