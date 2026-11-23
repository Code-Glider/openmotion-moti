import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const helper = pathToFileURL(fileURLToPath(new URL('./rtl-post-cleanup-watchdog.mjs', import.meta.url))).href;
function exercise(leak) {
  const directory = mkdtempSync(path.join(tmpdir(), 'rtl-post-cleanup-watchdog-'));
  const code = [
    "import { writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    'import { armRtlPostCleanupWatchdog } from ' + JSON.stringify(helper) + ';',
    'const output = ' + JSON.stringify(directory) + ';',
    'const evidence = { passed: true, cleanup: { errors: [] } };',
    "await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence));",
    'armRtlPostCleanupWatchdog({ output, evidence, timeoutMs: 160 });',
    leak ? 'setInterval(() => {}, 5000);' : '',
  ].join('\n');
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      timeout: 6_000, encoding: 'utf8',
    });
    assert.equal(result.error, undefined, 'watchdog child must not hit outer process timeout');
    const evidence = JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8'));
    return { result, evidence };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('an unrefed post-cleanup watchdog does not delay clean Node exit or alter passing evidence', () => {
  const { result, evidence } = exercise(false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(evidence.passed, true);
  assert.equal(evidence.postCleanupHang, undefined);
});

test('a leaked post-cleanup event loop fails promptly and retains a real diagnostic', () => {
  const { result, evidence } = exercise(true);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /RTL post-cleanup event-loop leak/);
  assert.equal(evidence.passed, false);
  assert.equal(evidence.postCleanupHang.timeoutMs, 160);
  assert(evidence.postCleanupHang.activeResources.includes('Timeout'),
    'the leaked interval must be observable in the diagnostic');
  assert.deepEqual(evidence.cleanup, { errors: [] }, 'do not conceal primary cleanup receipts');
});
