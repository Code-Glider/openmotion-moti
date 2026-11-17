import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectOnboardingTemplateIds } from '../shared/onboarding-templates.ts';
import { welcomeMarkdown, onboardingWelcomeText } from '../mcp-ui/template-recommendations/i18n.ts';

const presentationTool = 'openmotion_show_template_recommendations';
const languages = ['zh', 'en', 'ja', 'ko', 'fr', 'es', 'pt'];

// Connect only to an existing host. Starting `codex app-server` would verify a
// different process and would leave the calling chat's tool catalog unchanged.
async function hostClient({ codex, socketPath, timeoutMs, env }) {
  const info = await lstat(socketPath);
  if (!info.isSocket() || info.isSymbolicLink() || process.getuid && info.uid !== process.getuid()) throw new Error('HOST_CONTROL_UNAVAILABLE');
  const javascriptCli = /\.[cm]?js$/i.test(codex);
  const child = spawn(javascriptCli ? process.execPath : codex,
    [...(javascriptCli ? [codex] : []), 'app-server', 'proxy', '--sock', socketPath],
    { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '', nextId = 0;
  const pending = new Map();
  function fail(error) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  }
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', () => fail(new Error('HOST_CONTROL_CLOSED')));
  child.stderr.resume(); // Host logs can contain private context; never forward them.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { fail(new Error('HOST_RESPONSE_TOO_LARGE')); child.kill(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail(new Error('HOST_PROTOCOL_INVALID')); child.kill(); return; }
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(Object.assign(new Error('HOST_REQUEST_REJECTED'), { code: message.error.code }));
      else entry.resolve(message.result);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('HOST_REQUEST_TIMEOUT')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  });
  const close = () => { fail(new Error('HOST_CONTROL_CLOSED')); child.stdin.end(); child.kill(); };
  try {
    await request('initialize', { clientInfo: { name: 'openmotion_installer', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return { request, close };
  } catch (error) { close(); throw error; }
}

export async function prepareCodexHostHandoff(options = {}) {
  const env = options.env ?? process.env;
  const threadId = options.threadId ?? env.CODEX_THREAD_ID ?? env.CODEX_SESSION_ID;
  const language = options.language ?? env.OPENMOTION_ONBOARDING_LANGUAGE ?? 'en';
  const presentation = { tool: presentationTool, arguments: {
    templateIds: options.templateIds ?? selectOnboardingTemplateIds(), onboarding: !options.welcomeDelivered,
    language: languages.includes(language) ? language : 'en',
  }, prerequisite: 'Visibly open the template library, then invoke this tool natively in the calling chat. Do not call the presentation through a shell probe.' };
  if (!options.welcomeDelivered) presentation.arguments.welcomeText = onboardingWelcomeText(presentation.arguments.language);
  const base = { threadId, expectedResourceUri: options.expectedResourceUri,
    welcomeStreamingVerified: false, hostSessionVerified: false, presentationVerified: false, presentation,
    welcomeMarkdown: options.welcomeDelivered ? '' : welcomeMarkdown(presentation.arguments.language) };
  const hostRequests = [
    { method: 'config/mcpServer/reload', params: null },
    { method: 'mcpServerStatus/list', params: { threadId, serverName: 'openmotion', detail: 'toolsAndAuthOnly' } },
  ];
  const required = reason => {
    const restart = ['HOST_CONTROL_UNAVAILABLE', 'NATIVE_PRESENTATION_UNAVAILABLE', 'NATIVE_PRESENTATION_SELECTION_UNSUPPORTED',
      'NATIVE_WELCOME_STREAMING_SCHEMA_UNSUPPORTED', 'NATIVE_PRESENTATION_RESOURCE_MISMATCH', 'HOST_VERSION_MISMATCH'].includes(reason);
    return { ...base, status: 'host_action_required', reason, hostRequests,
      ...(restart ? { manualAction: { kind: 'restart_mcp_connection', serverName: 'openmotion', threadId,
        instruction: 'In Codex Settings > MCP servers, Restart only the OpenMotion connection, then resume this saved installation in the same chat. Keep its workspace, template IDs/order and language. Do not reinstall or restart the application.' } } : {}),
      nextAction: (restart
        ? 'Use an available supported host reload action, or the supplied manualAction when automatic host control is unavailable. '
        : 'Resolve the reported chat, workspace or policy condition in the existing host; a connection restart does not resolve that condition. ')
        + 'Resume the saved installation and verify OpenMotion in this same chat. Registration and an independent probe do not complete onboarding. Do not reinstall, start another app-server, create a project, or claim native presentation succeeded.' };
  };
  if (!threadId) return required('CURRENT_CHAT_UNKNOWN');
  if (!options.dataDirectory) return required('EXPECTED_WORKSPACE_UNKNOWN');
  let client;
  let request = options.request;
  try {
    if (!request) {
      const socketPath = options.socketPath ?? env.OPENMOTION_CODEX_SOCKET
        ?? path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'app-server-control/app-server-control.sock');
      if (!path.isAbsolute(socketPath)) return required('HOST_CONTROL_UNAVAILABLE');
      try { client = await hostClient({ codex: options.codex ?? 'codex', socketPath, timeoutMs: options.timeoutMs ?? 10_000, env }); }
      catch { return required('HOST_CONTROL_UNAVAILABLE'); }
      request = client.request;
    }
    // Refuse a reachable but unrelated daemon before requesting any refresh.
    let cursor, loaded = false;
    for (let page = 0; page < 20; page++) {
      const list = await request('thread/loaded/list', { ...(cursor ? { cursor } : {}), limit: 100 });
      if (list.data?.includes(threadId)) { loaded = true; break; }
      cursor = list.nextCursor;
      if (!cursor) break;
    }
    if (!loaded) return required('CURRENT_CHAT_NOT_LOADED');
    const inventory = await request('mcpServerStatus/list', hostRequests[1].params);
    const server = inventory.data?.find(item => item.name === 'openmotion');
    if (server?.toolsError) return required('HOST_TOOL_DISCOVERY_FAILED');
    const tool = server?.tools?.[presentationTool];
    const acceptedIds = tool?.inputSchema?.properties?.templateIds?.items?.enum;
    let staleReason;
    if (!tool || !server.tools.openmotion_get_project) staleReason = 'NATIVE_PRESENTATION_UNAVAILABLE';
    else if (Array.isArray(acceptedIds) && presentation.arguments.templateIds.some(id => !acceptedIds.includes(id))) staleReason = 'NATIVE_PRESENTATION_SELECTION_UNSUPPORTED';
    else if (!options.welcomeDelivered && !tool.inputSchema?.properties?.welcomeText) staleReason = 'NATIVE_WELCOME_STREAMING_SCHEMA_UNSUPPORTED';
    else if (options.expectedVersion && server.serverInfo?.version !== options.expectedVersion) staleReason = 'HOST_VERSION_MISMATCH';
    else if (options.expectedResourceUri && tool._meta?.ui?.resourceUri !== options.expectedResourceUri) staleReason = 'NATIVE_PRESENTATION_RESOURCE_MISMATCH';
    if (staleReason) {
      if (options.verifyOnly) return required(staleReason);
      await request('config/mcpServer/reload', null);
      return { ...base, status: 'refresh_requested', reason: staleReason, hostRequests: hostRequests.slice(1),
        nextAction: 'Allow the current host step to finish, then resume the saved installation with --verify-only once. Preserve its template IDs/order, language, workspace and resource identity. A queued refresh is not a connected or displayed onboarding.' };
    }
    const project = await request('mcpServer/tool/call', { threadId, server: 'openmotion', tool: 'openmotion_get_project', arguments: {} });
    if (project.isError) return required('HOST_WORKSPACE_READ_FAILED');
    const directory = project.structuredContent?.dataDirectory;
    if (typeof directory !== 'string' || path.resolve(directory) !== path.resolve(options.dataDirectory)) return required('HOST_WORKSPACE_MISMATCH');
    return { ...base, status: 'ready_for_presentation', hostSessionVerified: true, threadId,
      nextAction: options.welcomeDelivered
        ? 'Keep the existing welcome and library. Call the prepared cards-only native Tool once with the same IDs/order and language. Do not replay the welcome or claim streaming acceptance.'
        : 'Open the library visibly and call the native presentation tool with the prepared IDs, language, onboarding:true and welcomeText LAST. Observe genuine incremental welcome text followed by three video cards inside the same App. Do not duplicate the welcome in chat. Schema support does not verify incremental host delivery; presentation and streaming remain unverified.' };
  } catch { return required('HOST_REQUEST_FAILED'); }
  finally { client?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--verify-only')) throw new Error('Resume the saved installation with scripts/install-onboarding.mjs APP_ROOT --resume RECEIPT --verify-only; do not redraw template IDs.');
  const { WorkspaceStore } = await import('../workspace.ts');
  const result = await prepareCodexHostHandoff({ dataDirectory: new WorkspaceStore().directory,
    expectedVersion: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
    verifyOnly: process.argv.includes('--verify-only'), language: process.argv.find(value => value.startsWith('--language='))?.slice(11) });
  console.log(JSON.stringify(result, null, 2));
}
