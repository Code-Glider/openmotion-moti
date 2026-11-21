// Cleanup of only the real Studio-to-MP4 test's owned temporary root.
// Windows may hold project files briefly after the browser and child exit;
// Node's built-in per-entry rm retries previously hid the locked path.
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const transient = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

export async function removeTemporaryRtlProject(directory, {
  remove = rm, sleep = delay, maxAttempts = 8, onRetry = () => {},
} = {}) {
  if (path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('openmotion-rtl-studio-export-')) {
    throw new Error('Refusing to remove a directory outside the owned RTL test root');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid cleanup attempt count');
  const retries = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Fail quickly with the real OS error; retry only at the top level.
      await remove(directory, { recursive: true, force: true, maxRetries: 0 });
      return { attempts: attempt, retries };
    } catch (error) {
      if (!transient.has(error?.code) || attempt === maxAttempts) throw error;
      const retry = { attempt, code: error.code, path: error.path || directory };
      retries.push(retry);
      onRetry(retry);
      await sleep(Math.min(attempt * 250, 1_500));
    }
  }
  throw new Error('Temporary project cleanup exhausted retries');
}
