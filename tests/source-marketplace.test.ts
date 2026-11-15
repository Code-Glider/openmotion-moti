import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerSourceMarketplace, sourceMarketplacePlan } from '../scripts/source-marketplace.mjs';

async function fixture(t: any) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'om-marketplace-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = await realpath(temporary), previous = path.join(directory, 'previous'), root = path.join(directory, 'new');
  for (const source of [previous, root]) {
    await mkdir(path.join(source, '.agents/plugins'), { recursive: true });
    await mkdir(path.join(source, '.codex-plugin'));
    await writeFile(path.join(source, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'openmotion' }));
    await writeFile(path.join(source, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'openmotion-local',
      plugins: [{ name: 'openmotion', source: { source: 'local', path: './' } }] }));
  }
  const entry = { pluginId: 'openmotion@openmotion-local', marketplaceSource: { sourceType: 'local', source: previous } };
  return { directory, previous, root, entry };
}

test('an uninstalled, verified local source can be rebound while an installed source is preserved', async t => {
  const { previous, root, entry } = await fixture(t);
  assert.deepEqual(sourceMarketplacePlan(root, { installed: [], available: [entry] }), { action: 'replace_uninstalled_source', previous });
  assert.throws(() => sourceMarketplacePlan(root, { installed: [entry], available: [] }), /OPENMOTION_SOURCE_IN_USE/);
  assert.deepEqual(sourceMarketplacePlan(previous, { installed: [entry], available: [] }), { action: 'reuse' });
});

test('foreign entries, unknown sources and unrecognized catalogs are never replaced', async t => {
  const { previous, root, entry } = await fixture(t);
  for (const changed of [
    { ...entry, pluginId: 'someone-else@openmotion-local' },
    { ...entry, marketplaceSource: { sourceType: 'git', source: previous } },
  ]) assert.throws(() => sourceMarketplacePlan(root, { installed: [], available: [changed] }), /Refusing/);
  await writeFile(path.join(previous, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'other', plugins: [] }));
  assert.throws(() => sourceMarketplacePlan(root, { installed: [], available: [entry] }), /unrecognized/);
});

for (const fail of [false, true]) test(`registration ${fail ? 'restores the previous source after an add failure' : 'rebinds only the uninstalled OpenMotion source'}`, async t => {
  const { directory, previous, root, entry } = await fixture(t);
  const codex = path.join(directory, 'codex'), log = path.join(directory, 'calls.jsonl');
  await writeFile(codex, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[1] === 'list') console.log(${JSON.stringify(JSON.stringify({ installed: [], available: [entry] }))});
if (${fail} && args[2] === 'add' && args[3] === ${JSON.stringify(root)}) process.exit(2);
`, { mode: 0o755 });
  assert.equal(registerSourceMarketplace(root, { checkOnly: true, codex }).action, 'replace_uninstalled_source');
  let calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 1, 'preflight must not modify host configuration');
  if (fail) assert.throws(() => registerSourceMarketplace(root, { codex }));
  else assert.equal(registerSourceMarketplace(root, { codex }).action, 'replace_uninstalled_source');
  calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.slice(2), [
    ['plugin', 'marketplace', 'remove', 'openmotion-local'],
    ['plugin', 'marketplace', 'add', root],
    ...(fail ? [['plugin', 'marketplace', 'add', previous]] : []),
  ]);
  assert.equal(calls.some(args => args.includes('uninstall')), false);
});
