#!/usr/bin/env node
// Synthetic account connector. Never contacts an account service or reads user credentials.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const home = process.env.AMR_HOME;
if (!home || !home.includes('motion-')) throw new Error('Use an isolated OpenMotion fixture directory');
mkdirSync(home, { recursive: true, mode: 0o700 });
const args = process.argv.slice(2), json = value => console.log(JSON.stringify(value));
const mode = () => existsSync(path.join(home, 'fixture-mode')) ? readFileSync(path.join(home, 'fixture-mode'), 'utf8') : '';
if (args[0] === 'login') {
  console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tstdin-v1\nOpen this URL to continue:\nhttps://open-design.ai/activate?code=TEST-123\nCode: TEST-123');
  const timer = setInterval(() => {
    if (!existsSync(path.join(home, 'authorize'))) return;
    clearInterval(timer);
    // Polling readers must see either absent/old credentials or the complete
    // new JSON, never the truncate/write interval of a direct overwrite.
    const target = path.join(home, 'config.json'), temporary = target + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify({ profiles: { prod: { runtimeKey: 'synthetic-private-account-key', user: { name: 'Fixture user', email: 'fixture@example.test' } } } }), { mode: 0o600 });
    renameSync(temporary, target);
    console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tcredentials_persisted');
  }, 20);
  process.stdin.on('data', data => { if (String(data).includes('credentials_accepted')) process.exit(0); else process.exit(1); });
} else if (args[0] === 'logout') process.exit(0);
else if (args[0] === 'billing') {
  if (mode() === 'billing-failure') { console.error('private upstream data'); process.exit(1); }
  json({ membershipTier: 'pro', balanceUsd: '12.50' });
} else if (args[0] === 'model') json({ source: 'remote', data: [{ id: 'language-one', enabled: true }, { id: 'disabled-one', enabled: false }] });
else if (args[0] === 'media') json({ models: ['image', 'video', 'audio'].map(kind => ({ model: `fixture-${kind}`, kind, enabled: true })) });
else if (args[1] === 'get') {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
  const bytes = args[0] === 'image' ? png : args[0] === 'audio' ? Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40)]) : Buffer.concat([Buffer.from('00000018667479706d703432000000006d703432', 'hex'), Buffer.alloc(32)]);
  writeFileSync(args[args.indexOf('--output') + 1], bytes);
  json({ task_id: args[2], status: 'succeeded' });
} else if (['gen', 'speech'].includes(args[1])) {
  const file = path.join(home, 'submissions.json');
  const calls = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  calls.push(args); writeFileSync(file, JSON.stringify(calls));
  json({ task_id: `fixture-task-${calls.length}` });
} else process.exit(1);
