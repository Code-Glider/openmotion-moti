import test from 'node:test';
import { mediaBytes } from './media-fixtures.ts';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixtures.ts';
import { gatewayFor } from '../gateway/service.ts';
import { ProviderConnections, connectionBaseUrl } from '../gateway/connections.ts';
import { OpenDesignAccount } from '../gateway/account.ts';
import { providerDirectory, setDefaultModel } from '../gateway/settings.ts';
import { mediaUse } from '../gateway/media-use.ts';
import type { Fetcher } from '../gateway/network.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
const binary = fileURLToPath(new URL('./fixtures/account-cli.mjs', import.meta.url));
async function until(check: () => Promise<boolean>) { for (let n = 0; n < 500; n++) { if (await check()) return; await delay(20); } throw new Error('Fixture timed out'); }
async function finish(store: any, id: string) { const g = gatewayFor(store); await g.tick(); await Promise.all([...g.active.values()].map(task => task.done)); return g.getJob(id); }
async function signIn(account: OpenDesignAccount) {
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(path.join(account.home, 'authorize'), 'yes');
  await until(async () => (await account.summary()).state === 'signed-in');
}

test('provider registry is searchable configuration; custom keys stay private and media routes execute once', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let submissions = 0;
  const fetcher: Fetcher = async (url, init = {}) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-custom-key');
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'language' }, { id: 'picture', architecture: { output_modalities: ['image'] } }] });
    assert.equal(String(url), 'https://provider.example/prefix/v1/images/generations');
    assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(String(init.body)), { model: 'picture', prompt: 'cup' });
    submissions++; return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  };
  gateway.options.fetcher = fetcher; gateway.connections = new ProviderConnections(store, fetcher);
  const id = await gateway.connections.configure(null, { label: 'My provider', protocol: 'openai', baseUrl: 'https://provider.example/prefix/v1/', apiKey: 'synthetic-custom-key' });
  await gateway.connections.sync(id);
  const directory = await providerDirectory(gateway);
  assert(directory.providers.length >= 70); assert.equal(directory.models.find(m => m.id === id + ':picture')?.kind, 'image');
  assert.doesNotMatch(JSON.stringify(directory), /synthetic-custom-key/);
  assert.equal((await stat(path.join(gateway.root, 'connection-secrets.json'))).mode & 0o777, 0o600);
  await setDefaultModel(gateway, 'image', id + ':picture');
  assert.equal((await providerDirectory(gateway)).defaults.image, id + ':picture');
  const guide = await mediaUse(store, { action: 'reference', provider: id }); assert.match(guide.content, /images\/generations/);
  const args = { action: 'generate', provider: id, model: 'picture', projectId: store.projectId, modality: 'image', prompt: 'cup', requestId: 'only-once' };
  const first = await mediaUse(store, args); const completed = await finish(store, first.job.id);
  assert.equal(completed.state, 'completed', completed.error); assert.equal(submissions, 1);
  assert.deepEqual(await readFile(path.join(store.projectDirectory, completed.assets[0].path)), png);
  assert.equal((await mediaUse(store, args)).job.id, first.job.id);
  await assert.rejects(gateway.connections.configure(id, { baseUrl: 'https://different.example/v1' }), /API key again/);
  const queued = await gateway.submit({ model: id + ':picture', modality: 'image', prompt: 'pending' });
  await gateway.connections.configure(id, { apiKey: 'replacement-key' });
  assert.match((await finish(store, queued.id)).error!, /configuration changed/); assert.equal(submissions, 1);
  await gateway.connections.updateModel(id + ':picture', false);
  await assert.rejects(setDefaultModel(gateway, 'image', id + ':picture'), /enabled model/);
  await gateway.connections.remove(id);
  assert(!(await gateway.connections.list()).some(provider => provider.id === id));
  assert(!JSON.parse(await readFile(path.join(gateway.root, 'connection-secrets.json'), 'utf8'))[id]);
  await gateway.close();
}));

for (const protocol of ['anthropic', 'google']) test(`${protocol} catalogue uses correct auth/pagination and keeps manual models`, () => fixture(async store => {
  let page = 0;
  const connections = new ProviderConnections(store, async (url, init) => {
    page++; const headers = new Headers(init?.headers);
    assert.equal(headers.get(protocol === 'google' ? 'x-goog-api-key' : 'x-api-key'), 'synthetic-key'); assert.equal(headers.get('Authorization'), null);
    if (page === 2) assert.match(String(url), protocol === 'google' ? /pageToken=next/ : /after_id=next/);
    return Response.json(protocol === 'google' ? { models: [{ name: 'models/model-' + page, displayName: 'Model ' + page }], ...(page === 1 ? { nextPageToken: 'next' } : {}) }
      : { data: [{ id: 'model-' + page }], has_more: page === 1, last_id: 'next' });
  });
  const id = await connections.configure(null, { label: 'API', protocol, baseUrl: 'https://models.example/v1', apiKey: 'synthetic-key' });
  await connections.saveModel(id, { modelId: 'manual', label: 'Manual', kind: 'text' });
  await connections.sync(id); assert.equal(page, 2); assert.equal((await connections.models()).length, 3);
}));

test('unsafe custom endpoints and failed catalogue sync cannot leak keys or erase configured models', () => fixture(async store => {
  for (const url of ['http://public.example/v1', 'https://127.0.0.1/v1', 'https://10.0.0.1/v1', 'https://user:secret@public.example/v1', 'https://public.example/v1?key=secret']) assert.throws(() => connectionBaseUrl(url));
  const connections = new ProviderConnections(store, async () => Response.json({ error: 'synthetic-secret' }, { status: 401 }));
  const id = await connections.configure(null, { label: 'API', protocol: 'openai', baseUrl: 'https://models.example/v1', apiKey: 'synthetic-secret' });
  await connections.saveModel(id, { modelId: 'manual', label: 'Manual', kind: 'image' });
  await assert.rejects(connections.sync(id), error => { assert.doesNotMatch(String(error), /synthetic-secret/); return true; });
  assert.equal((await connections.models()).length, 1);
}));

test('account device authorization, billing, remote models and all media outputs use the same isolated session', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1 });
  t.after(() => gateway.close());
  await mkdir(account.home, { recursive: true });
  await Promise.all((['video', 'audio'] as const).map(async kind => writeFile(path.join(account.home, `fixture-${kind}`), await mediaBytes(kind))));
  assert.equal((await account.summary()).state, 'signed-out');
  await signIn(account);
  const summary = await account.summary(true);
  assert.equal(summary.plan, 'pro'); assert.equal(summary.balance, '12.50'); assert.doesNotMatch(JSON.stringify(summary), /synthetic-private-account-key/);
  assert.equal((await stat(path.join(account.home, 'config.json'))).mode & 0o777, 0o600);
  const directory = await providerDirectory(gateway);
  assert(directory.providers.find(p => p.id === 'account')?.available); assert.equal(directory.models.find(m => m.modelId === 'disabled-one')?.enabled, false);
  for (const kind of ['image', 'video', 'audio'] as const) {
    const args = { action: 'generate', provider: 'account', model: `fixture-${kind}`, projectId: store.projectId, modality: kind, prompt: 'hello', parameters: kind === 'audio' ? { voice: 'test-voice' } : {}, requestId: 'account-' + kind };
    const queued = await mediaUse(store, args); const completed = await finish(store, queued.job.id);
    assert.equal(completed.state, 'completed', completed.error); assert.match(completed.remoteId!, /fixture-task-/);
    assert.equal((await mediaUse(store, args)).job.id, queued.job.id);
  }
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')).length, 3);
  await writeFile(path.join(account.home, 'fixture-mode'), 'billing-failure');
  assert.equal((await account.summary(true)).billingUnavailable, true);
  const queued = await gateway.submit({ model: 'account:fixture-image', modality: 'image', prompt: 'pending' });
  await account.logout(); assert.equal((await account.summary()).state, 'signed-out');
  assert.equal((await account.models()).length, 0);
  assert.equal((await finish(store, queued.id)).state, 'failed');
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')).length, 3);
  await gateway.close();
}));

test('cancelling account authorization cannot register a provider from a late completion', t => fixture(async store => {
  await chmod(binary, 0o755); const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  assert.equal((await account.summary()).userCode, 'TEST-123');
  await account.cancel(); await writeFile(path.join(account.home, 'authorize'), 'late'); await delay(50);
  assert.equal((await account.summary()).state, 'signed-out'); assert.equal(await account.identity(), undefined); account.close();
}));

test('a late catalogue response cannot replace models after a protocol change', () => fixture(async store => {
  let release!: (value: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; });
  let requested = false;
  const connections = new ProviderConnections(store, async () => { requested = true; return response; });
  const id = await connections.configure(null, { label: 'API', protocol: 'openai', baseUrl: 'https://models.example/v1', apiKey: 'synthetic-key' });
  await connections.saveModel(id, { modelId: 'manual', label: 'Manual', kind: 'text' });
  const sync = connections.sync(id);
  await until(async () => requested);
  await connections.configure(id, { protocol: 'anthropic' });
  const rejected = assert.rejects(sync, /Provider changed/);
  release(Response.json({ data: [{ id: 'late-model' }] })); await rejected;
  assert.deepEqual((await connections.models()).map(model => model.modelId), ['manual']);
}));

test('cancelling after credentials arrive cannot restore a session through a late model sync', t => fixture(async store => {
  const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  let release!: (value: string) => void, requested = false;
  const response = new Promise<string>(resolve => { release = resolve; });
  account.options.run = async args => {
    if (args[0] === 'model') { requested = true; return response; }
    return JSON.stringify({ models: [] });
  };
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(path.join(account.home, 'authorize'), 'yes'); await until(async () => requested);
  await account.cancel();
  release(JSON.stringify({ source: 'remote', data: [{ id: 'late-model' }] }));
  await delay(50);
  assert.equal((await account.summary()).state, 'signed-out');
  assert.equal(await account.identity(), undefined); assert.deepEqual(await account.models(), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(store.directory, 'account', 'models.json'), 'utf8')), []);
}));

test('account fixture publishes complete credentials while sign-in is being polled', t => fixture(async store => {
  await chmod(binary, 0o755);
  const started = path.join(store.directory, 'credential-write-started');
  const release = path.join(store.directory, 'allow-credential-publication');
  const preload = path.join(store.directory, 'pause-credential-write.mjs');
  await writeFile(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync;
fs.writeFileSync = (file, ...args) => {
  if (String(file).includes('config.json')) {
    write(file, '', args[1]);
    write(${JSON.stringify(started)}, 'ready');
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(${JSON.stringify(release)})) {
      if (Date.now() > deadline) throw new Error('Credential publication fixture timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  return write(file, ...args);
};
syncBuiltinESMExports();`);
  const spawnFixture = ((_command: string, args: readonly string[], options: SpawnOptions) =>
    spawn(process.execPath, ['--import', preload, binary, ...args], options)) as typeof spawn;
  const account = new OpenDesignAccount(store.directory, { binary, spawn: spawnFixture });
  t.after(() => account.close());
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(path.join(account.home, 'authorize'), 'yes');
  await until(async () => access(started).then(() => true, () => false));
  try { assert.equal((await account.summary()).state, 'authorizing'); }
  finally { await writeFile(release, 'continue'); }
  await until(async () => (await account.summary()).state === 'signed-in');
}));

test('an in-flight billing refresh cannot report an old account after sign-out', t => fixture(async store => {
  const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  await signIn(account); await account.summary(true);
  let release!: (value: string) => void, requested = false;
  const response = new Promise<string>(resolve => { release = resolve; });
  account.options.run = async args => { if (args[0] === 'billing') { requested = true; return response; } return '{}'; };
  const pending = account.summary(true); await until(async () => requested);
  await account.logout(); release(JSON.stringify({ membershipTier: 'pro', balanceUsd: '99.00' }));
  const summary = await pending;
  assert.equal(summary.state, 'signed-out'); assert.equal(summary.plan, undefined); assert.equal(summary.balance, undefined);
}));

test('model overrides survive catalogue sync and reach generation with per-request precedence', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const fetcher: Fetcher = async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'picture', context_length: 128000, architecture: { output_modalities: ['image'], input_modalities: ['text', 'image'] }, supported_parameters: ['reasoning', 'tools'] }] });
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'picture', prompt: 'cup', quality: 'high', size: '1024x1024' });
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  };
  gateway.options.fetcher = fetcher; gateway.connections = new ProviderConnections(store, fetcher);
  const provider = await gateway.connections.configure(null, { label: 'Test', protocol: 'openai', baseUrl: 'https://models.example/v1', apiKey: 'synthetic-key' });
  await gateway.connections.sync(provider);
  const id = provider + ':picture';
  const synced = (await providerDirectory(gateway)).models.find(model => model.id === id)!;
  assert.deepEqual(synced.inputs, ['vision']); assert.deepEqual(synced.capabilities, ['reasoning', 'tools']);
  await gateway.connections.updateMetadata(id, { label: 'My picture', group: 'Creative', contextWindow: null, capabilities: [], inputs: ['vision'], defaults: { quality: 'standard', size: '1024x1024' } });
  await gateway.connections.sync(provider);
  const edited = (await providerDirectory(gateway)).models.find(model => model.id === id)!;
  assert.equal(edited.label, 'My picture'); assert.equal(edited.group, 'Creative'); assert.equal(edited.contextWindow, null); assert.deepEqual(edited.capabilities, []);
  const job = await gateway.submit({ model: id, modality: 'image', prompt: 'cup', parameters: { quality: 'high' } });
  assert.equal((await finish(store, job.id)).state, 'completed');
  for (const invalid of [{ contextWindow: -1 }, { contextWindow: 128000, maxInputTokens: 200000 }, { inputs: ['unknown'] }, { defaults: { authorization: 'secret' } }, { defaults: [] }]) await assert.rejects(gateway.connections.updateMetadata(id, invalid));
  await gateway.connections.updateModel(id, null); assert.equal((await gateway.connections.modelOverrides())[id], undefined);
  await gateway.close();
}));
