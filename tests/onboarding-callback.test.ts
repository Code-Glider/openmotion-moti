import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scheduleInstallationOnboarding } from '../scripts/onboarding-callback.mjs';

test('installation queues one workspace-bound callback in the calling chat without starting another host', async t => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'motion-callback-'));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const log = path.join(dataDirectory, 'queue.jsonl'), codex = path.join(dataDirectory, 'codex.mjs');
  await writeFile(codex, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n'); console.log('Queued message 11111111-1111-1111-1111-111111111111 for thread 22222222-2222-2222-2222-222222222222.');`);
  const fragment = path.join(dataDirectory, 'welcome.html');
  await writeFile(fragment, 'verified production fixture');
  const onboarding = { preview: { status: 'ready', previewUrl: 'http://127.0.0.1:4173/?templates=1' }, inlinePresentation: {
    status: 'prepared', path: fragment, sha256: createHash('sha256').update('verified production fixture').digest('hex'),
    resourceVersion: 'fixed', language: 'zh', templateIds: ['product-promo', 'nyt-graph', 'decision-tree'],
  } };
  const options = { appRoot: dataDirectory, dataDirectory, version: '1.2.3', entry: 'npm', codex,
    threadId: '22222222-2222-2222-2222-222222222222', onboarding };
  const first = await scheduleInstallationOnboarding(options);
  assert.equal(first.status, 'queued');
  assert.equal(first.presentationVerified, false);
  const event = JSON.parse(await readFile(first.eventFile, 'utf8'));
  assert.equal(event.dataDirectory, await realpath(dataDirectory));
  assert.equal(event.appRoot, await realpath(dataDirectory));
  assert.equal(event.version, '1.2.3');
  const second = await scheduleInstallationOnboarding(options);
  assert.equal(second.status, 'queued');
  assert.equal(second.eventFile, first.eventFile);
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['queue', '--thread', options.threadId]);
  assert(!calls[0].includes('--resume') && !calls[0].includes('app-server'));
  assert(calls[0][4].includes(first.eventFile));
});

test('an unknown chat or incomplete presentation cannot enqueue an onboarding callback', async () => {
  const missing = await scheduleInstallationOnboarding({ threadId: '', onboarding: {} });
  assert.equal(missing.status, 'unavailable');
  const incomplete = await scheduleInstallationOnboarding({ threadId: '22222222-2222-2222-2222-222222222222', onboarding: { preview: { status: 'unavailable' } } });
  assert.equal(incomplete.status, 'unavailable');
});
