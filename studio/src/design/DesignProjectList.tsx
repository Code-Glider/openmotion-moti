import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../packages/design-system/react/RemixIcons';
import {
  designRoutes, designScenarios, findDesignScenario,
  type DesignProject, type DesignScenarioId,
} from '../../../shared/design-project';
import { IconButton } from '../components/ui';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { designClient } from './designClient';
import './design.css';

function LazyPreviewFrame({ src, title }: { src: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="om-design-card-thumb">
      {visible && (
        <iframe
          title={title}
          src={src}
          loading="lazy"
          sandbox="allow-scripts"
          tabIndex={-1}
        />
      )}
    </div>
  );
}

export function DesignProjectList({
  scenario,
  compact = false,
  onOpen,
  onCreate,
}: {
  scenario?: DesignScenarioId;
  compact?: boolean;
  onOpen: (projectId: string) => void;
  onCreate?: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filterScenario, setFilterScenario] = useState<string>(scenario ?? 'all');
  const [trashed, setTrashed] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = toast.showToast;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await designClient.listProjects({ scenario, trashed });
      if (Array.isArray(res?.projects)) setProjects(res.projects);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('Could not load design projects'), 'error', 'feedback');
    } finally {
      setLoading(false);
    }
  }, [scenario, trashed, showToast, t]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (scen: DesignScenarioId) => {
    setNewMenuOpen(false);
    try {
      const { project } = await designClient.createProject({ scenario: scen });
      if (onCreate) onCreate(project.id); else onOpen(project.id);
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not create project'), 'error', 'feedback');
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const res = await designClient.importZipFile(file);
      toast.showToast(t('Imported {count} design project(s)', { count: res.projects.length }), 'info', 'feedback');
      await load();
      if (res.projects[0]) onOpen(res.projects[0].id);
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not import ZIP'), 'error', 'feedback');
    } finally {
      setImporting(false);
    }
  };

  const handleDuplicate = async (project: DesignProject) => {
    try {
      await designClient.duplicateProject(project.id);
      toast.showToast(t('Project duplicated'), 'info', 'feedback');
      await load();
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not duplicate project'), 'error', 'feedback');
    }
  };

  const handleTrash = async (project: DesignProject) => {
    try {
      await designClient.trashProject(project.id);
      toast.showToast(t('Moved to Trash'), 'info', 'feedback');
      await load();
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not trash project'), 'error', 'feedback');
    }
  };

  const handleRestore = async (project: DesignProject) => {
    try {
      await designClient.restoreProject(project.id);
      toast.showToast(t('Project restored'), 'info', 'feedback');
      await load();
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not restore project'), 'error', 'feedback');
    }
  };

  const handleDelete = async (project: DesignProject) => {
    try {
      await designClient.deleteProject(project.id);
      toast.showToast(t('Project permanently deleted'), 'info', 'feedback');
      await load();
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not delete project'), 'error', 'feedback');
    }
  };

  const handleExport = async (project: DesignProject, format: 'zip' | 'open-design') => {
    try {
      const filename = await designClient.downloadExport(project.id, { format });
      toast.showToast(t('Exported {filename}', { filename }), 'info', 'feedback');
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Export failed'), 'error', 'feedback');
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(p => {
      if (!scenario && filterScenario !== 'all' && p.scenario !== filterScenario) return false;
      if (q && !p.title.toLowerCase().includes(q) && !p.scenario.includes(q)) return false;
      return true;
    }).slice(0, compact ? 6 : 200);
  }, [projects, query, filterScenario, scenario, compact]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="search"
              className="om-design-input"
              placeholder={t('Search design projects…')}
              aria-label={t('Search design projects…')}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {!scenario && (
              <div className="om-design-segmented">
                <Button type="button" size="sm" variant={filterScenario === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilterScenario('all')}>{t('All')}</Button>
                {designScenarios.map(s => (
                  <Button key={s.id} type="button" size="sm" variant={filterScenario === s.id ? 'secondary' : 'ghost'} onClick={() => setFilterScenario(s.id)}>
                    {t(s.label)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button type="button" size="sm" variant={trashed ? 'secondary' : 'ghost'} icon={<RemixIcon name="delete-bin-line" size={14} />} onClick={() => setTrashed(v => !v)}>
              {trashed ? t('Viewing Trash') : t('Trash')}
            </Button>
            <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleImportFile} />
            <Button type="button" size="sm" variant="secondary" loading={importing} icon={<RemixIcon name="upload-2-line" size={14} />} onClick={() => fileInputRef.current?.click()}>
              {t('Import ZIP')}
            </Button>
            <Popover.Root modal={false} open={newMenuOpen} onOpenChange={setNewMenuOpen}>
              <Popover.Trigger render={
                <Button type="button" size="sm" variant="primary" icon={<RemixIcon name="add-line" size={14} />}>
                  {t('New project')}
                </Button>
              } />
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-150">
                  <Popover.Popup className="om-design-popover">
                    {designScenarios.map(s => (
                      <Button key={s.id} type="button" size="sm" variant="ghost" icon={<RemixIcon name={s.icon} size={14} />} onClick={() => void handleCreate(s.id)}>
                        {t(s.label)}
                      </Button>
                    ))}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
      )}

      {loading ? (
        <div className="om-design-muted">{t('Loading design projects…')}</div>
      ) : filtered.length === 0 ? (
        <div className="om-design-item-card" style={{ padding: 24, alignItems: 'center', textAlign: 'center' }}>
          <p className="om-design-muted" style={{ margin: 0 }}>
            {trashed ? t('Trash is empty.') : t('No design projects yet. Create one, import an Open Design ZIP, or send a brief to your MCP Agent.')}
          </p>
        </div>
      ) : (
        <div className="om-design-grid">
          {filtered.map(project => {
            const scen = findDesignScenario(project.scenario);
            return (
              <article key={project.id} className="om-design-card">
                <LazyPreviewFrame src={designRoutes.raw(project.id, project.entry)} title={project.title} />
                <div className="om-design-card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</strong>
                    <span className="om-design-badge">{scen ? t(scen.label) : project.scenario}</span>
                  </div>
                  <span className="om-design-muted">{project.versionLabel ?? 'v1'} · {new Date(project.updatedAt).toLocaleDateString()}</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 'auto' }}>
                    {trashed ? (
                      <>
                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleRestore(project)}>{t('Restore')}</Button>
                        <Button type="button" size="sm" variant="danger" onClick={() => void handleDelete(project)}>{t('Delete')}</Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" size="sm" variant="primary" onClick={() => onOpen(project.id)}>{t('Open')}</Button>
                        <Popover.Root modal={false}>
                          <Popover.Trigger render={<IconButton aria-label={t('Project actions')} icon={<RemixIcon name="more-line" size={16} />} />} />
                          <Popover.Portal>
                            <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-150">
                              <Popover.Popup className="om-design-popover" style={{ minWidth: 190 }}>
                                <Button type="button" size="sm" variant="ghost" onClick={() => void handleDuplicate(project)}>{t('Duplicate')}</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport(project, 'open-design')}>{t('Export for Open Design')}</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport(project, 'zip')}>{t('Export ZIP')}</Button>
                                <Button type="button" size="sm" variant="danger" onClick={() => void handleTrash(project)}>{t('Move to Trash')}</Button>
                              </Popover.Popup>
                            </Popover.Positioner>
                          </Popover.Portal>
                        </Popover.Root>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <StudioToastViewport {...toast} />
    </div>
  );
}
