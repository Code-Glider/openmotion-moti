import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isMain } from '../shared/entry.ts';
import { boundedMediaBody, mediaDigest, type MediaLock } from '../shared/repository-media.ts';
import { lfsPointer } from '../shared/repository-template-catalog.ts';
import { prepareMediaCleanup, publishMedia, commitCleanup, type TreeFile } from './prepare-pr-media.ts';

const repository = 'nexu-io/openmotion';
const sha = /^[a-f0-9]{40}$/;

type ApiOptions = { method?: string; body?: unknown };

async function github(route: string, token: string, options: ApiOptions = {}): Promise<any> {
  const response = await fetch('https://api.github.com/repos/' + repository + '/' + route, {
    method: options.method,
    headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', ...(options.body ? { 'content-type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `GitHub ${options.method || 'GET'} ${route} failed: HTTP ${response.status}`);
  return response.json();
}

async function githubUser(token: string): Promise<any> {
  const response = await fetch('https://api.github.com/user', { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `GitHub user lookup failed: HTTP ${response.status}`);
  return response.json();
}

async function readBlob(file: TreeFile, token: string, commit: string): Promise<Buffer> {
  const response = await fetch(`https://api.github.com/repos/${repository}/git/blobs/${file.sha}`, {
    headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github.raw+json' },
    redirect: 'error', signal: AbortSignal.timeout(120_000),
  });
  assert(response.ok, `GitHub blob unavailable at ${commit}: ${file.path}`);
  const bytes = await boundedMediaBody(response, Math.max(file.size, 1024));
  assert.equal(bytes.length, file.size, `GitHub blob size changed: ${file.path}`);
  return bytes;
}

async function readLfs(lock: MediaLock, token: string): Promise<Buffer> {
  const response = await fetch(`https://github.com/${repository}.git/info/lfs/objects/batch`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from('x-access-token:' + token).toString('base64'), 'content-type': 'application/vnd.git-lfs+json', accept: 'application/vnd.git-lfs+json' },
    body: JSON.stringify({ operation: 'download', transfers: ['basic'], objects: [{ oid: lock.sha256, size: lock.bytes }] }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, 'Cannot resolve merged LFS media');
  const batch: any = await response.json(), action = batch.objects?.[0]?.actions?.download;
  assert(action, 'Merged LFS object is unavailable');
  const url = new URL(action.href);
  assert(url.protocol === 'https:' && /(?:\.githubusercontent\.com|\.amazonaws\.com)$/.test(url.hostname) && !url.username && !url.password, 'Unexpected LFS download origin');
  const bytes = await boundedMediaBody(await fetch(url, { headers: action.header, redirect: 'error', signal: AbortSignal.timeout(120_000) }), lock.bytes);
  assert.equal(bytes.length, lock.bytes); assert.equal(mediaDigest(bytes), lock.sha256);
  return bytes;
}

async function tree(commit: string, token: string): Promise<TreeFile[]> {
  const result = await github(`git/trees/${commit}?recursive=1`, token);
  assert(!result.truncated, 'GitHub tree is truncated; split the merged change');
  return result.tree;
}

async function gitRunner(directory: string, token: string) {
  return async (args: string[], input?: string) => {
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', ...args], {
      cwd: directory, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64') },
    });
    if (input !== undefined) child.stdin.end(input);
    const chunks: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk))); child.stderr.on('data', chunk => errors.push(Buffer.from(chunk)));
    const code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', value => resolve(value ?? 1)); });
    assert.equal(code, 0, errors.join('') || 'Git operation failed');
    return Buffer.concat(chunks).toString().trim();
  };
}

export async function publishMergedPullRequestMedia(pullNumber: number, mergeSHA: string, {
  token = process.env.GITHUB_TOKEN || process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN,
  endpoint = process.env.MOTION_R2_ENDPOINT || 'https://64ad4569ffd912432d6b86d5656484c4.r2.cloudflarestorage.com',
  bucket = process.env.MOTION_R2_BUCKET || 'open-design-releases',
} = {}) {
  assert(Number.isSafeInteger(pullNumber) && pullNumber > 0 && sha.test(mergeSHA), 'Require a merged PR number and full merge SHA');
  assert(token, 'Missing GitHub token');
  const commit = await github(`commits/${mergeSHA}`, token);
  const parent = commit.parents?.[0]?.sha;
  assert(sha.test(parent || ''), 'Merged commit must have a parent');
  const [head, base] = await Promise.all([tree(mergeSHA, token), tree(parent, token)]);
  const read = (file: TreeFile) => readBlob(file, token, mergeSHA);
  let transferred = 0;
  // Also backfill raw Skill attachments that were merged before this workflow
  // existed (for example, the media indexed by PR #619). Once transferred,
  // they disappear from the tree and are not selected again.
  const plan = await prepareMediaCleanup({ head, base, sourceSHA: mergeSHA, pullNumber, forcePaths: /^library\/skills\// }, read, async (lock, raw) => {
    const bytes = lfsPointer(raw) ? await readLfs(lock, token) : raw;
    await publishMedia(lock, bytes, { endpoint, bucket });
    transferred += 1;
  });
  if (!plan.media.length) return { pullNumber, mergeSHA, parent, media: 0, cleanup: false };

  const directory = await mkdtemp(path.join(tmpdir(), 'openmotion-postmerge-media-'));
  try {
    const git = await gitRunner(directory, token);
    await git(['init', '-q']);
    await git(['fetch', '--depth=1', `https://github.com/${repository}.git`, mergeSHA]);
    assert.equal(await git(['rev-parse', 'FETCH_HEAD']), mergeSHA);
    const identity = await githubUser(token);
    const cleanup = await commitCleanup(plan, git, directory, { login: identity.login, id: identity.id }, parent);
    const main = await github('git/ref/heads/main', token);
    assert.equal(main.object?.sha, mergeSHA, 'main advanced before post-merge cleanup; rerun this workflow');
    await git(['push', `--force-with-lease=refs/heads/main:${mergeSHA}`, `https://github.com/${repository}.git`, `${cleanup}:refs/heads/main`]);
    return { pullNumber, mergeSHA, parent, media: transferred, cleanup: true, cleanupSHA: cleanup };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (isMain(import.meta.url)) {
  const [number, mergeSHA, extra] = process.argv.slice(2);
  assert(!extra, 'Usage: publish-merged-media.ts <PR-number> <merge-sha>');
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  console.log(JSON.stringify(await publishMergedPullRequestMedia(Number(number), mergeSHA), null, 2));
}
