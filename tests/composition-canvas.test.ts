import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { pluginRoot } from '../hyperframes.ts';
import { Phase1Service } from '../phase1.ts';
import { canvasPresets, compositionCanvasSource } from '../shared/composition-canvas.ts';
import { loadCaptionSourceOperations } from '../shared/transcript-captions.ts';

const { parseHTML } = await loadCaptionSourceOperations(pluginRoot);
const source = '<!doctype html><html><head><style>#main > h1 { color:red }</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080"><h1 id="title" class="clip" data-start="1" data-duration="2" data-track-index="0">Keep &amp; animate</h1></div><script>window.__timelines={main:gsap.timeline({paused:true})};</script></body></html>';
test('all canvas presets preserve authored geometry, targets and timing through repeated fit changes', () => {
  let content = source;
  for (const preset of canvasPresets) for (const fit of ['contain', 'cover'] as const) {
    const result = compositionCanvasSource(content, parseHTML, { ratio: preset.ratio, fit }); content = result.content;
    assert.deepEqual(result.canvas, { ...preset, fit });
    const { document } = parseHTML(content), root = document.querySelector('[data-composition-id]')!;
    assert.equal(document.querySelectorAll('[data-canvas-frame]').length, 1);
    assert.equal(document.querySelectorAll('[data-canvas-content]').length, 1);
    assert.equal(document.querySelectorAll('[data-composition-id]').length, 1);
    assert.equal(root.getAttribute('data-duration'), '4');
    assert.equal(root.getAttribute('data-canvas-source-width'), '1920');
    assert.equal(document.querySelector('#main > h1')!.textContent, 'Keep & animate');
    assert.equal(document.querySelector('#title')!.getAttribute('data-start'), '1');
    assert.equal(document.querySelector('#title')!.getAttribute('data-duration'), '2');
    const scale = Math[fit === 'contain' ? 'min' : 'max'](preset.width / 1920, preset.height / 1080);
    assert.match(document.querySelector('[data-canvas-frame]')!.getAttribute('style')!, new RegExp(`scale\\(${scale}\\)`));
    assert.equal(compositionCanvasSource(content, parseHTML).canvas.fit, fit);
  }
  assert.throws(() => compositionCanvasSource('<div data-composition-id="main"></div>', parseHTML, { ratio: '9:16', fit: 'contain' }), /dimensions/);
});
test('public canvas editing persists and replays one version, rejects conflicts and restores original source', () => fixture(async store => {
  await writeFile(path.join(store.projectDirectory, 'index.html'), source);
  const service = new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const projectId = store.projectId, before = await service.call('openmotion_get_project', { projectId });
  const input = { projectId, requestId: 'portrait', expectedRevision: before.revision, expectedVersionId: before.currentVersionId, canvas: { compositionPath: 'index.html', ratio: '9:16', fit: 'contain' } };
  const saved = await service.call('openmotion_edit_project', input);
  assert.equal(saved.canvas.width, 1080); assert.equal(saved.canvas.height, 1920);
  assert.equal((await service.call('openmotion_edit_project', input)).replayed, true);
  assert.equal(compositionCanvasSource(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), parseHTML).canvas.ratio, '9:16');
  await assert.rejects(service.call('openmotion_edit_project', { ...input, requestId: 'stale-canvas', canvas: { ...input.canvas, ratio: '1:1' } }), /VERSION_CONFLICT/);
  const current = await service.call('openmotion_get_project', { projectId });
  await service.call('openmotion_restore_version', { projectId, requestId: 'undo-canvas', versionId: before.currentVersionId, expectedRevision: current.revision, expectedVersionId: current.currentVersionId });
  assert.equal(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), source);
}));
