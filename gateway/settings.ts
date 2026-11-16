import type { DirectoryModel, ModelKind, ProviderConnection, ProviderDirectory } from '../shared/provider-directory.ts';
import { modalities, type Modality } from '../shared/gateway.ts';
import { mediaProviders } from '../shared/gateway.ts';
import type { ModelGateway } from './service.ts';

const mediaMetadata: Record<string, { website: string; baseUrl: string }> = {
  fal: { website: 'https://fal.ai/dashboard/keys', baseUrl: 'https://queue.fal.run' },
  atlascloud: { website: 'https://www.atlascloud.ai/console/api-keys', baseUrl: 'https://api.atlascloud.ai' },
  wavespeed: { website: 'https://wavespeed.ai/accesskey', baseUrl: 'https://api.wavespeed.ai' },
  opendesign: { website: 'https://open-design.ai/cloud/dashboard', baseUrl: '' },
};
export async function providerDirectory(gateway: ModelGateway): Promise<ProviderDirectory> {
  const [status, connections, saved, account, accountModels] = await Promise.all([
    gateway.status(), gateway.connections.list(), gateway.connections.config(), gateway.account.summary(), gateway.account.models(),
  ]);
  const media: ProviderConnection[] = status.providers.filter(p => p.id === 'codex' || mediaProviders.includes(p.id as typeof mediaProviders[number])).map(provider => ({
    ...provider, baseUrl: provider.baseUrl ?? mediaMetadata[provider.id]?.baseUrl ?? '',
    protocol: provider.id === 'codex' ? 'agent' : 'media', category: provider.id === 'codex' ? 'local' : 'multimodal',
    kinds: provider.id === 'codex' ? ['image'] : ['image', 'video', 'audio'], custom: false,
    website: mediaMetadata[provider.id]?.website, docs: provider.id === 'codex' ? undefined : `/motion-api/models/providers/${provider.id}/reference`,
  }));
  const official: ProviderConnection = { id: 'account', label: 'OpenDesign', protocol: 'account', category: 'account', kinds: ['text', 'image', 'video', 'audio'], baseUrl: '',
    custom: false, configured: account.state === 'signed-in', enabled: account.state === 'signed-in', available: account.state === 'signed-in',
    credentialSource: account.state === 'signed-in' ? 'account' : 'none', reason: account.state === 'signed-in' ? 'Included with your account' : account.state === 'reauth-required' ? 'OpenDesign sign-in expired; sign in again to use your account models' : 'Sign in to use your account models', website: account.consoleUrl };
  const models: DirectoryModel[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    const page = await gateway.listModels({ offset, limit: 100 });
    models.push(...page.models.filter(model => media.some(p => p.id === model.provider)).map(model => ({ ...model, kind: model.modality, enabled: true })));
    offset = page.nextOffset;
  }
  return { providers: [official, ...media, ...connections], models: [...models, ...saved.models, ...accountModels].map(model => ({ ...model, ...saved.modelOverrides?.[model.id] })), defaults: { ...saved.defaults, ...status.routes } };
}
export async function syncProvider(gateway: ModelGateway, id: string) {
  if (id === 'account') await gateway.account.models(true);
  else if (mediaProviders.includes(id as typeof mediaProviders[number])) {
    const result = await gateway.listModels({ provider: id, refresh: true });
    if (result.warnings.length) throw new Error(result.warnings.join('. '));
  } else if (id === 'codex') await gateway.status(true);
  else await gateway.connections.sync(id);
}
export async function setDefaultModel(gateway: ModelGateway, kind: ModelKind, id: string | null) {
  const directory = await providerDirectory(gateway);
  const model = directory.models.find(model => model.id === id && model.kind === kind && model.enabled);
  if (id && (!model || !directory.providers.find(provider => provider.id === model.provider)?.available)) throw new Error('Choose an enabled model from a configured provider');
  if (modalities.includes(kind as Modality)) await gateway.setRoute(kind, id);
  else await gateway.connections.setDefault(kind, id);
}
