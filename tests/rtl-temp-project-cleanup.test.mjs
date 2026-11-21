import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { removeTemporaryRtlProject, stopOwnedWindowsPreviewTree } from './rtl-temp-project-cleanup.mjs';

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

const originalPreviewUrl = 'http://localhost:23991';
const liveRegistry = { pid: 12412, port: 23991, version: '0.0.1' };
const goodHealth = { service: 'motion-preview', protocol: 2, version: '0.0.1', dataDirectory: directory };

test('stops only an identity-verified Windows test-owned preview process tree', async () => {
  let killed = 0;
  const outcome = await stopOwnedWindowsPreviewTree(directory, originalPreviewUrl, {
    platform: 'win32',
    read: async (file, encoding) => {
      assert.equal(file, path.join(directory, 'preview.json'));
      assert.equal(encoding, 'utf8');
      return JSON.stringify(liveRegistry);
    },
    request: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:23991/api/health');
      assert(options.signal);
      return { ok: true, json: async () => goodHealth };
    },
    run: (command, args, options) => {
      killed++;
      assert.equal(command, 'taskkill.exe');
      assert.deepEqual(args, ['/PID', '12412', '/T', '/F']);
      assert.equal(options.timeout, 15000);
      return { status: 0, stdout: 'SUCCESS' };
    },
  });
  assert.deepEqual(outcome, { pid: 12412, port: 23991, stopped: true });
  assert.equal(killed, 1);
});

test('rejects mismatched live workspace ownership without terminating any process', async () => {
  let killed = false;
  await assert.rejects(stopOwnedWindowsPreviewTree(directory, originalPreviewUrl, {
    platform: 'win32',
    read: async () => JSON.stringify(liveRegistry),
    request: async () => ({ ok: true, json: async () => ({ ...goodHealth, dataDirectory: path.join(tmpdir(), 'unrelated-project') }) }),
    run: () => { killed = true; throw new Error('should never kill'); },
  }), /does not own this test root/);
  assert.equal(killed, false);
});

test('rejects wrong PID/port and arbitrary preview URLs without terminating a process', async () => {
  let killed = false;
  const run = () => { killed = true; throw new Error('should never kill'); };
  await assert.rejects(stopOwnedWindowsPreviewTree(directory, originalPreviewUrl, {
    platform: 'win32', read: async () => JSON.stringify({ ...liveRegistry, port: 23992 }), run,
  }), /invalid process identity/);
  await assert.rejects(stopOwnedWindowsPreviewTree(directory, 'https://example.com:23991', {
    platform: 'win32', run,
  }), /untrusted preview endpoint/);
  assert.equal(killed, false);
});

test('non-Windows systems retain existing graceful preview shutdown', async () => {
  const result = await stopOwnedWindowsPreviewTree(directory, originalPreviewUrl, {
    platform: 'linux',
    read: async () => { throw new Error('unexpected read'); },
    request: async () => { throw new Error('unexpected request'); },
    run: () => { throw new Error('unexpected kill'); },
  });
  assert.deepEqual(result, { skipped: true });
});
