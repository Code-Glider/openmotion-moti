import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';
import { gatewayFor, ModelGateway } from '../gateway/service.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { mediaUse } from '../gateway/media-use.ts';

const input = (requestId: string) => ({ modality: 'image' as const, model: 'codex:image-generation', prompt: 'Fixture only', idempotencyKey: requestId, library: {} });
function setup(store: any) {
  const gateway = gatewayFor(store);
  gateway.options.detect = async () => [{ id: 'codex', label: 'Codex', installed: true, authenticated: true, available: true, imageGeneration: true, reason: 'fixture' }];
  return gateway;
}
function api(store: any) { return new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {} }); }

test('generation limit persists through settings HTTP, validates bounds and defaults to thirty', () => fixture(async store => {
  const gateway = setup(store), request = transport(store), url = '/motion-api/settings/generation-limit';
  assert.deepEqual(await (await request(url)).json(), { limit: 30, used: 0, windowHours: 24 });
  for (const limit of [0, 500, 2]) {
    const saved = await request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit }) });
    assert.equal(saved.status, 200); assert.equal((await saved.json()).limit, limit);
    assert.equal((await new ModelGateway(store).generationLimit()).limit, limit);
  }
  for (const value of [{ limit: -1 }, { limit: 501 }, { limit: 1.5 }, { limit: '2' }, {}, { limit: 2, bypass: true }]) {
    assert.equal((await request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })).status, 400);
  }
  assert.equal((await request(url, { method: 'PUT', body: '{\"limit\":0}' })).status, 400, 'Settings writes require the shared application/json validation');
  assert.equal((await gateway.generationLimit()).limit, 2);
  for (const contents of ['{broken', 'null', '{"limit":501}']) {
    await writeFile(path.join(gateway.root, 'generation-limit.json'), contents);
    const broken = await request(url); assert.equal(broken.status, 400);
    assert.match((await broken.json()).error, /Settings > Model providers > Generation limit and save it again/);
    assert.equal((await request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"limit":2}' })).status, 200);
  }
}, false));

test('one workspace limit counts every terminal state, preserves replays and serializes concurrent submissions', () => fixture(async store => {
  const gateway = setup(store);
  await gateway.setGenerationLimit({ limit: 3 });
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => gateway.submit(input(`parallel-${n}`))));
  const accepted = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map(r => r.value);
  assert.equal(accepted.length, 3);
  for (const result of results.filter(r => r.status === 'rejected')) assert.equal((result as PromiseRejectedResult).reason.code, 'GENERATION_LIMIT_REACHED');
  assert.equal((await gateway.submit(input(accepted[0].idempotencyKey))).id, accepted[0].id);
  for (const [n, state] of ['completed', 'failed', 'cancelled'].entries()) {
    const file = path.join(gateway.root, 'jobs', accepted[n].id + '.json');
    const job = JSON.parse(await readFile(file, 'utf8')); job.state = state; await writeFile(file, JSON.stringify(job));
  }
  assert.equal((await gateway.generationLimit()).used, 3);
  await assert.rejects(gateway.submit(input('another')), /GENERATION_LIMIT_REACHED.*3 of 3/);
  assert.equal((await gateway.submit(input(accepted[1].idempotencyKey))).id, accepted[1].id);
  assert.equal((await gateway.generationLimit()).used, 3);
  await assert.rejects(gateway.submit({ ...input('invalid'), prompt: '' }));
  assert.equal((await gateway.generationLimit()).used, 3);
}, false));

test('the default thirty includes cancelled jobs and applies without an explicit setting', () => fixture(async store => {
  const gateway = setup(store);
  for (let n = 0; n < 30; n++) await gateway.cancel((await gateway.submit(input(`default-${n}`))).id);
  await assert.rejects(gateway.submit(input('default-over-limit')), /GENERATION_LIMIT_REACHED.*30 of 30/);
  assert.deepEqual(await gateway.generationLimit(), { limit: 30, used: 30, windowHours: 24 });
}, false));

test('rolling window expires old jobs; zero disables only the submission limit', () => fixture(async store => {
  const gateway = setup(store);
  await gateway.setGenerationLimit({ limit: 1 });
  const first = await gateway.submit(input('first')); await gateway.cancel(first.id);
  await assert.rejects(gateway.submit(input('second')), /GENERATION_LIMIT_REACHED/);
  const file = path.join(gateway.root, 'jobs', first.id + '.json');
  const previous = JSON.parse(await readFile(file, 'utf8')); previous.createdAt = Date.now() - 24 * 60 * 60_000 - 1000;
  await writeFile(file, JSON.stringify(previous));
  assert.equal((await gateway.generationLimit()).used, 0);
  await gateway.submit(input('second'));
  await gateway.setGenerationLimit({ limit: 0 });
  await gateway.submit(input('third')); assert.equal((await gateway.generationLimit()).used, 2);
}, false));

test('asset aliases share receipts; MCP and direct HTTP cannot override the configured limit', () => fixture(async store => {
  const gateway = setup(store), service = api(store), request = transport(store, { studio: { alive: () => true } } as any);
  await gateway.setGenerationLimit({ limit: 1 });
  const args = { action: 'generate', requestId: 'same', model: 'codex:image-generation', modality: 'image', prompt: 'Fixture only' };
  const first = await service.call('openmotion_assets_use', args);
  assert.equal((await service.call('openmotion_assets', args)).job.id, first.job.id);
  await assert.rejects(service.call('openmotion_assets_use', { ...args, requestId: 'new', limit: 0 }), /INVALID_ARGUMENT/);
  await assert.rejects(service.call('openmotion_assets_use', { ...args, requestId: 'new' }), /GENERATION_LIMIT_REACHED/);
  const response = await request('/motion-api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input('http'), limit: 0 }) });
  assert.equal(response.status, 400); const error = await response.json(); assert.match(error.error, /GENERATION_LIMIT_REACHED/); assert.equal(error.code, 'GENERATION_LIMIT_REACHED');
  assert.equal((await gateway.generationLimit()).limit, 1); assert.equal((await gateway.generationLimit()).used, 1);
}, false));

test('new project jobs are visible from Assets; library jobs retain their separate project ownership', () => fixture(async store => {
  const gateway = setup(store), service = api(store);
  // No worker is ticked: these fixtures only queue, inspect and cancel local jobs.
  await gateway.configureProvider('fal', { apiKey: 'synthetic-fixture-only' });
  const project = (await mediaUse(store, { action: 'generate', provider: 'fal', model: 'fal-ai/flux/schnell', requestId: 'same-id', projectId: store.projectId, modality: 'image', prompt: 'Fixture only' })).job;
  assert.equal((await mediaUse(store, { action: 'status', projectId: store.projectId, jobId: project.id })).job.id, project.id);
  assert.equal((await service.call('openmotion_assets_use', { action: 'status', jobId: project.id })).job.id, project.id);
  assert.ok((await service.call('openmotion_assets_use', { action: 'jobs' })).jobs.some((j: any) => j.id === project.id));
  const library = await service.call('openmotion_assets_use', { action: 'generate', requestId: 'same-id', model: 'fal:fal-ai/flux/schnell', modality: 'image', prompt: 'Fixture only' });
  assert.notEqual(library.job.id, project.id, 'Changing the destination does not replay a different request');
  await assert.rejects(mediaUse(store, { action: 'status', projectId: store.projectId, jobId: library.job.id }), /GENERATION_NOT_FOUND/);
  assert.equal((await gateway.generationLimit()).used, 2);
}));
