import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rename, rmdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const busyCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
const absent = (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));

function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
async function retryBusy<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 2000;
  for (;;) {
    try { return await work(); }
    catch (error) {
      if (process.platform !== 'win32' || !busyCodes.has((error as NodeJS.ErrnoException).code!) || Date.now() >= deadline) throw error;
      await pause();
    }
  }
}
async function removeOwner(directory: string, owner?: string) {
  if (owner) await retryBusy(() => unlink(path.join(directory, owner))).catch(absent);
  try { await retryBusy(() => rmdir(directory)); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code!)) throw error; }
}
async function reclaim(directory: string) {
  const info = await lstat(directory).catch(absent);
  if (!info) return;
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Lock has no verifiable owner: ${directory}. Close all OpenMotion processes before removing this legacy lock.`);
  const owners = await readdir(directory).catch(error => { absent(error); return []; });
  if (!owners.length) return removeOwner(directory);
  if (owners.length !== 1 || !/^[1-9][0-9]*-[0-9a-f-]{36}\.owner$/.test(owners[0])) throw new Error('Invalid lock owner: ' + directory);
  const pid = Number(owners[0].split('-')[0]);
  if (Number.isSafeInteger(pid) && !alive(pid)) await removeOwner(directory, owners[0]);
}

export async function withProcessLock<T>(filename: string, work: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  await mkdir(path.dirname(filename), { recursive: true });
  const candidate = await mkdtemp(filename + '.taking-');
  const owner = `${process.pid}-${randomUUID()}.owner`;
  let held = false;
  try {
    await writeFile(path.join(candidate, owner), '', { mode: 0o600 });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // Publish a nonempty directory atomically; stale reclaimers cannot remove a new owner's marker.
      try { await rename(candidate, filename); held = true; break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code!;
        if (!['EEXIST', 'ENOTEMPTY', 'ENOTDIR', ...busyCodes].includes(code)) throw error;
        await retryBusy(() => reclaim(filename));
        if (Date.now() >= deadline) throw new Error('Timed out waiting for OpenMotion lock: ' + filename);
        await pause();
      }
    }
    return await work();
  } finally {
    if (held) await removeOwner(filename, owner);
    await rm(candidate, { recursive: true, force: true });
  }
}
