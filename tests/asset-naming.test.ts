import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';

const api = (store: any) => new Phase1Service(store, pluginRoot, {
  origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {},
});

test('project naming language and metadata-only asset renames survive reads, retries and conflicts', () => fixture(async store => {
  const service = api(store);
  const project = await service.call('openmotion_create_project', {
    requestId: 'naming-project', projectType: 'natural_language', title: 'Dia', requirements: '制作中文介绍', namingLanguage: 'zh-CN',
  });
  assert.equal(project.namingLanguage, 'zh-CN');
  const scoped = store.forProject(project.projectId);
  const assetPath = 'assets/94dcfb95-f8f9-455d-bca3-382788fa3943.m4a';
  await mkdir(path.join(scoped.projectDirectory, 'assets'), { recursive: true });
  await writeFile(path.join(scoped.projectDirectory, assetPath), 'unchanged audio bytes');
  await writeFile(path.join(scoped.projectDirectory, 'motion-assets.json'), JSON.stringify([
    { path: assetPath, assetId: 'original-id', name: 'original-audio.m4a' },
  ]));
  const before = await service.call('openmotion_get_project', { projectId: project.projectId });
  assert.equal(before.assetNames[assetPath], 'original-audio');
  const input = { projectId: project.projectId, requestId: 'rename-audio', expectedRevision: before.revision,
    expectedVersionId: before.currentVersionId, files: [], assetNames: [{ path: assetPath, name: 'Dia 参考视频－原声' }] };
  const saved = await service.call('openmotion_edit_project', input);
  assert.equal(saved.assetNames[assetPath], 'Dia 参考视频－原声');
  const replay = await service.call('openmotion_edit_project', input);
  assert.equal(replay.version.versionId, saved.version.versionId);
  assert.deepEqual(replay.assetNames, JSON.parse(JSON.stringify(saved.assetNames)));
  const after = await api(store).call('openmotion_get_project', { projectId: project.projectId });
  assert.equal(after.namingLanguage, 'zh-CN');
  assert.equal(after.assets[0].assetId, 'original-id');
  assert.equal(after.assets[0].originalName, 'original-audio.m4a');
  assert.equal(await readFile(path.join(scoped.projectDirectory, assetPath), 'utf8'), 'unchanged audio bytes');
  assert.equal(after.assetNames[assetPath], 'Dia 参考视频－原声');
  await assert.rejects(service.call('openmotion_edit_project', { ...input, requestId: 'stale', namingLanguage: 'en' }), /VERSION_CONFLICT/);
  assert.equal((await service.call('openmotion_get_project', { projectId: project.projectId })).namingLanguage, 'zh-CN');
}, false));

test('display names preserve meaningful sources, parse unnamed fonts and localize anonymous media', async () => {
  const { projectAssetNames } = await import('../shared/asset-names.ts');
  const uuid = '40da8f95-f670-4cbf-87cc-6f843570b7da';
  const records = [
    { path: `assets/${uuid}.woff2`, name: `${uuid}.woff2`, font: { family: 'Inter', weight: 700, style: 'italic' } },
    { path: 'assets/b.m4a', name: '产品介绍－旁白.m4a' },
    { path: 'assets/c.m4a', name: '产品介绍－旁白.m4a' },
    { path: `assets/${uuid}.m4a`, name: `${uuid}.m4a` },
  ];
  const paths = records.map(item => item.path);
  const names = projectAssetNames(paths, records, 'zh-CN');
  assert.equal(names[paths[0]], 'Inter 700 italic');
  assert.equal(names[paths[1]], '产品介绍－旁白');
  assert.equal(names[paths[2]], '产品介绍－旁白 (2)');
  assert.equal(names[paths[3]], '音频 1');
  assert.equal(projectAssetNames(paths, records, 'ja')[paths[3]], '音声 1');
  assert.equal(projectAssetNames(paths, records, 'pt-BR')[paths[3]], 'Áudio 1');
  assert.equal(records[0].name, `${uuid}.woff2`);
});

test('invalid language or asset-name batches leave metadata unchanged', () => fixture(async store => {
  const service = api(store);
  await assert.rejects(service.call('openmotion_create_project', {
    requestId: 'bad-lang', projectType: 'natural_language', title: 'x', requirements: 'x', namingLanguage: 'not a locale',
  }), /INVALID_NAMING_LANGUAGE/);
  const project = await service.call('openmotion_create_project', {
    requestId: 'legacy-language', projectType: 'natural_language', title: 'x', requirements: 'x',
  });
  assert.equal(project.namingLanguage, null);
  const input = { projectId: project.projectId, requestId: 'bad-name-batch', expectedRevision: project.revision,
    expectedVersionId: project.currentVersionId, files: [], namingLanguage: 'en', assetNames: [{ path: 'index.html', name: 'New name' }] };
  await assert.rejects(service.call('openmotion_edit_project', input), /INVALID_ASSET_PATH/);
  assert.equal((await service.call('openmotion_get_project', { projectId: project.projectId })).revision, project.revision);
}, false));
