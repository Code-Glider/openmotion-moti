// Cleanup of only the real Studio-to-MP4 test's owned temporary root.
// Windows may hold project files briefly after the browser and child exit;
// Node's built-in per-entry rm retries previously hid the locked path.
import { rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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

// Kill only the detached preview-server process tree created by THIS test.
// On Windows, Studio inherits a project directory as cwd and a live Studio
// child prevents rmdir even after the MCP child and Puppeteer have exited.
// A preview registry's PID alone is not sufficient: first verify that the
// live loopback service at its registered port owns this exact test root.
export async function stopOwnedWindowsPreviewTree(directory, previewUrl, {
  read = readFile, request = fetch, run = spawnSync, platform = process.platform,
} = {}) {
  if (platform !== 'win32') return { skipped: true };
  if (path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('openmotion-rtl-studio-export-')) {
    throw new Error('Refusing to terminate a process outside the owned RTL test root');
  }
  const address = new URL(previewUrl);
  if (!['localhost', '127.0.0.1'].includes(address.hostname) ||
      address.protocol !== 'http:' || !address.port ||
      address.username || address.password || address.pathname !== '/' ||
      address.hash || address.search) {
    throw new Error('Refusing to terminate an untrusted preview endpoint');
  }
  const registry = JSON.parse(await read(path.join(directory, 'preview.json'), 'utf8'));
  const port = Number(address.port);
  if (!Number.isSafeInteger(registry.pid) || registry.pid < 1 ||
      !Number.isSafeInteger(registry.port) || registry.port !== port) {
    throw new Error('Refusing to terminate a preview with invalid process identity');
  }
  const response = await request('http://127.0.0.1:' + port + '/api/health', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Preview ownership health check failed');
  const health = await response.json();
  if (health.service !== 'motion-preview' || health.protocol !== 2 ||
      path.resolve(health.dataDirectory || '') !== path.resolve(directory) ||
      health.version !== registry.version) {
    throw new Error('Refusing to terminate a preview that does not own this test root');
  }
  // taskkill /T handles Windows child processes that inherited the project
  // directory as cwd; the PID has been verified against the owned registry
  // AND the currently listening service, never supplied by a user.
  const terminated = run('taskkill.exe', ['/PID', String(registry.pid), '/T', '/F'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  if (terminated.error || terminated.status !== 0) {
    throw new Error('Failed to stop verified test-owned Windows preview tree: ' +
      (terminated.error?.message || terminated.stderr || terminated.stdout || 'unknown error'));
  }
  return { pid: registry.pid, port, stopped: true };
}
