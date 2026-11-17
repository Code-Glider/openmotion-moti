import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runFile } from './runtime-assets.mjs';
import { prepareCodexHostHandoff } from './codex-host-handoff.mjs';
import { selectOnboardingTemplateIds, onboardingTemplateIds } from '../shared/onboarding-templates.ts';
import { installationWelcomeMarkdown, resolveLanguage } from '../mcp-ui/template-recommendations/i18n.ts';

export async function installationInstructions(appRoot) {
  const guide = await readFile(path.join(appRoot, 'docs/install-onboarding.md'), 'utf8');
  const sections = [...guide.matchAll(/<!-- installation-onboarding:start -->([\s\S]*?)<!-- installation-onboarding:end -->/g)];
  assert.equal(sections.length, 1, 'Installation guide must contain one onboarding contract');
  assert(sections[0][1].trim(), 'Installation onboarding contract is empty');
  return sections[0][1].trim();
}

export async function prepareInstallationOnboarding({ appRoot, dataDirectory, templateEnvironment, host = 'codex', onboardingOutput,
  templateIds = selectOnboardingTemplateIds(),
  language = process.env.OPENMOTION_ONBOARDING_LANGUAGE || 'en' }) {
  // A missing canonical contract fails before host registration.
  const instructions = await installationInstructions(appRoot);
  const inline = (async () => {
    if (host !== 'codex') return undefined;
    try {
      if (!dataDirectory) {
        const { WorkspaceStore } = await import('../workspace.ts');
        dataDirectory = new WorkspaceStore().directory;
      }
      const { prepareInlineOnboarding } = await import('./inline-onboarding.mjs');
      return await prepareInlineOnboarding({ appRoot, language, templateIds,
        output: onboardingOutput || path.join(dataDirectory, 'onboarding', `welcome-${randomUUID()}.html`) });
    } catch (error) { return { status: 'unavailable', warning: error.message }; }
  })();
  let catalog;
  try {
    catalog = JSON.parse(await runFile(process.execPath, ['--experimental-strip-types', path.join(appRoot, 'scripts/onboarding-catalog.ts'),
      ...(dataDirectory ? [dataDirectory] : []), '--template-ids', JSON.stringify(templateIds)], {
      cwd: appRoot, timeout: 5_000, killSignal: 'SIGKILL',
      env: { ...process.env, MOTION_TEMPLATE_ENV: templateEnvironment },
    }));
    assert(Array.isArray(catalog.templates), 'Invalid onboarding catalog');
  } catch {
    catalog = { source: 'unavailable', environment: templateEnvironment, catalogVersion: null,
      catalogTotal: null, included: 0, truncated: false, stale: false, recommendedTemplateId: null,
      warning: 'Approved onboarding recommendations unavailable. Preserve any accepted template ID and report the limitation; do not substitute another template.', templates: [] };
  }
  const inlinePresentation = await inline;
  return { hostSessionVerified: false, instructions, catalog,
    ...(inlinePresentation ? { inlinePresentation } : {}) };
}

export async function prepareInstallationPreview({ appRoot, dataDirectory }) {
  try {
    const preview = JSON.parse(await runFile(process.execPath, ['--experimental-strip-types', path.join(appRoot, 'scripts/open-template-library.ts')], {
      cwd: appRoot, timeout: 30_000, killSignal: 'SIGKILL',
      env: { ...process.env, ...(dataDirectory ? { MOTION_DATA_DIR: dataDirectory } : {}) },
    }));
    assert.equal(preview.target, 'templates');
    assert.equal(preview.projectCreated, false);
    assert.equal(new URL(preview.previewUrl).searchParams.get('templates'), '1');
    return { status: 'ready', ...preview };
  } catch (error) {
    return { status: 'unavailable', openedByHost: false, projectCreated: false,
      warning: 'Template library could not be prepared: ' + error.message,
      nextAction: 'Installation succeeded; report the preview failure and retry openmotion_open_preview with target=templates after connecting MCP. Do not create a placeholder project.' };
  }
}

// Shared by packaged setup, source setup and the plugin's setup Skill. A ready
// artifact is an installation handoff, never proof of visible host delivery.
export async function prepareInstallationFlow(options) {
  options = { ...options, templateIds: options.templateIds ?? selectOnboardingTemplateIds(),
    language: resolveLanguage((options.language || process.env.OPENMOTION_ONBOARDING_LANGUAGE || 'en').trim()) };
  if (!options.dataDirectory) {
    let configuration;
    try { configuration = JSON.parse(await readFile(path.join(options.appRoot, '.mcp.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const server = configuration?.mcpServers?.openmotion;
    const declared = server?.env?.MOTION_DATA_DIR;
    if (declared !== undefined && declared !== '') {
      const expand = value => {
        assert(typeof value === 'string', 'Invalid installed connection environment value');
        const result = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
          if (key === 'PLUGIN_ROOT' || key === 'CLAUDE_PLUGIN_ROOT') return options.appRoot;
          assert(process.env[key] !== undefined, 'Resolve the installed connection environment before onboarding');
          return process.env[key];
        });
        assert(!result.includes('${'), 'Resolve the installed connection environment before onboarding');
        return result;
      };
      const resolved = expand(declared);
      const cwd = path.isAbsolute(resolved) ? '.' : expand(server.cwd || '.');
      if (resolved) options = { ...options, dataDirectory: path.isAbsolute(resolved) ? path.resolve(resolved) : path.resolve(options.appRoot, cwd, resolved) };
      else {
        const { WorkspaceStore } = await import('../workspace.ts');
        options = { ...options, dataDirectory: new WorkspaceStore().directory };
      }
    } else {
      const { WorkspaceStore } = await import('../workspace.ts');
      options = { ...options, dataDirectory: new WorkspaceStore().directory };
    }
  }
  const [onboarding, preview] = await Promise.all([
    prepareInstallationOnboarding(options), prepareInstallationPreview(options),
  ]);
  let hostHandoff;
  if ((options.host || 'codex') === 'codex' && onboarding.inlinePresentation?.status !== 'prepared') {
    hostHandoff = await prepareCodexHostHandoff({ dataDirectory: options.dataDirectory,
      expectedVersion: options.expectedVersion || JSON.parse(await readFile(path.join(options.appRoot, 'package.json'), 'utf8')).version,
      expectedResourceUri: onboarding.inlinePresentation?.resourceUri,
      codex: options.codex, templateIds: options.templateIds, language: onboarding.inlinePresentation?.language || options.language });
  }
  return { ...onboarding, installationStatus: 'installed', applicationRoot: options.appRoot,
    welcomeMarkdown: installationWelcomeMarkdown(options.language, preview.status === 'ready' ? preview.previewUrl : undefined),
    dataDirectory: options.dataDirectory, preview,
    ...(hostHandoff ? { hostHandoff } : {}),
    onboardingStatus: preview.status !== 'ready' ? 'preview_unavailable'
      : onboarding.inlinePresentation?.status === 'prepared' ? 'awaiting_host_delivery' : hostHandoff?.status || 'awaiting_host_delivery',
    onboardingComplete: false, hostSessionVerified: hostHandoff?.hostSessionVerified || false };
}

// One immutable receipt serves both source and npm setup. Recovery must not run
// setup, prepare the library again, or sample a different recommendation.
export async function persistInstallationOnboarding(result, directory) {
  const detailsFile = path.join(directory, `onboarding-${randomUUID()}.json`);
  const saved = { ...result, detailsFile, ...(result.hostHandoff?.threadId ? { recovery: {
    command: process.execPath,
    args: ['--experimental-strip-types', path.join(result.applicationRoot, 'scripts/install-onboarding.mjs'),
      result.applicationRoot, '--resume', detailsFile, '--verify-only', '--summary'],
  } } : {}) };
  await mkdir(directory, { recursive: true });
  await writeFile(detailsFile, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return saved;
}

export async function resumeInstallationOnboarding(saved, options = {}) {
  const appRoot = options.appRoot || fileURLToPath(new URL('../', import.meta.url));
  assert(saved.installationStatus === 'installed' && saved.onboardingComplete === false, 'Use an incomplete installation receipt');
  assert(typeof saved.applicationRoot === 'string' && realpathSync(saved.applicationRoot) === realpathSync(appRoot),
    'Resume with the original installed application; do not switch installations');
  assert(typeof saved.dataDirectory === 'string' && path.isAbsolute(saved.dataDirectory), 'The saved workspace must be absolute');
  const savedThreadId = saved.hostHandoff?.threadId
    || saved.hostHandoff?.hostRequests?.find(item => item.method === 'mcpServerStatus/list')?.params?.threadId;
  const threadId = options.threadId ?? process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID;
  assert(savedThreadId && savedThreadId === threadId, 'Resume onboarding in its original chat');
  const args = saved.hostHandoff?.presentation?.arguments || saved.inlinePresentation?.presentation?.arguments;
  assert(args && Array.isArray(args.templateIds) && args.templateIds.length === 3
    && new Set(args.templateIds).size === 3 && args.templateIds.every(id => onboardingTemplateIds.includes(id)),
  'The saved installation must contain three distinct curated template IDs');
  const { loadTemplatePresentation } = await import('../shared/mcp-template-recommendations.ts');
  const presentation = loadTemplatePresentation({ applicationRoot: appRoot, directory: path.join(appRoot, 'mcp-ui/template-recommendations') });
  assert(!saved.inlinePresentation?.resourceVersion || saved.inlinePresentation.resourceVersion === presentation.resourceVersion,
    'The installed card resources changed; do not present a stale installation receipt');
  const hostHandoff = await prepareCodexHostHandoff({ ...options, threadId, dataDirectory: saved.dataDirectory,
    templateIds: args.templateIds, language: args.language,
    expectedResourceUri: presentation.uri,
    expectedVersion: JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')).version,
    verifyOnly: options.verifyOnly ?? true,
    welcomeDelivered: options.welcomeDelivered || saved.welcomeDelivered || false });
  const welcomeDelivered = options.welcomeDelivered || saved.welcomeDelivered || false;
  return { ...saved, hostHandoff, welcomeDelivered,
    welcomeMarkdown: welcomeDelivered ? '' : saved.welcomeMarkdown,
    inlinePresentation: { ...saved.inlinePresentation, presentation: hostHandoff.presentation,
      ...(welcomeDelivered ? { welcomeMarkdown: '', instructions: hostHandoff.nextAction } : {}) },
    ...(welcomeDelivered && saved.recovery ? { recovery: { ...saved.recovery,
      args: saved.recovery.args.includes('--welcome-delivered') ? saved.recovery.args : [...saved.recovery.args, '--welcome-delivered'] } } : {}),
    onboardingStatus: saved.preview?.status === 'ready' ? hostHandoff.status : 'preview_unavailable',
    hostSessionVerified: hostHandoff.hostSessionVerified, onboardingComplete: false };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    summary: { type: 'boolean' }, 'check-contract': { type: 'boolean' }, resume: { type: 'string' },
    'verify-only': { type: 'boolean' }, 'welcome-delivered': { type: 'boolean' },
  } });
  assert(positionals.length <= 1, 'Pass one application root');
  const appRoot = path.resolve(positionals[0] || fileURLToPath(new URL('../', import.meta.url)));
  if (values['check-contract']) {
    await installationInstructions(appRoot);
  } else {
    assert(!values['verify-only'] || values.resume, 'Use --resume RECEIPT with --verify-only to preserve the prepared selection');
    assert(!values['welcome-delivered'] || values.resume, 'Use --welcome-delivered only when resuming a saved installation');
    let result;
    if (values.resume) {
      assert(path.isAbsolute(values.resume), 'Use an absolute installation receipt path');
      result = await resumeInstallationOnboarding(JSON.parse(await readFile(values.resume, 'utf8')),
        { appRoot, verifyOnly: true, welcomeDelivered: values['welcome-delivered'] });
    } else {
      const defaults = JSON.parse(await readFile(path.join(appRoot, 'shared/template-config.json'), 'utf8'));
      const options = { appRoot, dataDirectory: process.env.MOTION_DATA_DIR, templateEnvironment: process.env.MOTION_TEMPLATE_ENV || defaults.environment };
      result = await persistInstallationOnboarding(await prepareInstallationFlow(options), path.join(appRoot, '.artifacts/install'));
    }
    const { hostHandoff, preview } = result;
    // Keep the decision and handoff visible instead of burying them after a long
    // quoted success contract. The full contract remains available for the Agent.
    if (values.summary) {
      if (!result.onboardingComplete) console.error('ONBOARDING_PENDING: ' + (hostHandoff?.reason || result.onboardingStatus)
        + '. Installation is registered; welcome/cards delivery remains unverified. '
        + (result.welcomeDelivered ? 'Keep the already displayed welcome; use the returned cards-only native arguments without replaying it. '
          : 'If cards cannot be shown, stream the top-level welcomeMarkdown once as ordinary final reply text, then briefly report the blocker. Do not replace the welcome with a status-only reply. ')
        + (result.welcomeDelivered ? '' : result.inlinePresentation?.status === 'prepared'
          ? 'Continue in this same installation turn: initialize the browser, finish checks and publish the verified document in this chat\'s permitted visualization directory before opening the library. Prefer the direct IAB route in docs/install-onboarding.md: load preview.previewUrl in a hidden tab while preparing cards, then reveal that loaded tab and obtain its page state in one call; do not reopen or inspect it again. Complete mandatory browser bookkeeping next, then immediately write inlinePresentation.welcomeMarkdown as normal final reply text followed by the published contentReference on its own line. The welcome streams as text; the document contains cards only. '
          : result.inlinePresentation?.status === 'native_required'
            ? 'Show the exact prepared references with the compatible native Tool, onboarding:true and welcomeText LAST. Verify genuine incremental welcome input in the App, then three cards below it with working full videos. Do not duplicate the welcome in chat or simulate typing. Complete-only delivery is not streaming acceptance. Refresh stale discovery through the supported host action; never resample or substitute a library page. '
            : 'Open the library and report the required host action. ')
        + 'When recovery is supplied, use recovery.command/recovery.args after the host action to resume this receipt without setup or resampling. '
        + 'If a welcome already appeared, append --welcome-delivered and show only the cards. '
        + 'Do not enqueue a user message or send a separate success reply.');
      if (preview.status !== 'ready') console.error('ONBOARDING_PENDING: ' + preview.warning);
      console.log(JSON.stringify({ ...result, instructions: undefined, catalog: undefined }, null, 2));
    } else console.log(JSON.stringify(result, null, 2));
  }
}
