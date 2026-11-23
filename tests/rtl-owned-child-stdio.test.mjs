import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { releaseExitedOwnedChildStdio } from './rtl-owned-child-stdio.mjs';

// An explicitly owned grandchild inheriting stdout/stderr leaves the
// exited parent's PipeWrap resources open. Reproduce the resource class
// observed in macOS Studio WOFF1 without launching Chrome or the editor.
test('release only exited owned child pipes, including inherited handles', async () => {
  const program = [
    "const { spawn } = require('node:child_process');",
    "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'],",
    "  { stdio: ['ignore', process.stdout, process.stderr] });",
    'console.log(grandchild.pid);',
    'grandchild.unref();',
  ].join('\n');
  const child = spawn(process.execPath, ['-e', program], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  try {
    assert.throws(() => releaseExitedOwnedChildStdio(child, 'MCP'), /running child/);
    await once(child, 'exit');
    assert.equal(child.exitCode, 0);
    const result = releaseExitedOwnedChildStdio(child, 'MCP');
    assert.equal(result.label, 'MCP');
    assert.equal(result.exitCode, 0);
    assert(result.released.includes('stdout') && result.released.includes('stderr'),
      'inherited pipes must be released on the exited child');
    assert(child.stdout.destroyed && child.stderr.destroyed);
    assert.deepEqual(releaseExitedOwnedChildStdio(child, 'MCP').released, [],
      'exited stdio cleanup must be idempotent');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    const descendantPid = Number(stdout.trim());
    if (Number.isSafeInteger(descendantPid) && descendantPid > 0) {
      try { process.kill(descendantPid, 'SIGTERM'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
});

test('refuse invalid or running process, including missing ownership labels', () => {
  assert.throws(() => releaseExitedOwnedChildStdio(null, 'MCP'), /required/);
  assert.throws(() => releaseExitedOwnedChildStdio({ exitCode: 0, signalCode: null }, ''), /required/);
  assert.throws(() => releaseExitedOwnedChildStdio({ exitCode: null, signalCode: null }, 'Chromium'), /running child/);
});
