import { blackFridayTemplates } from '../../../shared/black-friday-collection';
import { groupBrandSeries, rankDiscoverySeries } from './brandStoryData';
import { collectionFacet, formatCategories, isFormatCategory, type TemplateCollection } from './templateCollections';
import { facetValues } from './templateDiscovery';
import { aiTechnologyIndustry, discoveryIndustries, discoveryPurposes, orderedPurposes, purposeOrder } from './templateDiscoveryTaxonomy';
import { useCoveredTemplates } from './useCoveredTemplates';
import { useEffect, useMemo, useState } from 'react';
import type { GalleryTemplate, TemplatePage } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { TemplateGalleryCard } from './TemplateGalleryCard';
import { motionApi } from './useWorkspace';
import { useWorkspaceChrome } from './WorkspaceChromeContext';

// Each Explore collection owns its loaded pages. New pages append to the existing collection.
export function useExploreTemplates(category: string | undefined, locale: string, search = '', limit = 8) {
  const [pages, setPages] = useState<TemplatePage[]>([]);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(Boolean(category));
  const queryKey = JSON.stringify([category, locale, search, limit]);
  const [loadedQuery, setLoadedQuery] = useState(queryKey);
  if (loadedQuery !== queryKey) {
    setLoadedQuery(queryKey);
    setPages([]);
    setOffset(0);
    setError(false);
    setLoading(Boolean(category));
  }
  useEffect(() => {
    if (!category) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ category, locale, covered: 'true', limit: String(limit), offset: String(offset) });
    if (search) query.set('query', search);
    motionApi<TemplatePage>('/template-catalog?' + query, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    }).then(page => {
      if (!Array.isArray(page.items)) throw new Error('Invalid template page');
      if (controller.signal.aborted) return;
      setPages(previous => {
        const seen = new Set(previous.flatMap(group => group.items.map(item => item.id)));
        const items = page.items.filter(item => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        return [...previous, { ...page, items }];
      });
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [category, locale, offset, attempt, search, limit]);
  const next = pages.at(-1)?.next;
  function loadMore() {
    if (loading || next == null || next <= offset) return;
    setLoading(true);
    setOffset(next);
  }
  function retry() {
    setLoading(true);
    setError(false);
    setAttempt(value => value + 1);
  }
  return { pages, loading, error, hasMore: next != null && next > offset, retry, loadMore };
}

export type ExploreTemplateFilter = TemplateCollection | 'all';

function exploreCategories(purposes: string[]): (readonly [ExploreTemplateFilter, string])[] {
  return [
    ['all', 'All'], ['top-100-brands', 'TOP 100 brands'],
    ...purposes.map(purpose => [`purpose:${purpose}`, purpose] as const),
    ['ai-technology', aiTechnologyIndustry], ['black-friday', 'Black Friday collection'],
    ...Object.entries(formatCategories).map(([id, label]) => [id as keyof typeof formatCategories, label] as const),
  ];
}

function industryPreview(matches: GalleryTemplate[], limit: number) {
  const brands = new Set<string>();
  const firstWorks = matches.filter(item => {
    const brand = item.brand?.trim();
    if (!brand) return true;
    if (brands.has(brand)) return false;
    brands.add(brand);
    return true;
  });
  return [...new Set([...firstWorks, ...matches])].slice(0, limit);
}

export function useExploreTemplateShelf(filter: ExploreTemplateFilter, locale: string, enabled: boolean, active: boolean, all: ReturnType<typeof useExploreTemplates>, limit: number) {
  const collection = filter === 'all' ? null : filter;
  const curated = useCoveredTemplates(locale, enabled && active);
  const filtered = useExploreTemplates(enabled && isFormatCategory(filter) ? filter : undefined, locale, '', limit);
  const page = filter === 'all' ? all : filtered;
  const categories = useMemo(() => exploreCategories(curated.catalog ? orderedPurposes(curated.catalog.flatMap(discoveryPurposes)) : purposeOrder), [curated.catalog]);
  const industries = useMemo(() => [...new Set(curated.catalog?.flatMap(discoveryIndustries))], [curated.catalog]);
  const items = useMemo(() => {
    const catalog = curated.catalog ?? [];
    if (collection === 'top-100-brands') return rankDiscoverySeries(groupBrandSeries(catalog)).slice(0, limit).map(brand => brand.items[0]);
    if (collection === 'black-friday') return blackFridayTemplates(catalog, locale).flatMap(stage => stage.items).slice(0, limit);
    const facet = collectionFacet(collection);
    if (facet) {
      const matches = catalog.filter(item => facetValues(item, facet.key).includes(facet.value));
      return facet.key === 'industries' ? industryPreview(matches, limit) : matches.slice(0, limit);
    }
    return page.pages[0]?.items.slice(0, limit) ?? [];
  }, [collection, curated.catalog, locale, limit, page.pages]);
  const shelf = { items, collection, categories, industries };
  if (!collection || isFormatCategory(collection)) return { ...shelf, loading: page.loading, error: page.error, retry: page.retry };
  // The campaign ships its published references so it can open while the live catalogue is unavailable.
  const requiresCatalog = collection !== 'black-friday';
  return { ...shelf, loading: requiresCatalog && !curated.catalog && !curated.failed, error: requiresCatalog && curated.failed, retry: curated.retry };
}

export function TemplatePromptAction({ item, onTry }: { item: GalleryTemplate; onTry: (prompt: string) => void }) {
  const { t } = useI18n();
  const prompt = [item.description?.trim(), item.styleDescription?.trim()].filter(Boolean).join('\n\n');
  if (!prompt) return null;
  return <button className="om-nav-item" onClick={() => onTry(prompt)}>
    <RemixIcon name="movie-line" size={15} />{t('Try as a video prompt')}<RemixIcon name="arrow-right-line" size={15} />
  </button>;
}

export function ExploreTemplateCard({ item, active, onPriority, onTry }: {
  item: GalleryTemplate; active: boolean; onPriority: (id: string | null) => void; onTry: (prompt: string) => void;
}) {
  const { openLibrary } = useWorkspaceChrome();
  return <TemplateGalleryCard template={item} playbackId={'community/' + item.id} active={active} onPriority={onPriority}
    onSelect={(template, trigger) => openLibrary(trigger, template.id)}
    footer={<div className="om-feed-template-copy">
      <strong>{item.title}</strong>
      {item.description && <p>{item.description}</p>}
      <TemplatePromptAction item={item} onTry={onTry} />
    </div>} />;
}
