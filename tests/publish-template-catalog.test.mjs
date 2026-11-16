import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildTemplatePublication, publishTemplateCatalog } from '../.github/scripts/publish-template-catalog.mjs';

const commit = 'a'.repeat(40);

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'openmotion-template-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'library/templates/catalog/motion-fixture/source/assets');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(root, 'library/templates/catalog/catalog.json'), JSON.stringify({ schemaVersion: 1, publication: { resourceId: 'x', defaultLocale: 'en', locales: ['en'] }, templateIds: ['motion-fixture'], localeContent: { en: {} } }));
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/template.json'), JSON.stringify({ templateId: 'motion-fixture', entry: { templateId: 'motion-fixture', sortOrder: 1, original: { templateName: 'Fixture' }, files: [] }, locales: { en: {} } }));
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/TEMPLATE.md'), '# Fixture\n');
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/source/manifest.json'), JSON.stringify({ schema: 'motion-package-v1', files: [{ path: 'scene.motion', bytes: 12, sha256: 'placeholder' }] }));
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/source/scene.motion'), 'motion content');
  await writeFile(path.join(directory, 'data.bin'), Buffer.from([1, 2, 3, 4]));
  return root;
}

test('template publication mirrors arbitrary source files and reuses content-addressed objects', async t => {
  const root = await fixture(t);
  const built = await buildTemplatePublication(root, commit, { origin: 'https://cdn.example.com' });
  const keys = built.uploads.map(file => file.key);
  assert(keys.includes(`open-motion/templates/snapshots/${commit}/motion-fixture/source/manifest.json`));
  assert(keys.includes(`open-motion/templates/snapshots/${commit}/motion-fixture/hosted-files.json`));
  assert(!keys.some(key => key.includes('/source/scene.motion')));
  assert.equal(keys.filter(key => key.includes('/objects/')).length, 2);
  const sidecar = JSON.parse(await readFile(built.uploads.find(file => file.key.endsWith('/hosted-files.json')).body, 'utf8'));
  assert.deepEqual(sidecar.files.map(file => file.path), ['assets/data.bin', 'scene.motion']);
  await rm(built.staging, { recursive: true, force: true });

  const calls = [], pointerBodies = new Map();
  const run = async (command, args) => {
    assert.equal(command, 'aws');
    if (args.includes('list-objects-v2')) return JSON.stringify({ Contents: [{ Key: 'open-motion/templates/objects/' + sidecar.files[0].sha256 }] });
    const key = args[args.indexOf('--key') + 1];
    const body = args[args.indexOf('--body') + 1];
    calls.push(key);
    if (key === 'open-motion/templates/main/catalog.json') pointerBodies.set(key, body);
    return '{}';
  };
  const result = await publishTemplateCatalog(root, { mode: 'main', commit, endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases', origin: 'https://cdn.example.com', run,
    fetcher: async () => new Response(await readFile(pointerBodies.get('open-motion/templates/main/catalog.json'))) });
  assert.equal(result.reused, 1);
  assert.equal(result.pointerUrl, 'https://cdn.example.com/open-motion/templates/main/catalog.json');
  assert(calls.includes(result.snapshotKey + '/catalog.json'));
});

test('template publication rejects symlinks without restricting ordinary extensions', async t => {
  const root = await fixture(t);
  await symlink('/tmp', path.join(root, 'library/templates/catalog/motion-fixture/source/link'));
  await assert.rejects(buildTemplatePublication(root, commit), /symbolic links/);
});

test('release publication uses its source snapshot and never changes the moving main pointer', async t => {
  const root = await fixture(t), uploads = new Map();
  const version = '0.7.0-test.1';
  const pointerKey = `open-motion/templates/releases/${version}/catalog.json`;
  let active = 0, maximumActive = 0;
  const result = await publishTemplateCatalog(root, { mode: 'release', version, commit,
    endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async (_, args) => {
      if (args.includes('list-objects-v2')) return '{}';
      const key = args[args.indexOf('--key') + 1];
      assert(args.includes('--if-none-match'), 'Release objects must be immutable');
      if (key === pointerKey) {
        assert.equal(active, 0, 'All snapshot uploads must finish before the pointer');
        assert(uploads.has(`open-motion/templates/snapshots/${commit}/catalog.json`));
      }
      active++; maximumActive = Math.max(maximumActive, active);
      try { uploads.set(key, await readFile(args[args.indexOf('--body') + 1])); }
      finally { active--; }
      return '{}';
    },
    fetcher: async url => {
      assert.equal(url, `https://releases.open-design.ai/${pointerKey}`);
      return new Response(uploads.get(pointerKey));
    },
  });
  assert.equal(result.commit, commit);
  assert.equal(JSON.parse(uploads.get(pointerKey)).commit, commit);
  assert(!uploads.has('open-motion/templates/main/catalog.json'));
  assert(maximumActive > 1 && maximumActive <= 12);
});

test('failed snapshot uploads leave the main pointer untouched and remove staging after uploads settle', async t => {
  const root = await fixture(t), keys = [];
  let stagedFile;
  await assert.rejects(publishTemplateCatalog(root, { commit,
    endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async (_, args) => {
      if (args.includes('list-objects-v2')) return '{}';
      const key = args[args.indexOf('--key') + 1]; keys.push(key);
      if (key.endsWith('/hosted-files.json')) {
        stagedFile = args[args.indexOf('--body') + 1];
        await readFile(stagedFile);
      }
      if (key.endsWith('/template.json')) throw new Error('Storage unavailable');
      return '{}';
    },
    fetcher: async () => { throw new Error('Pointer must not be verified after an upload failure'); },
  }), /Storage unavailable/);
  assert(!keys.includes('open-motion/templates/main/catalog.json'));
  assert(stagedFile);
  await assert.rejects(readFile(stagedFile), { code: 'ENOENT' });
});

test('unfetched LFS pointers fail before publication starts', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/source/scene.motion'), `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 1234\n`);
  await assert.rejects(publishTemplateCatalog(root, { commit,
    endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async () => assert.fail('No storage writes may occur with missing LFS bytes'),
  }), /Fetch Git LFS template bytes/);
});
