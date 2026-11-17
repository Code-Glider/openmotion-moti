import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { persistInstallationOnboarding, resumeInstallationOnboarding } from '../scripts/install-onboarding.mjs';
import { prepareCodexHostHandoff } from '../scripts/codex-host-handoff.mjs';
import { loadTemplatePresentation } from '../shared/mcp-template-recommendations.ts';
import { onboardingTemplateIds } from '../shared/onboarding-templates.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const threadId = 'onboarding-recovery-chat';
const ids = onboardingTemplateIds.slice(-3);
const presentation = loadTemplatePresentation();

async function fixture(t: any) {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-resume-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const hostHandoff = await prepareCodexHostHandoff({ threadId, dataDirectory: directory,
    templateIds: ids, language: 'zh', env: {}, socketPath: path.join(directory, 'absent.sock') });
  const saved = await persistInstallationOnboarding({ applicationRoot: appRoot, dataDirectory: directory,
    installationStatus: 'installed', onboardingComplete: false, hostSessionVerified: false,
    welcomeMarkdown: 'The standalone welcome', hostHandoff,
    inlinePresentation: { status: 'native_required', templateIds: ids, language: 'zh', resourceVersion: presentation.resourceVersion },
    preview: { status: 'ready', previewUrl: 'http://127.0.0.1:4173/?templates=1&embed=1', projectCreated: false },
  }, directory);
  return { directory, saved };
}

function connectedHost(directory: string) {
  const calls: string[] = [];
  const request = async (method: string, params: any) => {
    calls.push(method);
    if (method === 'thread/loaded/list') return { data: [threadId] };
    if (method === 'mcpServerStatus/list') return { data: [{ name: 'openmotion', serverInfo: { version: '0.0.1' }, tools: {
      openmotion_get_project: {}, openmotion_show_template_recommendations: presentation.tool,
    } }] };
    if (method === 'mcpServer/tool/call') {
      assert.equal(params.threadId, threadId);
      assert.equal(params.tool, 'openmotion_get_project');
      return { structuredContent: { dataDirectory: directory } };
    }
    throw new Error('Recovery must not call ' + method);
  };
  return { calls, request };
}

test('the immutable receipt retains its original selection and provides an executable recovery command', async t => {
  const { saved } = await fixture(t);
  assert.deepEqual(JSON.parse(await readFile(saved.detailsFile, 'utf8')), JSON.parse(JSON.stringify(saved)));
  assert.equal((await stat(saved.detailsFile)).mode & 0o777, 0o600);
  assert.equal(saved.recovery.command, process.execPath);
  assert.deepEqual(saved.recovery.args.slice(-4), ['--resume', saved.detailsFile, '--verify-only', '--summary']);
});

test('after a manual restart, resume verifies the same chat, workspace, language and three frozen cards', async t => {
  const { directory, saved } = await fixture(t);
  const before = await readFile(saved.detailsFile, 'utf8');
  const host = connectedHost(directory);
  const result = await resumeInstallationOnboarding(saved, { appRoot, threadId, request: host.request });
  assert.equal(result.hostHandoff.status, 'ready_for_presentation');
  assert.equal(result.hostSessionVerified, true);
  assert.equal(result.onboardingComplete, false);
  assert.equal(result.hostHandoff.welcomeStreamingVerified, false);
  assert.equal(result.hostHandoff.expectedResourceUri, presentation.uri);
  assert.deepEqual(result.hostHandoff.presentation.arguments.templateIds, ids);
  assert.equal(result.hostHandoff.presentation.arguments.language, 'zh');
  assert.deepEqual(result.preview, saved.preview);
  assert.deepEqual(host.calls, ['thread/loaded/list', 'mcpServerStatus/list', 'mcpServer/tool/call']);
  assert.equal(await readFile(saved.detailsFile, 'utf8'), before);
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.json')), [path.basename(saved.detailsFile)]);
});

test('recovery refuses another chat, installation or card resource before accessing the host', async t => {
  const { directory, saved } = await fixture(t);
  const host = connectedHost(directory);
  await assert.rejects(resumeInstallationOnboarding(saved, { appRoot, threadId: 'another-chat', request: host.request }), /original chat/);
  await assert.rejects(resumeInstallationOnboarding({ ...saved, applicationRoot: directory }, { appRoot, threadId, request: host.request }), /original installed application/);
  await assert.rejects(resumeInstallationOnboarding({ ...saved, inlinePresentation: { ...saved.inlinePresentation, resourceVersion: 'older-resource' } },
    { appRoot, threadId, request: host.request }), /card resources changed/);
  assert.deepEqual(host.calls, []);
});

test('an already delivered welcome is retained while recovery prepares only the original cards', async t => {
  const { directory, saved } = await fixture(t);
  const host = connectedHost(directory);
  const result = await resumeInstallationOnboarding(saved, { appRoot, threadId, request: host.request, welcomeDelivered: true });
  assert.equal(result.welcomeMarkdown, '');
  assert.equal(result.hostHandoff.welcomeMarkdown, '');
  assert.equal(result.hostHandoff.presentation.arguments.onboarding, false);
  assert.equal(result.hostHandoff.presentation.arguments.welcomeText, undefined);
  assert.equal(result.inlinePresentation.presentation.arguments.onboarding, false);
  assert.equal(result.inlinePresentation.welcomeMarkdown, '');
  assert(result.recovery.args.includes('--welcome-delivered'));
  assert.deepEqual(result.hostHandoff.presentation.arguments.templateIds, ids);
  assert.equal(result.hostHandoff.welcomeStreamingVerified, false);
});

test('the actual recovery CLI reuses the receipt without setup, library preparation or resampling', async t => {
  const { directory, saved } = await fixture(t);
  const result = spawnSync(saved.recovery.command, [...saved.recovery.args, '--welcome-delivered'], {
    encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: threadId,
      OPENMOTION_CODEX_SOCKET: path.join(directory, 'absent.sock') },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /onboarding:true|stream the top-level welcomeMarkdown/);
  const resumed = JSON.parse(result.stdout);
  assert.equal(resumed.hostHandoff.reason, 'HOST_CONTROL_UNAVAILABLE');
  assert.equal(resumed.hostHandoff.manualAction.serverName, 'openmotion');
  assert.equal(resumed.hostHandoff.presentation.arguments.onboarding, false);
  assert.deepEqual(resumed.hostHandoff.presentation.arguments.templateIds, ids);
  assert.deepEqual(resumed.preview, saved.preview);
  assert.equal(resumed.detailsFile, saved.detailsFile);
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.json')).length, 1);
});
