import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TemplatePublication } from './repository-template-catalog.ts';

const repository = 'nexu-io/openmotion';
const ref = 'main';
const apiOrigin = 'https://api.github.com';
const rawOrigin = 'https://raw.githubusercontent.com';
const catalogPath = 'library/templates/catalog';
const maxJsonBytes = 1024 * 1024;

type Request = typeof fetch;
type TemplateRecord = { templateId: string; entry: Record<string, any>; locales: Record<string, Record<string, any>>; [key: string]: any };

export type GithubRepositoryCatalog = {
  commit: string;
  rawBase: string;
  publication: TemplatePublication;
  records: Map<string, TemplateRecord>;
  version: string;
  fetchFile: (templateId: string, name: string, limit?: number) => Promise<Buffer>;
};

function safePath(value: string): void {
  assert(value && !/[\\\x00-\x1f:]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid GitHub template path');
}

async function responseBytes(response: Response, limit: number): Promise<Buffer> {
  assert(response.ok, `GitHub template request failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length <= limit, 'GitHub template file exceeds its size limit');
  return bytes;
}

async function jsonRequest(request: Request, url: string): Promise<any> {
  const response = await request(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'openmotion-template-catalog' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  return JSON.parse((await responseBytes(response, maxJsonBytes)).toString('utf8'));
}

async function fetchCatalogFile(request: Request, rawBase: string, relative: string, limit = maxJsonBytes): Promise<Buffer> {
  safePath(relative);
  return responseBytes(await request(`${rawBase}/${relative.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { accept: 'application/octet-stream', 'user-agent': 'openmotion-template-catalog' },
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  }), limit);
}

/** Read the latest main branch as one commit-consistent catalog snapshot. */
export async function loadGithubCatalog(request: Request = fetch): Promise<GithubRepositoryCatalog> {
  const refInfo = await jsonRequest(request, `${apiOrigin}/repos/${repository}/commits/${ref}`);
  assert(typeof refInfo.sha === 'string' && /^[a-f0-9]{40}$/.test(refInfo.sha), 'GitHub returned an invalid OpenMotion commit');
  const commit = refInfo.sha;
  const rawBase = `${rawOrigin}/${repository}/${commit}/${catalogPath}`;
  const catalogBytes = await fetchCatalogFile(request, rawBase, 'catalog.json');
  const manifest = JSON.parse(catalogBytes.toString('utf8'));
  assert(manifest.schemaVersion === 1 && Array.isArray(manifest.templateIds) && manifest.templateIds.length > 0, 'Invalid GitHub template catalog');
  assert(new Set(manifest.templateIds).size === manifest.templateIds.length, 'Duplicate GitHub template ID');
  const { locales, ...identity } = manifest.publication ?? {};
  assert(Array.isArray(locales) && locales.includes(identity.defaultLocale), 'Invalid GitHub template locales');
  const publication: TemplatePublication = { ...identity, content: {} };
  for (const locale of locales) publication.content[locale] = { ...manifest.localeContent?.[locale], templates: [] };
  const records = new Map<string, TemplateRecord>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < manifest.templateIds.length) {
      const id = manifest.templateIds[cursor++];
      assert(typeof id === 'string' && /^[a-z][a-z0-9-]+$/.test(id), 'Invalid GitHub template ID');
      const record = JSON.parse((await fetchCatalogFile(request, rawBase, `${id}/template.json`)).toString('utf8')) as TemplateRecord;
      assert(record.templateId === id && record.entry?.templateId === id, 'GitHub template identity mismatch');
      assert.deepEqual(Object.keys(record.locales ?? {}).sort(), [...locales].sort(), 'GitHub template locale mismatch');
      for (const locale of locales) {
        const entry = { ...record.entry, ...record.locales[locale] };
        assert(entry.templateId === id && entry.original?.templateName && Array.isArray(entry.files), 'Invalid GitHub template metadata');
        publication.content[locale].templates.push(entry);
      }
      records.set(id, record);
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, manifest.templateIds.length) }, () => worker()));
  return {
    commit, rawBase, publication, records, version: 'github:' + commit,
    fetchFile: (templateId, name, limit = maxJsonBytes) => {
      assert(records.has(templateId), 'GitHub template not found');
      return fetchCatalogFile(request, rawBase, `${templateId}/${name}`, limit);
    },
  };
}

