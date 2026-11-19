import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Phase1Service } from '../phase1.ts';
import { WorkspaceStore } from '../workspace.ts';
import { phase1Tools } from '../shared/phase1-tools.ts';
import { createToolRegistry } from '../shared/mcp-registry.ts';
import { DESIGN_TOOL_NAMES } from '../shared/design-project.ts';
import { readWorkflowResource, workflowResources } from '../shared/workflow.ts';

test('MCP registry exposes 22 phase-1 tools including the 4 design tools and design workflow resources', async () => {
  assert.equal(phase1Tools.length, 22);
  const registry = createToolRegistry(phase1Tools, 'phase1');
  assert.equal(registry.tools.length, 22);
  for (const name of DESIGN_TOOL_NAMES) {
    assert(registry.tools.some(t => t.name === name), `missing tool ${name}`);
  }
  const resources = workflowResources();
  assert(resources.some(r => r.uri === 'openmotion://workflow/design/start'));
  assert(resources.some(r => r.uri === 'openmotion://workflow/design/iterate'));
  const start = await readWorkflowResource('openmotion://workflow/design/start', os.tmpdir());
  assert(start.text.includes('openmotion_design_project'));
});

test('Phase1Service dispatches all 4 openmotion_design_* tools end-to-end', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-design-mcp-'));
  try {
    const store = new WorkspaceStore(dir);
    const service = new Phase1Service(store, dir, {
      origin: () => 'http://127.0.0.1:4321',
      nativeUrl: () => undefined,
      openProject: async () => ({ studioUrl: 'http://127.0.0.1:4321' }),
      exportProject: async () => ({}),
      cancelExport: async () => ({}),
    });

    const cat = await service.call('openmotion_design_catalog', { action: 'list_scenarios' });
    assert.equal(cat.scenarios.length, 6);

    const created = await service.call('openmotion_design_project', {
      action: 'create', requestId: 'mcp-1', scenario: 'prototype', title: 'MCP Prototype', designSystemId: 'apple',
    });
    const pid = created.project.id;
    assert.equal(created.project.title, 'MCP Prototype');

    const edited = await service.call('openmotion_design_edit', {
      action: 'write', projectId: pid, requestId: 'mcp-w1', expectedRevision: created.project.revision,
      files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>From MCP</h1></body></html>' }],
      summary: 'MCP edit',
    });
    assert.equal(edited.version.label, 'v2');

    const comment = await service.call('openmotion_design_comments', {
      action: 'create', projectId: pid, requestId: 'mcp-c1', expectedRevision: edited.project.revision,
      text: 'Make title larger',
      anchor: { filePath: 'index.html', viewport: { id: 'mobile', width: 390, height: 844 } },
    });
    assert.equal(comment.comment.status, 'open');

    const resolved = await service.call('openmotion_design_comments', {
      action: 'update', projectId: pid, commentId: comment.comment.id, status: 'resolved', expectedCommentRevision: 1,
    });
    assert.equal(resolved.comment.status, 'resolved');

    const opened = await service.call('openmotion_design_project', { action: 'open', projectId: pid });
    assert.equal(opened.editorUrl, `http://127.0.0.1:4321/?page=design&scene=projects&designProject=${pid}`);
    assert.equal(opened.openComments, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
