import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { renderInlineOnboarding, prepareInlineOnboarding, publishInlineOnboarding } from '../scripts/inline-onboarding.mjs';
import { prepareInstallationOnboarding } from '../scripts/install-onboarding.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
test('default installation prepares all three production cards in its own workspace without presentation flags', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-default-onboarding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await prepareInstallationOnboarding({ appRoot, dataDirectory: directory, templateEnvironment: 'prod', language: 'zh' });
  assert.equal(result.inlinePresentation?.status, 'prepared');
  assert.deepEqual(result.inlinePresentation.templateIds, ['product-promo', 'nyt-graph', 'decision-tree']);
  assert.equal(result.inlinePresentation.language, 'zh');
  assert(path.resolve(result.inlinePresentation.path).startsWith(directory + path.sep));
  assert.equal((await stat(result.inlinePresentation.path)).size, result.inlinePresentation.bytes);
  assert.equal(result.hostSessionVerified, false, 'Preparing content is not a host delivery acknowledgment');
});
test('the inline renderer mounts the production welcome and three real media cards without an MCP connection', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-inline-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'welcome.html');
  const result = await renderInlineOnboarding({ appRoot, output, language: 'zh' });
  assert.equal(result.nativeMcpSessionVerified, false);
  assert.deepEqual(result.templateIds, ['product-promo', 'nyt-graph', 'decision-tree']);
  assert(result.bytes < 1_000_000);
  const fragment = await readFile(output, 'utf8');
  assert.doesNotMatch(fragment, /<!doctype|<html[ >]|<head[ >]|<body[ >]/i);
  assert.doesNotMatch(fragment, /__OPENMOTION_INLINE_/);
  const window = new Window();
  t.after(() => window.happyDOM.abort());
  window.URL.createObjectURL = () => 'blob:verified-template';
  window.URL.revokeObjectURL = () => {};
  window.document.body.innerHTML = fragment;
  for (const script of window.document.querySelectorAll('script')) window.eval(script.textContent!);
  assert.equal(window.document.querySelectorAll('.omtc-card').length, 3);
  assert.match(window.document.querySelector('.omtc-welcome')!.textContent!, /我是你的开源视频创作搭档/);
  assert.equal(window.document.querySelectorAll('.omtc-card video[src^="blob:"]').length, 3);
  (window.document.querySelector('.omtc-card .omtc-clone') as any).click();
  const draft = window.document.querySelector('textarea')!;
  assert.match(draft.value, /product-promo/);
  assert.match(draft.value, /我的要求/);
  assert.equal(draft.readOnly, true, 'an unsupported composer bridge must expose the copyable brief');
  await assert.rejects(renderInlineOnboarding({ appRoot, output, language: 'zh' }), /EEXIST/);
  assert.equal(await readFile(output, 'utf8'), fragment);
});

test('the Node CLI renderer works from the installed runtime without development dependencies', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-inline-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'welcome.html');
  const result = await prepareInlineOnboarding({ appRoot, output, language: 'fr' });
  assert.equal(result.status, 'prepared'); assert.equal(result.language, 'fr');
  assert.equal(result.publicationRequired, true);
  assert.equal(result.contentReference, undefined, 'A runtime path is not a host-authorized visualization reference');
  assert.equal((await stat(output)).size, result.bytes);
});

test('host publication verifies and copies the real component to an explicitly supplied readable directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-publish-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prepared = await renderInlineOnboarding({ appRoot, output: path.join(directory, 'runtime/welcome.html'), language: 'zh' });
  const hostDirectory = path.join(directory, 'host-thread-visualizations');
  const published = await publishInlineOnboarding({ source: prepared.path, expectedSHA256: prepared.sha256, hostDirectory });
  assert.equal(published.status, 'published');
  assert.equal(published.sha256, prepared.sha256);
  assert.match(published.contentReference, /visualize/);
  assert.equal(JSON.parse(published.contentReference.split('\ue202')[1].split('\ue201')[0]).path, published.path);
  assert(published.path.startsWith(hostDirectory + path.sep));
  assert.equal(await readFile(published.path, 'utf8'), await readFile(prepared.path, 'utf8'));
  await assert.rejects(publishInlineOnboarding({ source: prepared.path, expectedSHA256: '0'.repeat(64), hostDirectory }), /SHA256/);
  await writeFile(published.path, 'existing unrelated content');
  await assert.rejects(publishInlineOnboarding({ source: prepared.path, expectedSHA256: prepared.sha256, hostDirectory }), /Refusing to overwrite/);
  assert.equal(await readFile(published.path, 'utf8'), 'existing unrelated content');
});
