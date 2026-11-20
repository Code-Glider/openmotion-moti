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
  ['catalogue', 'Catalogue order'],
  ['name', 'Name'],
  ['context', 'Context window'],
] as const;

export function ModelCatalog({ models, render }: { models: DirectoryModel[]; render: (model: DirectoryModel) => ReactNode }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(''), [filters, setFilters] = useState<string[]>([]), [sort, setSort] = useState('catalogue'), [grouped, setGrouped] = useState(true), [collapsed, setCollapsed] = useState<string[]>([]);
  const sections = [
    { title: 'Model type', values: modelKinds.map(kind => ({ id: `kind:${kind}`, label: kindLabels[kind] })) },
    { title: 'Model capabilities', values: modelCapabilities.map(value => ({ id: `cap:${value}`, label: capabilityLabels[value] })) },
    { title: 'Input modalities', values: inputModalities.map(value => ({ id: `input:${value}`, label: capabilityLabels[value] })) },
    { title: 'Status', values: [{ id: 'status:enabled', label: 'Enabled' }, { id: 'status:disabled', label: 'Disabled' }] },
    { title: 'Source', values: [{ id: 'source:builtin', label: 'Built-in' }, { id: 'source:live', label: 'Synced' }, { id: 'source:custom', label: 'Custom' }] },
  ];
  const toggle = (id: string) => setFilters(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const filtered = models.filter(model => {
    if (!`${model.label} ${model.modelId} ${model.group ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    return sections.every(section => { const selected = section.values.filter(value => filters.includes(value.id)); return !selected.length || selected.some(({ id }) => { const [type, value] = id.split(':'); return type === 'kind' ? model.kind === value : type === 'cap' ? model.capabilities?.some(item => item === value) : type === 'input' ? model.inputs?.some(item => item === value) : type === 'source' ? model.source === value : model.enabled === (value === 'enabled'); }); });
  }).sort((a, b) => sort === 'name' ? a.label.localeCompare(b.label) : sort === 'context' ? (b.contextWindow ?? 0) - (a.contextWindow ?? 0) : 0);
  const hasNamedGroups = models.some(model => Boolean(model.group?.trim()));
  const showGroups = grouped && hasNamedGroups;
  const groups = Map.groupBy(filtered, model => showGroups ? model.group?.trim() || 'Ungrouped' : '');
  const groupKeys = [...groups.keys()];
  const allCollapsed = groupKeys.length > 0 && groupKeys.every(group => collapsed.includes(group));
  const isFiltered = filters.length > 0 || query.trim().length > 0;
  const sortLabel = sortOptions.find(([value]) => value === sort)?.[1] ?? 'Catalogue order';
  return <>
    {models.length > 0 && <>
      <div className="om-model-filters">
        <label className="om-field"><RemixIcon name="search-line" size={15} /><input type="search" aria-label={t('Search models')} placeholder={t('Search models…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="om-model-filter-controls">
          <Menu className="om-filter-menu" modal={false} aria-label={t('Filter models')} trigger={<Button variant="ghost" className="om-button h-auto" data-active={filters.length > 0 || undefined} aria-label={t('Filter models')}><RemixIcon name="filter-3-line" size={15} /><span>{t('Filter')}{filters.length ? ` · ${filters.length}` : ''}</span></Button>}>{sections.map((section, i) => <div key={section.title}>{i > 0 && <MenuSeparator />}<div className="om-menu-caption">{t(section.title)}</div>{section.values.map(value => <MenuCheckboxItem key={value.id} checked={filters.includes(value.id)} closeOnClick={false} onCheckedChange={() => toggle(value.id)}>{t(value.label)}</MenuCheckboxItem>)}</div>)}</Menu>
          <Menu tooltip={t('Sort models')} modal={false} aria-label={t('Sort models')} trigger={<Button variant="ghost" className="om-button h-auto om-catalog-sort" data-active={sort !== 'catalogue' || undefined} aria-label={t('Sort models')}><RemixIcon name="equalizer-line" size={15} /><span>{t(sortLabel)}</span><RemixIcon name="arrow-down-s-line" size={14} /></Button>}><MenuRadioGroup value={sort} onValueChange={value => setSort(String(value))}>{sortOptions.map(([value, label]) => <MenuRadioItem key={value} value={value}>{t(label)}</MenuRadioItem>)}</MenuRadioGroup></Menu>
          {hasNamedGroups && <>
            <span className="om-toolbar-divider" aria-hidden="true" />
            <Tooltip label={t('Group models')} wrap><IconButton variant="ghost" className="om-button om-icon-button" aria-label={t('Group models')} aria-pressed={grouped} onClick={() => setGrouped(value => !value)} icon={<RemixIcon name={grouped ? 'folder-open-line' : 'folder-line'} size={15} />} /></Tooltip>
            {showGroups && <Tooltip label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} wrap><IconButton variant="ghost" className="om-button om-icon-button" aria-label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} onClick={() => setCollapsed(allCollapsed ? [] : groupKeys)} icon={<RemixIcon name={allCollapsed ? 'arrow-right-s-line' : 'arrow-down-s-line'} size={16} />} /></Tooltip>}
          </>}
        </div>
      </div>
      {isFiltered && <div className="om-settings-tags om-model-active-filters"><span className="om-muted">{filtered.length} / {models.length}</span>{filters.map(id => <Button variant="plain" key={id} className="om-badge" aria-label={t('Remove {filter} filter', { filter: t(sections.flatMap(section => section.values).find(value => value.id === id)?.label ?? id) })} onClick={() => toggle(id)}>{t(sections.flatMap(section => section.values).find(value => value.id === id)?.label ?? id)}<RemixIcon name="close-line" size={12} /></Button>)}<Button variant="ghost" className="om-button h-auto" onClick={() => { setFilters([]); setQuery(''); }}>{t('Clear filters')}</Button></div>}
    </>}
    <div className="om-model-list">{[...groups].map(([group, values]) => <section key={group}>{showGroups && <Button variant="plain" className="om-nav-item om-model-group" aria-expanded={!collapsed.includes(group)} onClick={() => setCollapsed(current => current.includes(group) ? current.filter(value => value !== group) : [...current, group])}><RemixIcon name={collapsed.includes(group) ? 'arrow-right-s-line' : 'arrow-down-s-line'} size={14} /><span>{group === 'Ungrouped' ? t(group) : group}</span><small className="om-muted">{values.length}</small></Button>}{(!showGroups || !collapsed.includes(group)) && values.map(render)}</section>)}
      {!filtered.length && <div className="om-empty"><RemixIcon name="box-3-line" size={32} /><h3 className="om-subtitle">{t(models.length ? 'No matching models' : 'Choose your models')}</h3><p className="om-muted">{t(models.length ? 'Try another search or clear the filters.' : 'Sync the provider catalogue or add a model by its exact ID.')}</p></div>}
    </div>
  </>;
}
