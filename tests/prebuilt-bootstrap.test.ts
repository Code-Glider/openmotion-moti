import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../install.sh', import.meta.url));
test('retired package arguments fail before downloads or host changes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-source-only-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'), log = path.join(directory, 'commands');
  await mkdir(bin);
  for (const command of ['npm', 'git', 'curl', 'codex']) {
    await writeFile(path.join(bin, command), '#!/bin/sh\necho called >> "$OM_TEST_LOG"\nexit 0\n', { mode: 0o755 });
  }
  for (const args of [['--package', '@openmotion/app@1.2.3'], ['--package', '/tmp/candidate.tgz'], ['--unknown']]) {
    const result = spawnSync('bash', [entry, ...args], { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, OM_TEST_LOG: log } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Source installation only/);
    await assert.rejects(access(log), { code: 'ENOENT' });
  }
});

test('npm release entry points are disabled while legacy recovery code stays readable', async () => {
  for (const [file, job] of [['motion-candidate.yml', 'candidate'], ['motion-publish-test.yml', 'verify'], ['motion-publication-recovery.yml', 'select-ref']]) {
    const workflow = await readFile(new URL('../.github/workflows/' + file, import.meta.url), 'utf8');
    const block = workflow.split('  ' + job + ':')[1]?.split(/\n  [a-z][a-z-]*:/)[0];
    assert.match(block || '', /if: \$\{\{ false \}\}/, file);
  }
});
