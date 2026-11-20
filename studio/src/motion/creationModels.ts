import { modelReferenceLimit, type Modality } from '../../../shared/gateway';
import { imageFeatures } from '../../../shared/image-features';
import { sceneFeature, supportsScene, type StudioScene } from './creativeStudios';
import type { loadGateway } from './gatewayClient';
import { isOpenDesignProvider, menuRank, providerRank, providerReady, withOpenDesignModels } from './imageMenuModels';

/** `openDesignOnly` serves feature entries: only OpenDesign models, with any other pinned model ignored.
 * With two or more references, models that accept fewer drop out (Seedream 5.5 rejects them with HTTP 400). */
export function creationModels(gateway: Awaited<ReturnType<typeof loadGateway>> | undefined, modality: Modality, modelId?: string | null, scene?: StudioScene, openDesignOnly = false, referenceCount = 0) {
  const providers = gateway?.status.providers ?? [];
  // Studios offer the same fixed list as the navigation menus; a pinned model stays so restored drafts keep working.
  const listed = (gateway ? withOpenDesignModels(gateway.models, providers).filter(model => model.modality === modality && (menuRank(model) >= 0 || model.id === modelId)
    && (!scene || supportsScene(model, scene)) && (!openDesignOnly || isOpenDesignProvider(model.provider))) : [])
    .sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || menuRank(a) - menuRank(b));
  // When nothing takes every reference, keep the list so the page can explain the limit instead of offering setup.
  const fitting = referenceCount >= 2 && modality === 'image' ? listed.filter(model => modelReferenceLimit(model) >= referenceCount) : listed;
  const compatible = fitting.length ? fitting : listed;
  const available = compatible.filter(model => providerReady(providers, model.provider));
  const pinned = modelId ? compatible.find(model => model.id === modelId) : undefined;
  const feature = scene && sceneFeature(scene);
  const recommended = (models: typeof listed) => feature ? models.find(model => model.modelId === imageFeatures[feature].recommended) : undefined;
  const preferred = pinned ?? (modelId && !openDesignOnly ? undefined
    : recommended(available) ?? available.find(model => model.id === gateway?.status.routes[modality]) ?? available[0]
      ?? (scene ? recommended(compatible) ?? compatible[0] : undefined));
  const selected = available.find(model => model.id === preferred?.id);
  const choices = scene ? compatible : available;
  return { available, selected, choices, compatible, preferred };
}
