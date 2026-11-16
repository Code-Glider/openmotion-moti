import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TemplateCatalog } from '../prism-templates.ts';

const commit = 'a'.repeat(40);
const id = 'motion-github-fixture';
const manifest = {
  schemaVersion: 1,
  publication: { resourceId: 'github', environment: 'prod', channel: 'default', publicationId: 'github-main', defaultLocale: 'en', locales: ['en'] },
  templateIds: [id],
  localeContent: { en: {} },
};
const record = {
  templateId: id,
  entry: { templateId: id, sortOrder: 1, original: { templateName: 'GitHub fixture', summary: 'Latest main template' }, files: [] },
  locales: { en: {} },
};
const sourceManifest = { files: [{ path: 'motion.md', bytes: Buffer.byteLength('# GitHub motion\n'), sha256: '73417adee4bd42997389776443c3df7097c3515bc67030ea4d04f2b0fd341dbc' }] };

function response(value: unknown, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('GitHub catalog reads latest main and serves repository source files', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'openmotion-github-catalog-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const calls: string[] = [];
  let offline = false;
  const request = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (offline) throw new Error('offline');
    if (url === 'https://api.github.com/repos/nexu-io/openmotion/commits/main') return response({ sha: commit });
    if (url.endsWith('/catalog.json')) return response(manifest);
    if (url.endsWith(`/${id}/template.json`)) return response(record);
    if (url.endsWith(`/${id}/source/manifest.json`)) return response(sourceManifest);
    if (url.endsWith(`/${id}/TEMPLATE.md`)) return new Response('# GitHub instructions\n');
    if (url.endsWith(`/${id}/source/motion.md`)) return new Response('# GitHub motion\n');
    throw new Error('Unexpected request: ' + url);
  };
  const catalog = new TemplateCatalog(work, { source: 'github', locale: 'en', fetch: request });
  const page = await catalog.page({ category: 'all' });
  assert.equal(page.source, 'github');
  assert.equal(page.catalogVersion, 'github:' + commit);
  assert.equal(page.items[0].title, 'GitHub fixture');
  const detail = await catalog.detail(id);
  assert.equal(detail.instructions, '# GitHub instructions\n');
  assert.equal(detail.motionDocument.content, '# GitHub motion\n');
  assert.equal((await catalog.sourceFile(id, 'motion.md')).toString(), '# GitHub motion\n');
  const afterFirstSourceRead = calls.length;
  assert.equal((await catalog.sourceFile(id, 'motion.md')).toString(), '# GitHub motion\n');
  assert.equal(calls.length, afterFirstSourceRead, 'verified GitHub source files are reused from the cache');
  offline = true;
  const reopened = new TemplateCatalog(work, { source: 'github', locale: 'en', fetch: request });
  assert.equal((await reopened.sourceFile(id, 'motion.md')).toString(), '# GitHub motion\n');
});

test('built-in template detail stays local when the GitHub catalog is unreachable', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'openmotion-github-builtin-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const request = async (input: RequestInfo | URL) => { throw new Error('GitHub is unavailable: ' + String(input)); };
  const catalog = new TemplateCatalog(work, { source: 'github', locale: 'en', fetch: request });
  const detail = await catalog.detail('product-promo');
  assert.equal(detail.id, 'product-promo');
  assert.equal(detail.kind, 'builtin');
  assert.match(detail.instructions, /product-promo/);
  assert.deepEqual(detail.workflowGuide, { workflow: 'template', section: 'start', status: 'ready' });
});
