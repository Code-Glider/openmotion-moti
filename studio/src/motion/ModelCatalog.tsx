import { Button } from "open-design-ui/button";
import { IconButton } from "open-design-ui/icon-button";
import { Tooltip } from "../components/ui/Tooltip";
import { useState, type ReactNode } from 'react';
import { inputModalities, modelCapabilities, modelKinds, type DirectoryModel } from '../../../shared/provider-directory';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Menu, MenuCheckboxItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../components/ui/Menu';
import { capabilityLabels, kindLabels } from './ModelEditor';

const sortOptions = [
  ['catalogue', 'Default'],
  ['name', 'Name'],
  ['context', 'Context window'],
] as const;

export function ModelCatalog({ models, defaultIds, render }: { models: DirectoryModel[]; defaultIds?: ReadonlySet<string>; render: (model: DirectoryModel) => ReactNode }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(''), [activeKind, setActiveKind] = useState('all'), [filters, setFilters] = useState<string[]>([]), [sort, setSort] = useState('catalogue'), [grouped, setGrouped] = useState(true), [collapsed, setCollapsed] = useState<string[]>([]);
  const kindCounts = modelKinds.map(kind => ({ kind, count: models.filter(model => model.kind === kind).length })).filter(item => item.count > 0);
  const showKindTabs = kindCounts.length > 1;
  const resolvedKind = activeKind === 'all' || kindCounts.some(item => item.kind === activeKind) ? activeKind : 'all';
  const sections = [
    { title: 'Model type', values: modelKinds.map(kind => ({ id: `kind:${kind}`, label: kindLabels[kind] })) },
    { title: 'Model capabilities', values: modelCapabilities.map(value => ({ id: `cap:${value}`, label: capabilityLabels[value] })) },
    { title: 'Input modalities', values: inputModalities.map(value => ({ id: `input:${value}`, label: capabilityLabels[value] })) },
    { title: 'Status', values: [{ id: 'status:enabled', label: 'Enabled' }, { id: 'status:disabled', label: 'Disabled' }] },
    { title: 'Source', values: [{ id: 'source:builtin', label: 'Built-in' }, { id: 'source:live', label: 'Synced' }, { id: 'source:custom', label: 'Custom' }] },
  ];
  const selectKind = (kind: string) => {
    setActiveKind(kind);
    setFilters(current => current.filter(value => !value.startsWith('kind:')));
  };
  const toggle = (id: string) => {
    if (id.startsWith('kind:')) setActiveKind('all');
    setFilters(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  };
  const scopedModels = resolvedKind === 'all' ? models : models.filter(model => model.kind === resolvedKind);
  const filtered = scopedModels.filter(model => {
    if (!`${model.label} ${model.modelId} ${model.group ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    return sections.every(section => { const selected = section.values.filter(value => filters.includes(value.id)); return !selected.length || selected.some(({ id }) => { const [type, value] = id.split(':'); return type === 'kind' ? model.kind === value : type === 'cap' ? model.capabilities?.some(item => item === value) : type === 'input' ? model.inputs?.some(item => item === value) : type === 'source' ? model.source === value : model.enabled === (value === 'enabled'); }); });
  }).sort((a, b) => {
    if (sort === 'name') return a.label.localeCompare(b.label);
    if (sort === 'context') return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
    if (defaultIds?.size) {
      const aDefault = defaultIds.has(a.id) ? 0 : 1;
      const bDefault = defaultIds.has(b.id) ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;
    }
    return 0;
  });
  const hasNamedGroups = models.some(model => Boolean(model.group?.trim()));
  const showGroups = grouped && hasNamedGroups;
  const groups = Map.groupBy(filtered, model => showGroups ? model.group?.trim() || 'Ungrouped' : '');
  const groupKeys = [...groups.keys()];
  const allCollapsed = groupKeys.length > 0 && groupKeys.every(group => collapsed.includes(group));
  const activeMenuCount = filters.length + (sort !== 'catalogue' ? 1 : 0);
  const isFiltered = filters.length > 0 || query.trim().length > 0 || sort !== 'catalogue';
  const sortLabel = sortOptions.find(([value]) => value === sort)?.[1] ?? 'Default';
  return <>
    {models.length > 0 && <>
      {showKindTabs && <div className="om-model-kind-tabs" role="tablist" aria-label={t('Model type')}>
        <Button variant="plain" role="tab" aria-selected={resolvedKind === 'all'} className="om-model-kind-tab" onClick={() => selectKind('all')}>
          <span>{t('All')}</span><small>{models.length}</small>
        </Button>
        {kindCounts.map(({ kind, count }) => (
          <Button variant="plain" role="tab" key={kind} aria-selected={resolvedKind === kind} className="om-model-kind-tab" onClick={() => selectKind(kind)}>
            <span>{t(kindLabels[kind])}</span><small>{count}</small>
          </Button>
        ))}
      </div>}
      <div className="om-model-filters">
        <label className="om-field"><RemixIcon name="search-line" size={15} /><input type="search" aria-label={t('Search models')} placeholder={t('Search models…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="om-model-filter-controls">
          <Menu className="om-filter-menu" modal={false} aria-label={t('Filter models')} trigger={<Button variant="ghost" className="om-button h-auto" data-active={activeMenuCount > 0 || undefined} aria-label={t('Filter models')}><RemixIcon name="filter-3-line" size={15} /><span>{t('Filter')}{activeMenuCount ? ` · ${activeMenuCount}` : ''}</span></Button>}>
            <div className="om-menu-caption">{t('Sort')}</div>
            <MenuRadioGroup value={sort} onValueChange={value => setSort(String(value))}>{sortOptions.map(([value, label]) => <MenuRadioItem key={value} value={value}>{t(label)}</MenuRadioItem>)}</MenuRadioGroup>
            {sections.map(section => <div key={section.title}><MenuSeparator /><div className="om-menu-caption">{t(section.title)}</div>{section.values.map(value => <MenuCheckboxItem key={value.id} checked={filters.includes(value.id)} closeOnClick={false} onCheckedChange={() => toggle(value.id)}>{t(value.label)}</MenuCheckboxItem>)}</div>)}
          </Menu>
          {hasNamedGroups && <>
            <span className="om-toolbar-divider" aria-hidden="true" />
            <Tooltip label={t('Group models')} wrap><IconButton variant="ghost" className="om-button om-icon-button" aria-label={t('Group models')} aria-pressed={grouped} onClick={() => setGrouped(value => !value)} icon={<RemixIcon name={grouped ? 'folder-open-line' : 'folder-line'} size={15} />} /></Tooltip>
            {showGroups && <Tooltip label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} wrap><IconButton variant="ghost" className="om-button om-icon-button" aria-label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} onClick={() => setCollapsed(allCollapsed ? [] : groupKeys)} icon={<RemixIcon name={allCollapsed ? 'arrow-right-s-line' : 'arrow-down-s-line'} size={16} />} /></Tooltip>}
          </>}
        </div>
      </div>
      {isFiltered && <div className="om-settings-tags om-model-active-filters">
        <span className="om-muted">{filtered.length} / {scopedModels.length}</span>
        {sort !== 'catalogue' && <Button variant="plain" className="om-badge" aria-label={t('Remove {filter} filter', { filter: t(sortLabel) })} onClick={() => setSort('catalogue')}>{t('Sort')}: {t(sortLabel)}<RemixIcon name="close-line" size={12} /></Button>}
        {filters.map(id => <Button variant="plain" key={id} className="om-badge" aria-label={t('Remove {filter} filter', { filter: t(sections.flatMap(section => section.values).find(value => value.id === id)?.label ?? id) })} onClick={() => toggle(id)}>{t(sections.flatMap(section => section.values).find(value => value.id === id)?.label ?? id)}<RemixIcon name="close-line" size={12} /></Button>)}
        <Button variant="ghost" className="om-button h-auto" onClick={() => { setFilters([]); setQuery(''); setSort('catalogue'); }}>{t('Clear filters')}</Button>
      </div>}
    </>}
    <div className="om-model-list">{[...groups].map(([group, values]) => <section key={group}>{showGroups && <Button variant="plain" className="om-nav-item om-model-group" aria-expanded={!collapsed.includes(group)} onClick={() => setCollapsed(current => current.includes(group) ? current.filter(value => value !== group) : [...current, group])}><RemixIcon name={collapsed.includes(group) ? 'arrow-right-s-line' : 'arrow-down-s-line'} size={14} /><span>{group === 'Ungrouped' ? t(group) : group}</span><small className="om-muted">{values.length}</small></Button>}{(!showGroups || !collapsed.includes(group)) && values.map(render)}</section>)}
      {!filtered.length && <div className="om-empty"><RemixIcon name="box-3-line" size={32} /><h3 className="om-subtitle">{t(models.length ? 'No matching models' : 'Choose your models')}</h3><p className="om-muted">{t(models.length ? 'Try another search or clear the filters.' : 'Sync the provider catalogue or add a model by its exact ID.')}</p></div>}
    </div>
  </>;
}
