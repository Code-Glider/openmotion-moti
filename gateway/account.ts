import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AccountSummary, DirectoryModel } from '../shared/provider-directory.ts';
import type { GenerationJob, Model } from '../shared/gateway.ts';
import { readSettings, writeSettings } from './settings-storage.ts';

const execute = promisify(execFile);
const consoleUrl = 'https://open-design.ai/cloud';
type Profile = { runtimeKey?: string; pendingLogin?: unknown; user?: { name?: string; email?: string } };
type AccountOptions = { pollMs?: number; binary?: string; run?: (args: string[], signal?: AbortSignal) => Promise<string>; spawn?: typeof spawn };

/** OpenDesign's versioned CLI owns device authorization, credentials and billing. */
export class OpenDesignAccount {
  readonly home: string;
  private child?: ChildProcess;
  private connecting = false;
  private signingOut = false;
  private stateWrites: Promise<void> = Promise.resolve();
  private generation = 0;
  private authorizationUrl?: string;
  private userCode?: string;
  private error?: string;
  private billing?: { plan?: string; balance: string | null };
  private billingUnavailable = false;
  private cachedModels: DirectoryModel[] = [];
  private runtime?: string;
  readonly directory: string;
  readonly options: AccountOptions;
  constructor(directory: string, options: AccountOptions = {}) { this.directory = directory; this.options = options; this.home = path.join(directory, 'account', 'credentials'); }
  private env() {
    // A different application's environment keys must not override this account session.
    const env: NodeJS.ProcessEnv = { ...process.env, AMR_HOME: this.home, OPEN_DESIGN_AMR_PROFILE: 'prod', VELA_PROFILE: 'prod' };
    for (const key of ['VELA_RUNTIME_KEY', 'VELA_CONTROL_KEY', 'VELA_LINK_URL', 'VELA_API_URL', 'OD_AMR_ENDPOINT_BINDING']) delete env[key];
    return env;
  }
  private async profile(): Promise<Profile | undefined> {
    const file = await readSettings<{ profiles?: Record<string, Profile> }>(path.join(this.home, 'config.json'), {});
    return file.profiles?.prod;
  }
  private commit(generation: number, task: () => Promise<void>) {
    this.stateWrites = this.stateWrites.catch(() => {}).then(async () => { if (generation === this.generation) await task(); });
    return this.stateWrites;
  }
  private async resolveRuntime(install = false) {
    if (this.options.binary || process.env.OPENMOTION_ACCOUNT_CLI) return this.options.binary || process.env.OPENMOTION_ACCOUNT_CLI!;
    if (this.runtime) return this.runtime;
    try { const { stdout } = await execute('vela', ['--version'], { timeout: 5000 }); if (stdout.trim() === '0.1.10') return this.runtime = 'vela'; } catch { /* Try the private managed installation. */ }
    const runtimeRoot = path.join(this.directory, 'account', 'runtime');
    const resolve = async () => {
      const binary = createRequire(path.join(runtimeRoot, 'package.json'))('@powerformer/vela-cli').resolveVelaCliBin({ strict: true }) as string;
      const { stdout } = await execute(binary, ['--version'], { timeout: 5000 });
      if (stdout.trim() !== '0.1.10') throw new Error('The installed account connector version is not supported');
      return binary;
    };
    try { return this.runtime = await resolve(); } catch { if (!install) throw new Error('Connect your OpenDesign account to prepare the account service.'); }
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
    // Fixed package/version only, installed outside the checkout; lifecycle scripts are disabled.
    const npmCli = path.resolve(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
    await execute(process.execPath, [npmCli, 'install', '--prefix', runtimeRoot, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '@powerformer/vela-cli@0.1.10'], { timeout: 300_000, maxBuffer: 1024 * 1024 });
    return this.runtime = await resolve();
  }
  async run(args: string[], signal?: AbortSignal) {
    if (this.options.run) return this.options.run(args, signal);
    try { const { stdout } = await execute(await this.resolveRuntime(), args, { env: this.env(), timeout: 60_000, signal, maxBuffer: 2 * 1024 * 1024 }); return stdout; }
    catch { throw new Error('OpenDesign account request failed. Check your connection and sign in again if needed.'); }
  }
  async summary(refresh = false): Promise<AccountSummary> {
    const generation = this.generation;
    const profile = await this.profile();
    const signedIn = Boolean(profile?.runtimeKey && !profile.pendingLogin && await this.identity());
    if (refresh && signedIn && !this.connecting) {
      try {
        const data = JSON.parse(await this.run(['billing', 'summary', '--format', 'json']));
        if (generation === this.generation) { this.billing = { plan: typeof data.membershipTier === 'string' ? data.membershipTier : undefined, balance: typeof data.balanceUsd === 'string' ? data.balanceUsd : typeof data.totalAvailableCreditsUsd === 'string' ? data.totalAvailableCreditsUsd : null }; this.billingUnavailable = false; }
      } catch { if (generation === this.generation) this.billingUnavailable = true; }
    }
    if (generation !== this.generation) return this.summary();
    return { state: this.connecting ? 'authorizing' : signedIn ? 'signed-in' : 'signed-out',
      ...(signedIn ? { user: { name: profile?.user?.name, email: profile?.user?.email }, ...this.billing, billingUnavailable: this.billingUnavailable } : {}),
      ...(this.connecting ? { authorizationUrl: this.authorizationUrl, userCode: this.userCode } : {}), error: this.error, consoleUrl };
  }
  async login() {
    const current = await this.summary();
    if (this.signingOut) throw new Error('Wait for sign-out to finish before connecting an account');
    if (this.connecting || current.state === 'signed-in') return this.summary();
    this.connecting = true; this.error = undefined; this.billing = undefined; this.cachedModels = [];
    this.authorizationUrl = undefined; this.userCode = undefined;
    const generation = ++this.generation;
    void this.authorize(generation).catch(() => {
      if (this.generation === generation) { this.connecting = false; this.error = 'Could not connect to OpenDesign. Retry sign-in.'; }
    });
    return this.summary();
  }
  private async authorize(generation: number) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    if (generation !== this.generation) return;
    await this.commit(generation, async () => {
      await writeSettings(path.join(this.directory, 'account', 'session.json'), {});
      await writeSettings(path.join(this.directory, 'account', 'models.json'), []);
    });
    const binary = await this.resolveRuntime(true);
    if (generation !== this.generation) return;
    const child = (this.options.spawn ?? spawn)(binary, ['login', '--completion-receipt=stdin-v1'], { env: this.env(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let output = '', protocol = false, accepting = false;
    const capture = (chunk: Buffer) => {
      if (generation !== this.generation) return;
      output = (output + chunk.toString()).slice(-32_768);
      protocol ||= output.includes('OPEN_DESIGN_AMR_AUTH_COMPLETION\tstdin-v1');
      const match = /Open this URL to continue:\s*\r?\n\s*(\S+)/i.exec(output);
      if (match) {
        try { const url = new URL(match[1]); if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'open-design.ai' || url.hostname.endsWith('.open-design.ai'))) this.authorizationUrl = url.href; } catch { /* Do not expose malformed or untrusted activation links. */ }
      }
      this.userCode = /^[^\S\r\n]*Code:\s*([A-Z0-9-]{3,40})/im.exec(output)?.[1];
      if (protocol && !accepting && output.includes('OPEN_DESIGN_AMR_AUTH_COMPLETION\tcredentials_persisted')) {
        accepting = true;
        void this.profile().then(async profile => {
          if (generation !== this.generation) return;
          await chmod(path.join(this.home, 'config.json'), 0o600);
          child.stdin?.write(profile?.runtimeKey ? 'credentials_accepted\n' : 'credentials_rejected\n');
        }).catch(() => child.kill());
      }
    };
    child.stdout?.on('data', capture);
    // CLI stderr is private: it can include account details and request bodies.
    child.stderr?.on('data', () => {});
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Account authorization expired')); }, 10 * 60_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Account authorization failed')); });
    });
    if (generation !== this.generation) return;
    this.child = undefined; this.authorizationUrl = undefined; this.userCode = undefined;
    if (!(await this.profile())?.runtimeKey) throw new Error('Account authorization did not complete');
    if (generation !== this.generation) return;
    await this.commit(generation, () => writeSettings(path.join(this.directory, 'account', 'session.json'), { id: randomUUID() }));
    if (generation !== this.generation) return;
    await this.models(true).catch(() => { this.error = 'Signed in, but the model catalogue could not be synced. Retry in Model providers.'; });
    if (generation !== this.generation) return;
    this.connecting = false;
    await this.summary(true);
  }
  async cancel() {
    const connecting = this.connecting, generation = ++this.generation;
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => { child.once('close', () => { clearTimeout(timer); resolve(); }); const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.kill(); });
    }
    if (connecting) await this.commit(generation, async () => {
      await writeSettings(path.join(this.directory, 'account', 'session.json'), {});
      await writeSettings(path.join(this.directory, 'account', 'models.json'), []);
      this.cachedModels = [];
    });
    this.connecting = false; this.authorizationUrl = undefined; this.userCode = undefined;
    return this.summary();
  }
  async logout() {
    if (this.signingOut) throw new Error('Sign-out is already in progress');
    this.signingOut = true;
    try {
      await this.cancel();
      this.billing = undefined; this.cachedModels = []; this.error = undefined;
      await this.commit(this.generation, async () => {
        await writeSettings(path.join(this.directory, 'account', 'session.json'), {});
        await writeSettings(path.join(this.directory, 'account', 'models.json'), []);
      });
      try { await this.run(['logout']); } catch { /* Always remove this installation's credentials, even offline. */ }
      await rm(path.join(this.home, 'config.json'), { force: true });
      return this.summary();
    } finally { this.signingOut = false; }
  }
  async models(refresh = false): Promise<DirectoryModel[]> {
    if (!(await this.profile())?.runtimeKey || !(await this.identity())) return [];
    if (!refresh) return this.cachedModels.length ? this.cachedModels : readSettings(path.join(this.directory, 'account', 'models.json'), []);
    const generation = this.generation;
    const data = JSON.parse(await this.run(['model', 'list', '--all', '--format', 'json']));
    if (data.source !== 'remote' || !Array.isArray(data.data)) throw new Error('OpenDesign model catalogue is unavailable');
    const models: DirectoryModel[] = data.data.filter((row: any) => typeof row.id === 'string' && /^[\w./:-]{1,180}$/.test(row.id)).map((row: any) => ({
      id: 'account:' + row.id, provider: 'account', modelId: row.id, label: String(row.label || row.id), kind: 'text', enabled: row.enabled !== false, source: 'live',
    }));
    const media = JSON.parse(await this.run(['media', 'models', '--json']));
    if (!Array.isArray(media.models)) throw new Error('OpenDesign media catalogue is unavailable');
    for (const row of media.models) {
      if (typeof row.model !== 'string' || !/^[\w./:-]{1,180}$/.test(row.model) || !['image', 'video', 'audio'].includes(row.kind)) continue;
      models.push({ id: 'account:' + row.model, provider: 'account', modelId: row.model, label: row.model, kind: row.kind, enabled: row.enabled !== false, source: 'live', mode: row.kind === 'audio' ? 'text-to-speech' : `text-to-${row.kind}` });
    }
    if (generation !== this.generation) return [];
    await this.commit(generation, async () => {
      this.cachedModels = [...new Map(models.map(model => [model.id, model])).values()];
      await writeSettings(path.join(this.directory, 'account', 'models.json'), this.cachedModels);
    });
    return this.cachedModels;
  }
  async identity() { return (await readSettings<{ id?: string }>(path.join(this.directory, 'account', 'session.json'), {})).id; }
  async mediaModels(): Promise<Model[]> {
    return (await this.models()).filter(model => model.enabled && ['image', 'video', 'audio'].includes(model.kind)).map(model => ({ ...model, modality: model.kind as Model['modality'], mode: model.mode! }));
  }
  async generate(job: GenerationJob, directory: string, signal: AbortSignal, progress: (phase: string, id?: string) => Promise<void>) {
    if (job.providerOrigin !== await this.identity() || (await this.summary()).state !== 'signed-in') throw new Error('Account changed; the queued task was not submitted');
    const kind = job.modality, params = { ...job.model.defaults, ...job.parameters };
    const allowed = kind === 'image' ? ['aspect_ratio', 'resolution', 'quality', 'size'] : kind === 'video' ? ['ratio', 'resolution', 'duration', 'generate_audio'] : ['voice'];
    if (Object.keys(params).some(key => !allowed.includes(key))) throw new Error('Unsupported account model parameter');
    if (kind === 'audio' && (typeof params.voice !== 'string' || !params.voice)) throw new Error('Choose a voice in parameters.voice');
    const args = [kind, kind === 'audio' ? 'speech' : 'gen', '--model', job.model.modelId, '--prompt', job.prompt, '--no-wait', '--json'];
    for (const [key, value] of Object.entries(params)) {
      if (key === 'generate_audio') { if (value === true) args.push('--generate-audio'); }
      else if (typeof value === 'string' || typeof value === 'number') args.push('--' + key.replaceAll('_', '-'), String(value));
      else throw new Error('Invalid account model parameter');
    }
    const submitted = JSON.parse(await this.run(args, signal));
    if (typeof submitted.task_id !== 'string' || !/^[\w-]{1,180}$/.test(submitted.task_id)) throw new Error('Account provider did not return a task ID');
    const taskId = submitted.task_id;
    await progress('submitted', taskId);
    const output = path.join(directory, 'account-output.bin');
    for (;;) {
      await delay(this.options.pollMs ?? 2000, undefined, { signal });
      if (job.providerOrigin !== await this.identity()) throw new Error('Account changed; check the original task before retrying');
      const task = JSON.parse(await this.run([kind, 'get', taskId, '--output', output, '--json'], signal));
      if (task.task_id !== taskId) throw new Error('Account provider returned an unexpected task');
      if (task.status === 'succeeded') {
        const info = await lstat(output);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 * 1024) throw new Error('Invalid account media output');
        return [await readFile(output)];
      }
      if (['failed', 'cancelled', 'canceled'].includes(task.status)) throw new Error('Account media task failed. Check the original task before retrying.');
      if (!['queued', 'pending', 'running', 'processing', 'submitted'].includes(task.status)) throw new Error('Unknown account media task status');
      await progress('generating');
    }
  }
  close() { this.generation++; this.child?.kill(); }
}
