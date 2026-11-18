import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installPublicSkill, skillsCliVersion } from '../scripts/install-public-skill.ts';

async function fixture(t: any) {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'openmotion-public-skill-'));
  t.after(() => rm(homeDirectory, { recursive: true, force: true }));
  const calls: { command: string; args: string[]; options: any }[] = [];
  return { homeDirectory, env: {}, calls, host: 'codex', run: async (command: string, args: string[], options: object) => { calls.push({ command, args, options }); } };
}

test('public Skill uses the pinned official CLI with the GitHub identity and only the selected host', async t => {
  const options = await fixture(t);
  const ref = 'a'.repeat(40);
  assert.equal((await installPublicSkill({ ...options, ref })).status, 'installed');
  assert.equal(options.calls.length, 1);
  const [call] = options.calls;
  assert.equal(call.command, process.execPath);
  assert.deepEqual(call.args.slice(1), ['exec', '--yes', '--package=skills@' + skillsCliVersion, '--', 'skills', 'add',
    'https://github.com/nexu-io/openmotion/tree/' + ref, '--skill', 'openmotion', '--global', '--agent', 'codex', '--copy', '--yes']);
  assert.equal(call.options.timeout, 120_000);
});

test('existing official entries are reused without an install event', async t => {
  const options = await fixture(t);
  const root = path.join(options.homeDirectory, '.agents');
  await mkdir(path.join(root, 'skills/openmotion'), { recursive: true });
  await writeFile(path.join(root, 'skills/openmotion/SKILL.md'), '---\nname: openmotion\ndescription: fixture\n---\n');
  await writeFile(path.join(root, '.skill-lock.json'), JSON.stringify({ version: 3, skills: { openmotion: { source: 'nexu-io/openmotion' } } }));
  assert.equal((await installPublicSkill(options)).status, 'present');
  assert.equal(options.calls.length, 0);
});

test('foreign entries and a stale lock over a runtime bundle never authorize overwriting files', async t => {
  const options = await fixture(t);
  const root = path.join(options.homeDirectory, '.agents');
  const directory = path.join(root, 'skills/openmotion');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'keep.txt'), 'foreign content');
  await assert.rejects(installPublicSkill(options), /not owned/);
  await writeFile(path.join(root, '.skill-lock.json'), JSON.stringify({ version: 3, skills: { openmotion: { source: 'nexu-io/openmotion' } } }));
  await assert.rejects(installPublicSkill(options), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'foreign content');
  assert.equal(options.calls.length, 0);
});

test('custom profiles, unsupported hosts and explicit skip do not write global Skills', async t => {
  const options = await fixture(t);
  for (const variant of [{ env: { CODEX_HOME: '/custom/profile' } }, { host: 'claude', env: { CLAUDE_CONFIG_DIR: '/custom/profile' } },
    { host: 'deepseek' }, { env: { OPENMOTION_SKIP_PUBLIC_SKILL: '1' } }]) {
    assert.equal((await installPublicSkill({ ...options, ...variant })).status, 'skipped');
  }
  assert.equal(options.calls.length, 0);
});

test('Claude installs only its agent and preserves official telemetry opt-outs', async t => {
  const options = await fixture(t);
  const env = { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  await installPublicSkill({ ...options, host: 'claude', env });
  assert.equal(options.calls[0].args.at(-3), 'claude-code');
  assert.deepEqual(options.calls[0].options.env, env);
});

test('XDG state lock is reused and CLI errors are reported without a second invocation', async t => {
  const options = await fixture(t);
  const state = path.join(options.homeDirectory, 'state');
  await mkdir(path.join(state, 'skills'), { recursive: true });
  await mkdir(path.join(options.homeDirectory, '.agents/skills/openmotion'), { recursive: true });
  await writeFile(path.join(options.homeDirectory, '.agents/skills/openmotion/SKILL.md'), '---\nname: openmotion\n---\n');
  await writeFile(path.join(state, 'skills/.skill-lock.json'), JSON.stringify({ version: 3, skills: { openmotion: { source: 'nexu-io/openmotion' } } }));
  assert.equal((await installPublicSkill({ ...options, env: { XDG_STATE_HOME: state } })).status, 'present');
  await assert.rejects(installPublicSkill({ ...options, homeDirectory: path.join(options.homeDirectory, 'empty'), run: async () => { throw new Error('offline'); } }), /offline/);
});
