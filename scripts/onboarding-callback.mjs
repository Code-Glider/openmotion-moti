import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { canonical, readJSON, runFile, sha256, withLock, writeJSON } from './runtime-assets.mjs';

// Public Codex queue API only. It targets the installation's calling chat and
// never resumes a different daemon, restarts a host or treats an ack as display.
export async function scheduleInstallationOnboarding({ appRoot, dataDirectory, version, onboarding, entry,
  codex = 'codex', threadId = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID }) {
  const unavailable = reason => ({ status: 'unavailable', reason, presentationVerified: false });
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(threadId || '')) return unavailable('CURRENT_CHAT_UNKNOWN');
  threadId = threadId.toLowerCase();
  const presentation = onboarding?.inlinePresentation;
  if (onboarding?.preview?.status !== 'ready' || presentation?.status !== 'prepared') return unavailable('PRESENTATION_NOT_READY');
  try {
    appRoot = await canonical(appRoot); dataDirectory = await canonical(dataDirectory);
    assert.equal(await sha256(presentation.path), presentation.sha256, 'Onboarding document changed before scheduling');
    const key = createHash('sha256').update(JSON.stringify({ threadId, appRoot, dataDirectory, version,
      resourceVersion: presentation.resourceVersion, language: presentation.language })).digest('hex');
    const directory = path.join(dataDirectory, 'onboarding', 'callbacks', key);
    await mkdir(directory, { recursive: true });
    return await withLock(path.join(directory, 'schedule.lock'), async () => {
      const stateFile = path.join(directory, 'callback.json'), previous = await readJSON(stateFile);
      // An uncertain CLI outcome may already have persisted a message. Retain
      // it for reconciliation instead of creating duplicate welcome turns.
      if (previous) return previous;
      const eventFile = path.join(directory, 'event.json');
      await writeJSON(eventFile, { schemaVersion: 1, kind: 'openmotion.installation.onboarding',
        entry, appRoot, dataDirectory, version, threadId, createdAt: new Date().toISOString(), onboarding });
      const intent = { status: 'scheduling', eventFile, threadId, presentationVerified: false };
      await writeJSON(stateFile, intent);
      const message = 'OpenMotion installation completed (automatic onboarding callback). Event file: '
        + JSON.stringify(eventFile) + '. Read that event and the installed .codex-plugin/onboarding/SKILL.md. '
        + 'Reuse this exact installation and workspace. Complete the already-authorized welcome, three full video cards and template-library presentation in this chat. '
        + 'This is a callback, not a request to reinstall, enqueue another callback, create a project or export. '
        + 'When the actual host supports inline HTML, publish the verified runtime document into this chat\'s explicitly permitted visualization directory using scripts/inline-onboarding.mjs --publish-from PATH --sha256 SHA256 --host-directory DIRECTORY. '
        + 'Do not emit a runtime/data path as a visualization reference. Open the event\'s real preview on the right and emit the published production content reference once. '
        + 'Otherwise use working native presentation. Queue acknowledgment is not visible delivery; report a real host failure honestly.';
      const args = ['queue', '--thread', threadId, '--message', message];
      try {
        const output = /\.[cm]?js$/i.test(codex)
          ? await runFile(process.execPath, [codex, ...args], { timeout: 10_000 })
          : await runFile(codex, args, { timeout: 10_000 });
        const match = output.match(/Queued message ([a-f0-9-]+) for thread ([a-f0-9-]+)\./i);
        assert(match && match[2] === threadId, 'No matching queue acknowledgment');
        const result = { ...intent, status: 'queued', queuedMessageId: match[1], queuedAt: new Date().toISOString() };
        await writeJSON(stateFile, result);
        return result;
      } catch {
        const result = { ...intent, status: 'uncertain', reason: 'QUEUE_FAILED_OR_ACK_UNCONFIRMED' };
        await writeJSON(stateFile, result);
        return result;
      }
    });
  } catch (error) { return unavailable(error.message); }
}
