/** Settings contracts contain public metadata only. Credentials remain service-owned. */
export const modelKinds = ['text', 'image', 'video', 'audio', 'embedding', 'reranker'] as const;
export type ModelKind = typeof modelKinds[number];
export type ProviderProtocol = 'openai' | 'anthropic' | 'google' | 'media' | 'account' | 'agent';
export type ProviderCategory = 'account' | 'multimodal' | 'language' | 'media' | 'local' | 'custom';
export type ProviderDefinition = {
  id: string; label: string; protocol: ProviderProtocol; baseUrl: string;
  kinds: ModelKind[]; category: ProviderCategory; website?: string; docs?: string;
  setupRequired?: boolean;
  baseUrlEditable?: boolean;
};
export type ProviderConnection = ProviderDefinition & {
  configured: boolean; enabled: boolean; available: boolean; custom: boolean;
  credentialSource: 'stored' | 'environment' | 'local-agent' | 'account' | 'none';
  reason: string;
};
export const modelCapabilities = ['reasoning', 'tools'] as const;
export const inputModalities = ['vision', 'audio', 'video'] as const;
export type ModelMetadata = {
  group?: string; capabilities?: typeof modelCapabilities[number][]; inputs?: typeof inputModalities[number][];
  contextWindow?: number | null; maxInputTokens?: number | null; maxOutputTokens?: number | null;
  defaults?: Record<string, unknown>;
};
export type DirectoryModel = ModelMetadata & {
  id: string; provider: string; modelId: string; label: string; kind: ModelKind;
  enabled: boolean; source: 'builtin' | 'live' | 'custom'; mode?: string;
};
export type ProviderDirectory = {
  providers: ProviderConnection[]; models: DirectoryModel[];
  defaults: Partial<Record<ModelKind, string>>;
};
export type AccountSummary = {
  state: 'signed-out' | 'authorizing' | 'signed-in' | 'unavailable';
  user?: { name?: string; email?: string }; authorizationUrl?: string; userCode?: string;
  plan?: string; balance?: string | null; billingUnavailable?: boolean; error?: string;
  consoleUrl: string;
};
