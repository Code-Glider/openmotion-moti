import type { Modality } from './gateway.ts';

/** A reference always pins immutable bytes, never the asset's changing current version. */
export type AssetReference = { assetId: string; versionId: string };
export type AssetVersion = {
  id: string; createdAt: number; source: 'upload' | 'generated'; filename: string; name?: string;
  mimeType: string; bytes: number; sha256: string; width?: number; height?: number; duration?: number;
  prompt?: string; model?: string; parameters?: Record<string, unknown>;
  references: AssetReference[]; parentVersionId?: string; jobId?: string; conversationId?: string;
  requestId?: string; requestHash?: string;
};
export type LibraryAsset = {
  id: string; name: string; modality: Modality; createdAt: number; updatedAt: number;
  currentVersionId: string; versions: AssetVersion[]; trashedAt?: number;
};
export type LibraryGeneration = {
  assetId?: string; title?: string; parentVersionId?: string;
  references?: AssetReference[]; conversationId?: string;
};
export type AssetListInput = {
  modality?: Modality; source?: 'upload' | 'generated'; query?: string; trash?: boolean;
  sort?: 'newest' | 'oldest' | 'name'; offset?: number; limit?: number;
};
export const assetVersion = (asset: LibraryAsset, versionId = asset.currentVersionId) => asset.versions.find(version => version.id === versionId);
export const assetMediaUrl = (assetId: string, versionId: string) => `/motion-api/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/file`;
