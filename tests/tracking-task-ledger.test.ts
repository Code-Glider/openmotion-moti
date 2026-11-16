import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskLedger } from '../tracking/task-ledger.ts';
import { validProperties } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';

test('task ledger persists accepted and terminal export state across instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-task-ledger-'));
  try {
    const taskId = crypto.randomUUID(), accepted = new Date().toISOString(), deadline = new Date(Date.now() + 1_000).toISOString();
    const first = new TaskLedger(directory);
    await first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: deadline });
    await first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: deadline });
    await assert.rejects(first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: new Date(Date.now() + 2_000).toISOString() }), /TASK_LEDGER_CONFLICT/);
    await first.terminal(taskId, 'success', 'true');
    const second = new TaskLedger(directory), snapshot = await second.snapshot();
    assert.equal(snapshot[taskId].outcome, 'success');
    assert.equal(snapshot[taskId].applied, 'true');
    assert.ok(snapshot[taskId].terminal_at);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('task ledger rejects malformed or conflicting terminal transitions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-task-ledger-'));
  try {
    const taskId = crypto.randomUUID(), ledger = new TaskLedger(directory), now = new Date().toISOString();
    await assert.rejects(ledger.accept({ task_id: 'bad', task_type: 'export', accepted_at: now, deadline_at: now }), /TASK_LEDGER_INVALID/);
    await ledger.accept({ task_id: taskId, task_type: 'export', accepted_at: now, deadline_at: now });
    await ledger.terminal(taskId, 'failure', 'unknown', 'EXPORT_FAILED');
    await assert.rejects(ledger.terminal(taskId, 'success', 'true'), /TASK_LEDGER_CONFLICT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('north-star evidence events keep closed, content-free schemas', () => {
  const projectId = crypto.randomUUID(), versionId = crypto.randomUUID(), runId = crypto.randomUUID(), checkId = crypto.randomUUID(), instanceId = crypto.randomUUID();
  assert.equal(validProperties(omEvents, 'host_run_started', { run_id: runId, entry_type: 'mcp', task_type: 'create' }), true);
  assert.equal(validProperties(omEvents, 'host_preview_observed', { run_id: runId, project_id: 'project', revision: 'a'.repeat(64), version_id: versionId, visibility: 'visible', content_verified: true, observation_source: 'host_reported' }), true);
  assert.equal(validProperties(omEvents, 'check_completed', { check_id: checkId, check_type: 'technical_export', project_id: projectId, version_id: versionId, subject_id: checkId.slice(0, 32), checklist_version: 'export-v1', checker_type: 'automated', result: 'pass' }), true);
  assert.equal(validProperties(omEvents, 'queue_snapshot', { instance_id: instanceId, task_type: 'export', queued_count: 0, running_count: 1, available_slots: 0, counts_complete: true }), true);
  assert.equal(validProperties(omEvents, 'incident_confirmed', { incident_id: crypto.randomUUID(), incident_type: 'false_success', severity: 'sev2', subject_id: checkId.slice(0, 32) }), true);
  assert.equal(validProperties(omEvents, 'host_preview_observed', { run_id: runId, project_id: 'project', revision: 'private/path', version_id: versionId, visibility: 'visible', content_verified: true, observation_source: 'host_reported' }), false);
});
