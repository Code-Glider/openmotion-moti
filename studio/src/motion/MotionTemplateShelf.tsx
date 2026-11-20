import { Button } from 'open-design-ui/button';
import { useState, type RefObject } from 'react';
import { isEditableTemplate } from '../../../shared/catalog';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { ExploreShelf } from './ExploreShelf';
import { reportCreativeClick } from './exploreTracking';
import { optionId, send } from './reporting';
import { collectionFacet, industryCollection, type TemplateCollection } from './templateCollections';
import { discoveryIndustries, discoveryPurposes, orderedPurposes } from './templateDiscoveryTaxonomy';
import { TemplateGalleryCard } from './TemplateGalleryCard';
import { TemplateIndustryMenu } from './TemplateIndustryMenu';
import { useCoveredTemplates } from './useCoveredTemplates';
import { useTemplatePlayback } from './useTemplatePlayback';
import { useWorkspaceChrome } from './WorkspaceChromeContext';

const batchSize = 16;

export function MotionTemplateShelf({ root, active }: { root: RefObject<HTMLElement | null>; active: boolean }) {
  const { locale, t } = useI18n();
  const { openLibrary } = useWorkspaceChrome();
  const { catalog, firstPage, failed, retry } = useCoveredTemplates(locale, true, { showFirstPage: true });
  const [collection, setCollection] = useState<TemplateCollection | null>(null);
  const [limit, setLimit] = useState(batchSize);
  const [priority, setPriority] = useState<string | null>(null);
  const facet = collectionFacet(collection);
  const purposes = catalog ? orderedPurposes(catalog.flatMap(discoveryPurposes)) : [];
  const industries = catalog ? [...new Set(catalog.flatMap(discoveryIndustries))] : [];
  const categories: readonly (readonly [TemplateCollection | 'all', string])[] = catalog
    ? [['all', 'All'], ...purposes.map(purpose => [`purpose:${purpose}`, purpose] as const), ['builtin', 'Editable templates']]
    : [['all', 'All']];
  const matches = (catalog ?? firstPage?.items ?? []).filter(item => {
    if (collection === 'builtin') return isEditableTemplate(item);
    if (!facet) return true;
    return (facet.key === 'uses' ? discoveryPurposes(item) : discoveryIndustries(item)).includes(facet.value);
  });
  const count = catalog ? matches.length : firstPage?.total;
  const visible = matches.slice(0, limit);
  const playing = useTemplatePlayback(root, visible.map(item => item.id).join('|'), active, true, priority, true);
  const selectCollection = (next: TemplateCollection | null, group: 'uses' | 'industries' | 'editable') => {
    if (next === collection) return;
    setCollection(next);
    setLimit(batchSize);
    setPriority(null);
    send('ui_click', { page_name: 'creative_studio', area: 'studio_bar', element: 'category_select', studio_id: 'motion',
      filter_group: group, ...optionId(collectionFacet(next)?.value ?? next ?? 'all') });
  };

  return <ExploreShelf<TemplateCollection | 'all'> title="Motion templates" categoriesLabel="Template categories" categories={categories} selected={collection ?? 'all'}
    onCategory={value => selectCollection(value === 'all' ? null : value, value === 'builtin' ? 'editable' : 'uses')}
    filters={<TemplateIndustryMenu industries={industries} selected={facet?.key === 'industries' ? [facet.value] : undefined}
      onSelect={value => selectCollection(value ? industryCollection(value) : null, 'industries')} />}
    action="Template library" onOpen={trigger => {
      reportCreativeClick('creative_studio', 'studio_bar', 'view_all_templates', { studio: 'motion' });
      openLibrary(trigger, undefined, collection ?? undefined);
    }}>
    {count != null && <span className="om-muted" role="status">{t('{count} templates', { count })}</span>}
    {!failed && !catalog && !firstPage && <div className="om-studio-template-grid" role="status" aria-label={t('Loading templates…')}>
      {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} />)}</div>}
    <div className="om-studio-template-grid">
      {visible.map((item, index) => {
        const tags = [...new Set([discoveryPurposes(item)[0], item.styles?.[0]].filter((tag): tag is string => Boolean(tag)))];
        return <TemplateGalleryCard key={item.id} template={item} active={playing.has(item.id)} onPriority={setPriority}
          onSelect={(template, trigger) => {
            reportCreativeClick('creative_studio', 'studio_bar', 'open_template', { studio: 'motion', template: template.id, position: index + 1 });
            openLibrary(trigger, template);
          }} footer={tags.length > 0 && <div className="om-motion-template-tags">
            {tags.map(tag => <span key={tag} className="om-badge">{t(tag)}</span>)}
          </div>} />;
      })}
    </div>
    {catalog && !matches.length && <p className="om-muted">{t('No matching templates.')}</p>}
    {visible.length < matches.length && <Button variant="plain" type="button" className="om-button om-shelf-more" onClick={() => {
      reportCreativeClick('creative_studio', 'studio_bar', 'load_more', { studio: 'motion' });
      setLimit(previous => previous + batchSize);
    }}>{t('More templates')}<RemixIcon name="arrow-down-line" size={16} /></Button>}
    {failed && <div className="om-discovery-empty" role="alert"><span>{t('Templates could not be loaded.')}</span>
      <Button variant="ghost" className="om-button h-auto" onClick={retry}>{t('Retry')}</Button></div>}
  </ExploreShelf>;
}
