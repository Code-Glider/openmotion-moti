import type { GalleryTemplate } from '../../../shared/catalog';
import type { Translate } from '../i18n/messages';
import { matchesGallerySearch } from './GalleryFilters';
import { facetValues, templateFacets } from './templateDiscovery';

export const normalizedTemplateQuery = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Task aliases describe verified resource metadata, never every brand campaign. */
export function matchesTemplateSearch(item: GalleryTemplate, query: string, t: Translate) {
  const text = [item.id, item.title, item.description, item.authorName, item.author, ...item.tags,
    ...templateFacets.flatMap(([key]) => facetValues(item, key).flatMap(value => [value, t(value)]))].filter(Boolean).join(' ');
  const task = normalizedTemplateQuery(query);
  const demo = ['产品演示', '功能演示', 'product demo'];
  const promo = ['产品宣传', 'product promo'];
  const verifiedPromo = item.id === 'product-promo';
  const uses = facetValues(item, 'uses').join(' ').toLowerCase();
  if (demo.includes(task)) return verifiedPromo || /product demo|功能演示|产品演示|产品功能演示/.test(uses);
  if (promo.includes(task)) return verifiedPromo || /product promo|产品宣传/.test(uses);
  // Short brand acronyms must be genuine words, not a fragment of “anything”.
  if (task === 'nyt') return /(?:^|[^a-z])nyt(?:$|[^a-z])/i.test(text);
  return matchesGallerySearch(task, text);
}

export function validReferenceLink(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value.trim()).protocol); } catch { return false; }
}

export { templateSearchBrief } from '../../../shared/template-search-brief.ts';
