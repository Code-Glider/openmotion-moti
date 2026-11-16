import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mediaBytes } from './media-fixtures.ts';
import { fixture } from './fixtures.ts';
import { gatewayFor } from '../gateway/service.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot, execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import type { Fetcher } from '../gateway/network.ts';

const mp4 = await mediaBytes('video');
const audio = await mediaBytes('audio');
const catalogue = [
  { model: 'edit-image', kind: 'image', capabilities: { edits: true, max_input_images: 2, quality: { values: ['low', 'high'], default: 'low' } } },
  { model: 'one-ref', kind: 'image', capabilities: { edits: true, max_input_images: 1 } },
  { model: 'gen-only', kind: 'image', capabilities: {} },
  { model: 'i2v', kind: 'video', capabilities: { max_input_images: 1, durations: { values: [5, 10], default: 5 } } },
  { model: 't2v-only', kind: 'video', capabilities: {} },
];
function service(store: any) { return new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {} }); }
async function finish(store: any, id: string) { const g = gatewayFor(store); await g.tick(); await Promise.all([...g.active.values()].map(task => task.done)); return g.getJob(id); }
async function image(dir: string, name: string, color: string) {
  const file = path.join(dir, name);
  const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=32x24`, '-frames:v', '1', '-y', file], dir, 20_000);
  assert.equal(result.code, 0, result.stderr); return file;
}
async function libraryRef(store: any, name: string, color: string) {
  const asset = await new AssetLibrary(store).importFile(await image(store.directory, name, color), { requestId: name.replace(/\W/g, '-'), name });
  return { assetId: asset.id, versionId: asset.currentVersionId };
}

/** Records Cloud calls; uploads return ma_<n>, storage PUTs must not carry credentials. */
function cloud(gateway: any, onSubmit: (pathname: string, body: any) => void, task: Record<string, unknown> = {}) {
  const calls: string[] = []; let uploads = 0;
  gateway.options.fetcher = (async (url, init = {}) => {
    const target = new URL(String(url)), method = init.method ?? 'GET';
    calls.push(`${method} ${target.host === 'bucket.example' ? 'bucket' : target.pathname}`);
    if (target.host === 'bucket.example') {
      assert.equal(method, 'PUT'); assert.equal(new Headers(init.headers).get('Authorization'), null);
      assert.equal(new Headers(init.headers).get('Content-Type'), 'image/png');
      assert.equal(Number(new Headers(init.headers).get('Content-Length')), (init.body as Buffer).length);
      return new Response(null, { status: 200 });
    }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer cloud-key');
    if (target.pathname.endsWith('/models')) return Response.json({ models: catalogue });
    if (target.pathname.endsWith('/uploads')) return Response.json({ asset_id: `ma_${uploads}`, upload_url: `https://bucket.example/put/${uploads++}` }, { status: 201 });
    if (target.pathname.endsWith('/commit')) return Response.json({ status: 'ready' });
    if (method === 'POST') { onSubmit(target.pathname, JSON.parse(String(init.body))); return Response.json({ task_id: 'cloud-task' }, { status: 202 }); }
    if (target.pathname.endsWith('/content')) return new Response(mp4);
    return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/output' }], ...task });
  }) as Fetcher;
  return calls;
}

test('Cloud discovery exposes edit references, first-frame input and native options', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  cloud(gateway, () => assert.fail('discovery must not submit'));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const models = (await gateway.listModels({ provider: 'opendesign', refresh: true })).models;
  const pick = (id: string) => models.find(m => m.modelId === id)!;
  assert.deepEqual([pick('edit-image').supportsImageReference, pick('edit-image').maxInputImages], [true, 2]);
  assert.deepEqual((pick('edit-image').nativeOptions as any).quality.values, ['low', 'high']);
  assert.equal(pick('gen-only').supportsImageReference, undefined);
  assert.deepEqual([pick('i2v').supportsImageReference, pick('i2v').maxInputImages], [undefined, 1]);
  assert.equal(pick('t2v-only').maxInputImages, undefined);
  await gateway.close();
}));

test('Cloud image editing uploads every library reference and submits their asset IDs to /images/edits', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.download = async () => (await import('node:fs/promises')).readFile(await image(store.directory, 'out.png', 'green'));
  const submits: [string, any][] = [];
  const calls = cloud(gateway, (p, body) => submits.push([p, body]));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const a = await libraryRef(store, 'a.png', 'red'), b = await libraryRef(store, 'b.png', 'blue');
  const job = await finish(store, (await gateway.submit({ library: { references: [a, b] }, model: 'opendesign:edit-image', modality: 'image', prompt: 'make the plate red', parameters: { quality: 'low' } })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(submits, [['/api/v1/media/images/edits', { quality: 'low', model: 'edit-image', prompt: 'make the plate red', images: ['ma_0', 'ma_1'] }]]);
  assert.deepEqual(calls.filter(c => !c.includes('/models') && !c.includes('/tasks/')), ['POST /api/v1/media/uploads', 'PUT bucket', 'POST /api/v1/media/uploads/ma_0/commit',
    'POST /api/v1/media/uploads', 'PUT bucket', 'POST /api/v1/media/uploads/ma_1/commit', 'POST /api/v1/media/images/edits']);
  assert.deepEqual(job.references!.map(r => r.path), [`asset:${a.assetId}/${a.versionId}`, `asset:${b.assetId}/${b.versionId}`]);
  assert.equal(job.reference!.path, job.references![0].path);
  await gateway.close();
}));

test('reference counts follow each model: the published maximum, no edits, no video input image', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let submitted = 0; cloud(gateway, () => submitted++);
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const a = await libraryRef(store, 'a.png', 'red'), b = await libraryRef(store, 'b.png', 'blue');
  await assert.rejects(gateway.submit({ library: { references: [a, b] }, model: 'opendesign:one-ref', modality: 'image', prompt: 'x' }), /at most 1 input image$/);
  await assert.rejects(gateway.submit({ library: { references: [a] }, model: 'opendesign:gen-only', modality: 'image', prompt: 'x' }), /does not support asset references/);
  await assert.rejects(gateway.submit({ library: { references: [a] }, model: 'opendesign:t2v-only', modality: 'video', prompt: 'x' }), /does not accept an input image/);
  await assert.rejects(gateway.submit({ library: { references: [a, b] }, model: 'opendesign:i2v', modality: 'video', prompt: 'x' }), /at most 1 input image$/);
  assert.equal(submitted, 0);
  await gateway.close();
}));

test('Cloud image-to-video uploads the first frame and keeps the video timeout above fifteen minutes', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  const submits: [string, any][] = []; cloud(gateway, (p, body) => submits.push([p, body]));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const a = await libraryRef(store, 'frame.png', 'red');
  const job = await finish(store, (await gateway.submit({ library: { references: [a] }, model: 'opendesign:i2v', modality: 'video', prompt: 'slow push in', parameters: { duration: 5 } })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(submits, [['/api/v1/media/videos/tasks', { duration: 5, model: 'i2v', prompt: 'slow push in', images: [{ asset_id: 'ma_0', role: 'first_frame' }] }]]);
  const source = await (await import('node:fs/promises')).readFile(new URL('../gateway/service.ts', import.meta.url), 'utf8');
  assert.match(source, /job\.modality === 'video' \? 30 : 15\) \* 60_000/);
  await gateway.close();
}));

test('Cloud speech timestamps stay on the job and reach the MCP status result', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.download = async () => audio;
  const alignment = { characters: ['你', '好'], character_start_times_seconds: [0, 0.2], character_end_times_seconds: [0.2, 0.4] };
  const submits: [string, any][] = []; cloud(gateway, (p, body) => submits.push([p, body]), { result: { alignment } });
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const queued = await api.call('openmotion_media_use', { action: 'generate', provider: 'opendesign', projectId: store.projectId, requestId: 'speech-ts', model: 'elevenlabs-v3',
    modality: 'audio', mode: 'text-to-speech', prompt: '你好', parameters: { voice: 'voice-1', voice_settings: { speed: 1.1 } } });
  const job = await finish(store, queued.job.id); assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(submits, [['/api/v1/media/audio/speech', { model: 'elevenlabs-v3', voice: 'voice-1', parameters: { voice_settings: { speed: 1.1 }, text: '你好' } }]]);
  const status = await api.call('openmotion_media_use', { action: 'status', projectId: store.projectId, jobId: job.id });
  assert.deepEqual(status.job.result, { alignment });
  await gateway.close();
}));

test('a dropped Cloud poll or download connection is retried instead of discarding a paid result', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let polls = 0, downloads = 0, posts = 0;
  gateway.options.download = async () => { if (++downloads === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); return audio; };
  gateway.options.fetcher = (async (url, init = {}) => {
    if (init.method === 'POST') { posts++; return Response.json({ task_id: 'cloud-task' }, { status: 202 }); }
    if (++polls === 1) throw new Error('socket hang up');
    if (polls === 2) return new Response('busy', { status: 503 });
    return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/output' }] });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:elevenlabs-music-v2', modality: 'audio', prompt: 'calm piano' })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual([posts, polls, downloads], [1, 3, 2]);
  await gateway.close();
}));

test('a rejected Cloud poll is not retried', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let polls = 0;
  gateway.options.fetcher = (async (_url, init = {}) => {
    if (init.method === 'POST') return Response.json({ task_id: 'cloud-task' }, { status: 202 });
    polls++; return new Response('nope', { status: 401 });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:elevenlabs-music-v2', modality: 'audio', prompt: 'calm piano' })).id);
  assert.equal(job.state, 'failed'); assert.match(job.error!, /401/); assert.equal(polls, 1);
  await gateway.close();
}));
