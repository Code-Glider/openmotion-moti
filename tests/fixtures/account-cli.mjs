#!/usr/bin/env node
// Synthetic account connector. Never contacts an account service or reads user credentials.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const home = process.env.AMR_HOME;
if (!home || !home.includes('motion-')) throw new Error('Use an isolated OpenMotion fixture directory');
mkdirSync(home, { recursive: true, mode: 0o700 });
const args = process.argv.slice(2), json = value => console.log(JSON.stringify(value));
const mode = () => existsSync(path.join(home, 'fixture-mode')) ? readFileSync(path.join(home, 'fixture-mode'), 'utf8') : '';
const target = path.join(home, 'config.json');
// Polling readers must see either absent/old credentials or the complete
// new JSON, never the truncate/write interval of a direct overwrite.
const publish = profile => {
  const temporary = target + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify({ profiles: { prod: profile } }), { mode: 0o600 });
  renameSync(temporary, target);
};
// Mirrors the connector's `jsonl-v1` stage lines, emitted only when the caller asks for them.
const stage = (name, result, errorKind) => {
  const id = process.env.OPEN_DESIGN_AMR_AUTH_ATTEMPT_ID;
  if (process.env.OPEN_DESIGN_AMR_AUTH_STAGE_FORMAT === 'jsonl-v1' && id) console.log('OPEN_DESIGN_AMR_AUTH_STAGE\t' + JSON.stringify({ schema_version: 1, auth_attempt_id: id, stage: name, result, ...(errorKind ? { error_kind: errorKind } : {}) }));
};
if (args[0] === 'login') {
  const scenario = mode();
  console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tstdin-v1');
  stage('attempt_started', 'started');
  if (scenario === 'login-create-failure') {
    stage('device_auth_create_result', 'failed', 'network_error');
    console.error('Error: start device authorization: private upstream data');
    process.exit(1);
  }
  stage('device_auth_create_result', 'success');
  console.log('Open this URL to continue:\nhttps://open-design.ai/activate?code=TEST-123\n\nCode: TEST-123');
  stage('activation_ready', 'success'); stage('browser_open_result', 'success');
  const timer = setInterval(() => {
    if (!existsSync(path.join(home, 'authorize'))) return;
    clearInterval(timer);
    if (scenario === 'login-denied') {
      console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tcancelled');
      stage('device_authorization_result', 'failed', 'oauth_denied');
      process.exit(1);
    }
    stage('device_authorization_result', 'success');
    // The connector returns without another stage when issued credentials lack their revocation ID.
    if (scenario === 'login-missing-key-id') process.exit(1);
    stage('token_exchange_result', 'success');
    const profile = { controlKey: 'synthetic-private-control-key', controlKeyId: 'fixture-control-key-id', runtimeKey: 'synthetic-private-account-key',
      user: { id: 'fixture-user-id', name: 'Fixture user', email: 'fixture@example.test' } };
    if (scenario === 'login-incomplete') delete profile.controlKey;
    // The connector stores credentials as pending until the caller accepts them and the service confirms the receipt.
    publish({ ...profile, pendingLogin: { deviceId: 'fixture-device' } });
    stage('credential_persist_result', 'success');
    console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tcredentials_persisted');
    process.stdin.once('data', data => {
      // A rejected receipt or a failed service confirmation rolls the attempt back.
      if (!String(data).includes('credentials_accepted') || scenario === 'login-complete-failure') { rmSync(target, { force: true }); process.exit(1); }
      publish(profile); process.exit(0);
    });
  }, 20);
} else if (args[0] === 'logout') process.exit(0);
else if (args[0] === 'billing') {
  const scenario = mode();
  if (scenario === 'billing-failure') { console.error('private upstream data'); process.exit(1); }
  if (scenario === 'billing-403') { console.error('Error: fetch billing summary: API request failed with status 403: workspace_billing_scope_locked'); process.exit(1); }
  if (scenario === 'billing-401') { console.error('Error: fetch billing summary: API request failed with status 401: invalid_api_key'); process.exit(1); }
  if (scenario === 'billing-502') { console.error('Error: fetch billing summary: API request failed with status 502'); process.exit(1); }
  if (scenario === 'billing-403-text') { console.error('Error: fetch billing summary: API request failed with status 403: rate-limited by edge'); process.exit(1); }
  json(scenario === 'billing-free' ? { membershipTier: null, balanceUsd: '0.00' } : { membershipTier: 'pro', balanceUsd: '12.50' });
} else if (args[0] === 'model') json({ source: 'remote', data: [{ id: 'language-one', enabled: true }, { id: 'disabled-one', enabled: false }] });
// The connector reports speech and music models as `audio_speech` / `audio_music`.
else if (args[0] === 'media') json({ models: [...['image', 'video', 'audio'].map(kind => ({ model: `fixture-${kind}`, kind: kind === 'audio' ? 'audio_speech' : kind, enabled: true })), { model: 'fixture-music', kind: 'audio_music' }] });
else if (args[1] === 'get') {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
  const bytes = args[0] === 'image' ? png : args[0] === 'audio' ? Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40)]) : Buffer.concat([Buffer.from('00000018667479706d703432000000006d703432', 'hex'), Buffer.alloc(32)]);
  writeFileSync(args[args.indexOf('--output') + 1], bytes);
  // A succeeded `image get` prints the downloaded asset instead of the task.
  json(args[0] === 'image' ? { asset_id: 'fixture-asset', status: 'ready', kind: 'image', mime_type: 'image/png', size_bytes: bytes.length } : { task_id: args[2], status: 'succeeded' });
} else if (['gen', 'speech'].includes(args[1])) {
  const file = path.join(home, 'submissions.json');
  const calls = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  calls.push(args); writeFileSync(file, JSON.stringify(calls));
  json({ task_id: `fixture-task-${calls.length}` });
} else process.exit(1);
