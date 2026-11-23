// A post-teardown Node event-loop leak must fail the real Studio gate instead
// of consuming the rest of the Actions job timeout with a green result.json.
// The unref'ed alarm never extends a clean test's lifetime.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export function armRtlPostCleanupWatchdog({ output, evidence, timeoutMs = 45_000 }) {
  if (!path.isAbsolute(output) || !evidence || typeof evidence !== 'object' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Invalid RTL post-cleanup watchdog configuration');
  }
  const alarm = setTimeout(async () => {
    const activeResources = process.getActiveResourcesInfo?.() ?? [];
    const activeHandles = (process._getActiveHandles?.() ?? [])
      .filter(handle => handle !== process.stdin && handle !== process.stdout && handle !== process.stderr)
      .map(handle => ({
        kind: handle.constructor?.name ?? 'unknown',
        listening: Boolean(handle.listening),
        refed: typeof handle.hasRef === 'function' ? handle.hasRef() : null,
      }));
    evidence.passed = false;
    evidence.postCleanupHang = { timeoutMs, activeResources, activeHandles };
    console.error('RTL post-cleanup event-loop leak: ' + JSON.stringify(evidence.postCleanupHang));
    try {
      await writeFile(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
    } catch (error) {
      console.error('Could not persist RTL post-cleanup diagnostic: ' + String(error));
    }
    // All owned cleanup has completed. A leaked handle must never count as a
    // successful CI qualification, nor consume the 12-minute job allowance.
    process.exit(1);
  }, timeoutMs);
  alarm.unref();
  return alarm;
}
