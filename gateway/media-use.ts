import type { WorkspaceStore } from '../workspace.ts';
import { mediaProviders, type GenerateInput } from '../shared/gateway.ts';
import { gatewayFor } from './service.ts';
import { getWorkflow } from '../shared/workflow.ts';

export async function mediaUse(store: WorkspaceStore, args: any) {
  const gateway = gatewayFor(store);
  const connections = await gateway.connections.list();
  const supported = (id: string) => mediaProviders.includes(id as typeof mediaProviders[number]) || id === 'account' || connections.some(p => p.id === id && p.protocol === 'openai' && !p.setupRequired);
  const referenceSection = (id: string) => mediaProviders.includes(id as typeof mediaProviders[number]) ? id : id === 'account' ? 'account' : 'compatible';
  if (args.provider !== undefined && !supported(args.provider)) throw new Error('INVALID_ARGUMENT: unsupported media provider');
  if (args.action === 'inspect') {
    const status = await gateway.status();
    const providers = status.providers.filter(p => supported(p.id) && (mediaProviders.includes(p.id as any) || p.configured || p.id === 'account'));
    const capabilities = await gateway.mediaCapabilities(providers.filter(p => p.available).map(p => p.id));
    return { providers, capabilities, setupRequired: !providers.some(p => p.available),
      capabilityNote: 'speech = narration/dialogue (text-to-speech); music = other audio. Lists come from built-in and cached catalogs: confirm an empty kind with action "models" and refresh: true before telling the user it is unsupported.',
      defaults: status.routes,
      settings: 'Open Settings > Model providers (Chinese UI: 设置 > 模型供应商), or Account for OpenDesign sign-in. Saving a key enables a provider; sync or add its models and select defaults by capability.',
      references: status.providers.filter(p => supported(p.id)).map(p => ({ provider: p.id, uri: `openmotion://workflow/production/${referenceSection(p.id)}` })),
      credentials: 'Read by the local service; keys are never returned to the Agent.' };
  }
  if (args.action === 'reference') {
    if (!args.provider) throw new Error('INVALID_ARGUMENT: provider is required');
    return getWorkflow(referenceSection(args.provider), 'production');
  }
  if (args.action === 'models') {
    const providers = (await gateway.status()).providers.filter(p => supported(p.id) && (!args.provider || p.id === args.provider) && p.enabled);
    const pages = await Promise.all(providers.map(provider => gateway.listModels({ provider: provider.id, modality: args.modality, refresh: args.refresh, query: args.query, offset: args.offset, limit: args.limit })));
    return { providers: providers.map(p => p.id), catalogs: pages, setupRequired: !providers.length };
  }
  if (!args.projectId || !store.projectCatalog().projects.some(p => p.id === args.projectId)) throw new Error('PROJECT_NOT_FOUND');
  if (args.action === 'generate') {
    if (!args.provider || !args.model || !args.requestId || !args.modality || typeof args.prompt !== 'string') throw new Error('INVALID_ARGUMENT: provider, model, projectId, requestId, modality and prompt are required');
    const job = await gateway.submit({ projectId: args.projectId, model: `${args.provider}:${args.model}`, modality: args.modality,
      prompt: args.prompt, parameters: args.parameters, mode: args.mode, idempotencyKey: args.requestId } as GenerateInput);
    return { projectId: job.projectId, job, next: { action: 'status', projectId: job.projectId, jobId: job.id } };
  }
  if (args.action === 'status' || args.action === 'cancel') {
    const job = await gateway.getJob(args.jobId);
    if (job.projectId !== args.projectId || job.model.provider === 'codex') throw new Error('GENERATION_NOT_FOUND: job does not belong to this project');
    if (args.action === 'cancel' && !args.requestId) throw new Error('INVALID_ARGUMENT: requestId is required');
    return { projectId: job.projectId, job: args.action === 'cancel' ? await gateway.cancel(job.id) : job };
  }
  throw new Error('INVALID_ARGUMENT: unsupported media action');
}
