import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { SearchField } from './components/ui/SearchField';
import { Button } from './components/ui/Button';
import { IconButton } from './components/ui/IconButton';
import { Tooltip } from './components/ui/Tooltip';
import { Toggle } from './components/ui/Toggle';
import { Checkbox } from './components/ui/Checkbox';
import { Select } from './components/ui/Select';
import { Tabs, TabsList, Tab, TabPanel } from './components/ui/Tabs';
import { SearchInput } from './components/ui/SearchInput';
import { Skeleton } from './components/ui/Skeleton';
import { PanelEmptyState } from './components/ui/PanelEmptyState';
import { GalleryFilterPopover, GallerySortMenu, type GalleryFilters } from './motion/GalleryFilters';
import { SettingsDialog } from './motion/settingsPrimitives';
import { StudioToastViewport } from './components/StudioToastViewport';
import { useToast } from './hooks/useToast';
import { RemixIcon } from './icons/RemixIcons';
import './styles/studio.css';
import '../../packages/design-system/studio.css';
import './componentLibrary.css';

const items = [
  { name: 'City silhouettes', kind: 'Video' },
  { name: 'Product poster', kind: 'Image' },
  { name: 'Ambient soundtrack', kind: 'Audio' },
  { name: 'City walk', kind: 'Video' },
];

function SearchDemo() {
  const [query, setQuery] = useState('');

  return <>
    <div className="demo-variants">
      <div><p className="demo-label">Application · 32 px</p><SearchField aria-label="Search demo assets" placeholder="Try “city”" value={query} onChange={setQuery} /></div>
      <div><p className="demo-label">Editor panel · compact</p><SearchInput aria-label="Search editor fields" placeholder="Search editor fields" /></div>
    </div>
    <p className="demo-result" role="status">{
      items.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase())).map(item => item.name).join(' · ') || 'No matching assets'
    }</p>
  </>;
}

function ChoiceDemo() {
  const [checked, setChecked] = useState(true);
  const [ack, setAck] = useState(false);
  const [value, setValue] = useState('personal');
  return <>
    <div className="demo-row">
      <Select label="Save scope" value={value} onCommit={setValue} className="spec-select"
        options={[{label:'Personal',value:'personal'}, {label:'Workspace',value:'workspace'}, {label:'Public · unavailable',value:'public',disabled:true}]} />
      <div className="demo-inline"><Toggle label="Auto-preview" checked={checked} onCommit={setChecked} /><span>Auto-preview</span></div>
      <div className="demo-inline"><Checkbox aria-label="Include cover" checked={ack} onCheckedChange={setAck} /><span>Include cover</span></div>
    </div>
    <Tabs defaultValue="list">
      <TabsList aria-label="Asset tabs"><Tab value="list">List</Tab><Tab value="detail">Details</Tab></TabsList>
      <TabPanel value="list"><p className="demo-result">Use the arrow keys to move between these tabs.</p></TabPanel>
      <TabPanel value="detail"><p className="demo-result">Save destination: {value === 'workspace' ? 'Workspace' : 'Personal'}.</p></TabPanel>
    </Tabs>
  </>;
}

function FilterDemo() {
  const [sort, setSort] = useState('original');
  const [active, setActive] = useState<GalleryFilters>({});
  const [draft, setDraft] = useState<GalleryFilters>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filter = (criteria: GalleryFilters) => items.filter(item => !criteria.kind?.length || criteria.kind.includes(item.kind));
  const rows = filter(active);
  if (sort === 'name') rows.sort((a,b) => a.name.localeCompare(b.name));
  return <>
    <div className="demo-row">
      <GallerySortMenu value={sort} options={[['original','Original order'],['name','Name']]} onChange={setSort} />
      <GalleryFilterPopover groups={[{key:'kind',label:'Media type',values:['Image','Video','Audio']}]} open={open} onOpenChange={next => {
        if (next) { setDraft(active); setQuery(''); }
        setOpen(next);
      }} draft={draft} onChange={setDraft} tab="kind" onTabChange={() => {}} query={query} onQueryChange={setQuery}
        active={Boolean(active.kind?.length)} countLabel={`${filter(draft).length} matches`} hasDraft={Boolean(draft.kind?.length)}
        onApply={() => { setActive(draft); setOpen(false); }} onClear={() => setDraft({})} />
    </div>
    {Boolean(active.kind?.length) && <div className="demo-row demo-divider">
      {active.kind?.map(kind => <button key={kind} type="button" className="om-button om-filter-pill" aria-label={`Remove filter ${kind}`}
        onClick={() => setActive({ kind: active.kind?.filter(value => value !== kind) })}>{kind} ×</button>)}
    </div>}
    <p className="demo-result" role="status">{rows.length} assets · {rows.map(item => item.name).join(' · ')}</p>
  </>;
}

function StateDemo({ notify }: { notify: () => void }) {
  const [state, setState] = useState<'loading'|'empty'|'error'>('loading');
  const task = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if(task.current) clearTimeout(task.current); }, []);
  function choose(next: typeof state) {
    if(task.current) clearTimeout(task.current);
    setState(next);
  }
  return <>
    <div className="demo-row" aria-label="Content state">
      <Button size="sm" aria-pressed={state==='loading'} onClick={() => choose('loading')}>Loading</Button>
      <Button size="sm" aria-pressed={state==='empty'} onClick={() => choose('empty')}>Empty</Button>
      <Button size="sm" aria-pressed={state==='error'} onClick={() => choose('error')}>Failure</Button>
      <Button size="sm" onClick={notify}>Trigger toast</Button>
    </div>
    <div className="demo-state">
      {state==='loading' && <div className="demo-skeleton" role="status" aria-label="Loading assets">
        <Skeleton style={{width:'55%',height:16}} /><Skeleton style={{width:'100%',height:18}} /><Skeleton style={{width:'75%',height:18}} />
      </div>}
      {state==='empty' && <PanelEmptyState icon="inbox-line" message="No assets yet" description="Assets appear here after upload." />}
      {state==='error' && <div className="demo-error" role="alert"><strong>Assets could not load</strong><p>Check your connection and try again.</p><Button size="sm" onClick={() => {
        choose('loading');
        task.current = setTimeout(() => setState('empty'), 550);
      }}>Retry</Button></div>}
    </div>
  </>;
}

function DialogDemo({ notify }: { notify: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={trigger} size="lg" onClick={() => setOpen(true)}>Open settings dialog</Button>
    {open && <SettingsDialog className="spec-dialog" title="Workspace settings" returnFocus={trigger.current} onClose={() => setOpen(false)}>
      <p>Press Escape to close and return focus to the trigger.</p>
      <div className="demo-row"><Button size="lg" onClick={() => setOpen(false)}>Cancel</Button>
      <Button size="lg" variant="primary" onClick={() => { notify(); setOpen(false); }}>Save settings</Button></div>
    </SettingsDialog>}
  </>;
}

function Mount({ name, children }: { name: string; children: ReactNode }) {
  const target = document.getElementById(name);
  return target ? createPortal(children, target) : null;
}

function App() {
  const toast = useToast();
  const notify = () => toast.showToast('Action completed', 'info', 'feedback');

  return <>
    <Mount name="preview-actions">
      <div className="demo-row">
        <Button size="lg" variant="primary" onClick={notify}>Apply changes</Button>
        <Button size="lg" onClick={notify}>Secondary</Button>
        <Button size="lg" variant="ghost" onClick={notify}>Learn more</Button>
        <Button size="lg" variant="danger" onClick={() => toast.showToast('Delete action previewed', 'info', 'feedback')}>Delete</Button>
        <Tooltip label="Preview options"><IconButton size="lg" aria-label="Preview options" icon={<RemixIcon name="more-line" size={16} />} onClick={notify} /></Tooltip>
      </div>
      <div className="demo-row demo-divider">
        <Button size="md" onClick={notify}>Existing default · 28 px</Button>
        <Button size="lg" data-preview-state="focus" onClick={notify}>Focus preview</Button>
        <Button size="lg" loading>Submitting</Button>
        <Button size="lg" disabled>Disabled</Button>
      </div>
    </Mount>
    <Mount name="preview-search"><SearchDemo /></Mount>
    <Mount name="preview-choice"><ChoiceDemo /></Mount>
    <Mount name="preview-filter"><FilterDemo /></Mount>
    <Mount name="preview-state"><StateDemo notify={notify} /></Mount>
    <Mount name="preview-dialog"><DialogDemo notify={notify} /></Mount>
    <StudioToastViewport {...toast} />
  </>;
}

createRoot(document.getElementById('preview-runtime')!).render(<App />);
