import { aiTechnologyIndustry } from './templateDiscoveryTaxonomy';

export const formatCategories = { builtin: 'Editable templates', ads: 'Product promos', 'short-form': 'Short-form video' } as const;
export function isFormatCategory(id: string | null | undefined): id is keyof typeof formatCategories {
  return id != null && Object.hasOwn(formatCategories, id);
}
const collections = ['top-100-brands', 'ai-technology', 'black-friday'] as const;
export type TemplateCollection = typeof collections[number] | keyof typeof formatCategories | `purpose:${string}` | `industry:${string}`;

export function findTemplateCollection(id: string | null): TemplateCollection | null {
  if (id?.startsWith('purpose:') && id.slice(8).trim()) return `purpose:${id.slice(8).trim()}`;
  if (id?.startsWith('industry:') && id.slice(9).trim()) return `industry:${id.slice(9).trim()}`;
  if (isFormatCategory(id)) return id;
  return collections.find(value => value === id) ?? null;
}

export function collectionFacet(collection?: TemplateCollection | null): { key: 'uses' | 'industries'; value: string } | null {
  if (collection === 'ai-technology') return { key: 'industries', value: aiTechnologyIndustry };
  if (collection?.startsWith('purpose:')) return { key: 'uses', value: collection.slice(8) };
  if (collection?.startsWith('industry:')) return { key: 'industries', value: collection.slice(9) };
  return null;
}

export function industryCollection(value: string): TemplateCollection {
  return value === aiTechnologyIndustry ? 'ai-technology' : `industry:${value}`;
}
