import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DesignError, DesignProjects } from '../design-projects.ts';
import { readProjectZip } from '../shared/project-zip.ts';
import { browserExecutable } from '../browser.ts';

async function tempService() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-design-test-'));
  return { dir, service: new DesignProjects(dir), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('design project lifecycle: create blank/template, revision conflict, idempotency, versions and restore', async () => {
  const { service, cleanup } = await tempService();
  try {
    const created = await service.create({ requestId: 'req-create-1', scenario: 'prototype', title: 'Landing Demo', designSystemId: 'stripe' }, 'http://127.0.0.1:4100');
    assert.equal(created.scenario, 'prototype');
    assert.equal(created.title, 'Landing Demo');
    assert.equal(created.designSystemId, 'stripe');
    assert.equal(created.versionLabel, 'v1');
    assert(created.files.some(f => f.path === 'index.html'));
    assert(created.files.some(f => f.path === 'DESIGN.md'));
    assert(created.editorUrl.includes(`designProject=${created.id}`));

    // Replay same requestId returns identical project without duplicating.
    const replayed = await service.create({ requestId: 'req-create-1', scenario: 'prototype', title: 'Landing Demo', designSystemId: 'stripe' }, 'http://127.0.0.1:4100');
    assert.equal(replayed.id, created.id);
    assert.equal((await service.list()).length, 1);

    // Stale revision fails with VERSION_CONFLICT.
    await assert.rejects(
      () => service.write(created.id, { requestId: 'req-bad', expectedRevision: '0'.repeat(64), files: [{ path: 'index.html', content: '<h1>nope</h1>' }] }),
      (error: unknown) => error instanceof DesignError && error.code === 'VERSION_CONFLICT',
    );

    // Path traversal rejected.
    await assert.rejects(
      () => service.write(created.id, { requestId: 'req-trav', expectedRevision: created.revision, files: [{ path: '../evil.html', content: 'x' }] }),
      (error: unknown) => error instanceof DesignError && error.code === 'INVALID_ARGUMENT',
    );

    // Valid write creates v2.
    const w1 = await service.write(created.id, {
      requestId: 'req-w1', expectedRevision: created.revision,
      files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Version Two</h1></body></html>' }],
      summary: 'Update hero title', source: 'agent',
    });
    assert.equal(w1.version.label, 'v2');
    assert.equal(w1.project.versionLabel, 'v2');

    // Second write creates v3.
    const w2 = await service.write(created.id, {
      requestId: 'req-w2', expectedRevision: w1.project.revision,
      files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Version Three</h1></body></html>' }],
      summary: 'Update again', source: 'manual',
    });
    assert.equal(w2.version.label, 'v3');

    // Restoring v2 creates v4 while preserving v1, v2, v3.
    const restored = await service.restoreVersion(created.id, w1.version.id, { requestId: 'req-restore', expectedRevision: w2.project.revision });
    assert.equal(restored.version.label, 'v4');
    assert.equal(restored.version.source, 'restore');
    assert.equal(restored.version.restoredFrom, w1.version.id);
    const readBack = await service.readFile(created.id, 'index.html');
    assert(readBack.content.includes('Version Two'));

    const versions = await service.listVersions(created.id);
    assert.equal(versions.versions.length, 4);
    assert.equal(versions.versions[0].label, 'v4');
    assert.equal(versions.versions[3].label, 'v1');

    // Historical raw file read returns v3 bytes.
    const rawV3 = await service.readRawFile(created.id, 'index.html', w2.version.id);
    assert(rawV3.body.toString('utf8').includes('Version Three'));

    // Template creation works.
    const fromTpl = await service.create({ requestId: 'req-tpl', templateId: 'dashboard' });
    assert.equal(fromTpl.source, 'template');
    assert.equal(fromTpl.templateId, 'dashboard');
    assert(fromTpl.files.some(f => f.path === fromTpl.entry));

    // Rename, duplicate, trash, restore, delete.
    const renamed = await service.rename(created.id, { title: 'Renamed Demo', expectedTitle: 'Landing Demo', requestId: 'req-ren' });
    assert.equal(renamed.title, 'Renamed Demo');
    const dup = await service.duplicate(created.id, { requestId: 'req-dup' });
    assert.notEqual(dup.id, created.id);
    await assert.rejects(() => service.remove(dup.id, 'req-del-early'), (e: unknown) => e instanceof DesignError && e.code === 'INVALID_ARGUMENT');
    await service.trash(dup.id, 'req-trash');
    assert.equal((await service.list({ trashed: true })).length, 1);
    const removed = await service.remove(dup.id, 'req-del-ok');
    assert.equal(removed.deletedId, dup.id);
  } finally { await cleanup(); }
});

test('design comments support element/region/pen annotations and optimistic commentRevision', async () => {
  const { service, cleanup } = await tempService();
  try {
    const project = await service.create({ requestId: 'c-create', scenario: 'deck', title: 'Pitch Deck' });
    const created = await service.createComment(project.id, {
      requestId: 'c-1', expectedRevision: project.revision, text: 'Tighten headline spacing',
      anchor: {
        filePath: 'index.html',
        viewport: { id: 'desktop', width: 1440, height: 900 },
        slideIndex: 0,
        element: { selector: '.slide.active h1', tagName: 'h1', label: 'Headline', text: 'Pitch Deck', box: { x: 80, y: 120, width: 520, height: 72 } },
        annotation: { version: 1, coordinateSpace: 'normalized', width: 1440, height: 900, marks: [{ kind: 'rectangle', points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.25 }] }] },
      },
    });
    assert.equal(created.comment.status, 'open');
    assert.equal(created.comment.commentRevision, 1);

    // Resolve with right revision succeeds.
    const resolved = await service.updateComment(project.id, created.comment.id, { status: 'resolved', expectedCommentRevision: 1 });
    assert.equal(resolved.comment.status, 'resolved');
    assert.equal(resolved.comment.commentRevision, 2);

    // Stale commentRevision fails with COMMENT_CONFLICT.
    await assert.rejects(
      () => service.updateComment(project.id, created.comment.id, { status: 'open', expectedCommentRevision: 1 }),
      (error: unknown) => error instanceof DesignError && error.code === 'COMMENT_CONFLICT',
    );
  } finally { await cleanup(); }
});

test('export zip, open-design round-trip zip, standalone html, and import round-trip', async () => {
  const { dir, service, cleanup } = await tempService();
  try {
    const deck = await service.create({ requestId: 'exp-1', scenario: 'deck', title: 'Q4 Review', designSystemId: 'github' });
    // Add an extra CSS file and reference it from index.html so standalone HTML inlines it.
    const w = await service.write(deck.id, {
      requestId: 'exp-w', expectedRevision: deck.revision,
      files: [
        { path: 'extra.css', content: '.accent { color: #ff5500; }' },
        { path: 'index.html', content: (await service.readFile(deck.id, 'index.html')).content.replace('</head>', '<link rel="stylesheet" href="./extra.css" /></head>') },
      ],
    });

    // Standalone HTML inlines extra.css.
    const htmlExport = await service.exportProject(deck.id, { format: 'html' });
    const htmlStr = htmlExport.data.toString('utf8');
    assert(htmlStr.includes('.accent { color: #ff5500; }'), 'standalone html should inline local stylesheet');

    // Open Design ZIP includes manifest, handoff and .open-design/project.json.
    const odExport = await service.exportProject(deck.id, { format: 'open-design' });
    const entries = readProjectZip(odExport.data);
    assert(entries.has('DESIGN-MANIFEST.json'));
    assert(entries.has('DESIGN-HANDOFF.md'));
    assert(entries.has('.open-design/project.json'));
    const manifest = JSON.parse(entries.get('DESIGN-MANIFEST.json')!.toString('utf8'));
    assert.equal(manifest.schema, 'open-design.design-manifest.v1');
    assert.equal(manifest.title, 'Q4 Review');

    // Round-trip import from the exported Open Design ZIP preserves title, scenario and designSystemId.
    const zipFile = path.join(dir, 'roundtrip.zip');
    await writeFile(zipFile, odExport.data);
    const imported = await service.importPath(zipFile);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].title, 'Q4 Review');
    assert.equal(imported[0].scenario, 'deck');
    assert.equal(imported[0].designSystemId, 'github');
    assert.notEqual(imported[0].id, w.project.id);

    // Optional visual export check when Chrome is present on this machine.
    const chrome = await browserExecutable();
    if (chrome) {
      const pdf = await service.exportProject(deck.id, { format: 'pdf' });
      assert(pdf.data.subarray(0, 4).toString('utf8') === '%PDF');
      const pptx = await service.exportProject(deck.id, { format: 'pptx' });
      assert(pptx.data.subarray(0, 2).toString('utf8') === 'PK', 'pptx should be a valid zip container');
    }
  } finally { await cleanup(); }
});
