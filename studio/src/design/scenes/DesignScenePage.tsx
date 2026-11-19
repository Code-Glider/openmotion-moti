import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../../packages/design-system/react/RemixIcons';
import {
  designBriefPrompt, findDesignScenario,
  type DesignSystemSummary, type DesignTemplateSummary,
} from '../../../../shared/design-project';
import { findMediaStudio, type CreativeStudio } from '../../../../shared/studio-catalog';
import { IconButton } from '../../components/ui';
import { StudioToastViewport } from '../../components/StudioToastViewport';
import { useToast } from '../../hooks/useToast';
import { useI18n } from '../../i18n/I18n';
import { scenesForStudio } from '../../motion/creativeStudios';
import { designClient } from '../designClient';
import { DesignProjectList } from '../DesignProjectList';
import { DesignSceneTabs, type DesignTabId } from './DesignSceneTabs';
import '../design.css';

function TemplateCardThumb({ url, title }: { url: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="om-design-card-thumb">
      {visible && <iframe title={title} src={url} loading="lazy" sandbox="allow-scripts" tabIndex={-1} />}
    </div>
  );
}

export function DesignScenePage({
  scene,
  onSelectDesignScene,
  onSelectImageScene,
  onChooseStudio,
  onOpenProject,
  onExplore,
  onOpenMcp,
}: {
  scene: DesignTabId;
  onSelectDesignScene: (scene: DesignTabId) => void;
  onSelectImageScene: (sceneId: 'text-to-image' | 'image-edit') => void;
  onChooseStudio: (studio: CreativeStudio) => void;
  onOpenProject: (projectId: string) => void;
  onExplore: () => void;
  onOpenMcp: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const designMediaStudio = findMediaStudio('design')!;
  const imageScenes = scenesForStudio(designMediaStudio);
  const scenario = scene === 'projects' ? null : findDesignScenario(scene) ?? null;

  const [brief, setBrief] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [systems, setSystems] = useState<DesignSystemSummary[]>([]);
  const [systemQuery, setSystemQuery] = useState('');
  const [selectedSystem, setSelectedSystem] = useState<DesignSystemSummary | null>(null);
  const [systemOpen, setSystemOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<DesignTemplateSummary | null>(null);
  const [templates, setTemplates] = useState<DesignTemplateSummary[]>([]);
  const [templateQuery, setTemplateQuery] = useState('');
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [remixingId, setRemixingId] = useState<string | null>(null);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<DesignTemplateSummary | null>(null);

  // Rotate example placeholder hints gently when scenario changes
  useEffect(() => {
    setPlaceholderIndex(0);
    setSelectedTemplate(null);
    setManualPrompt(null);
    if (!scenario || scenario.examples.length <= 1) return;
    const id = window.setInterval(() => setPlaceholderIndex(i => (i + 1) % scenario.examples.length), 6000);
    return () => window.clearInterval(id);
  }, [scenario?.id]);

  // Load design systems once
  useEffect(() => {
    designClient.listSystems().then(res => setSystems(res.systems)).catch(() => setSystems([]));
  }, []);

  // Load templates for active HTML scenario
  useEffect(() => {
    if (!scenario) return;
    let cancelled = false;
    setTemplatesLoading(true);
    designClient.listTemplates({ scenario: scenario.id, q: templateQuery.trim() || undefined, limit: 24 })
      .then(res => { if (!cancelled) setTemplates(res.items); })
      .catch(() => { if (!cancelled) setTemplates([]); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [scenario?.id, templateQuery]);

  const filteredSystems = useMemo(() => {
    const q = systemQuery.trim().toLowerCase();
    return systems.filter(s => !q || s.title.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)).slice(0, 40);
  }, [systems, systemQuery]);

  const showToast = toast.showToast;
  const copyInstruction = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManualPrompt(null);
      showToast(t('Copied. Paste into your Agent.'), 'info', 'feedback');
    } catch {
      setManualPrompt(text);
      showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback');
    }
  }, [showToast, t]);

  const handleCopyBrief = () => {
    if (!scenario) return;
    const text = brief.trim() || scenario.examples[placeholderIndex] || scenario.hint;
    const prompt = designBriefPrompt({
      scenario: scenario.id,
      brief: text,
      designSystemId: selectedSystem?.id ?? null,
      templateId: selectedTemplate?.id ?? null,
      language: locale !== 'en' ? locale : null,
    });
    void copyInstruction(prompt);
  };

  const handleCreateBlank = async () => {
    if (!scenario) return;
    setCreating(true);
    try {
      const { project } = await designClient.createProject({
        scenario: scenario.id,
        templateId: selectedTemplate?.id ?? null,
        designSystemId: selectedSystem?.id ?? null,
      });
      onOpenProject(project.id);
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not create project'), 'error', 'feedback');
    } finally {
      setCreating(false);
    }
  };

  const handleRemixTemplate = async (template: DesignTemplateSummary) => {
    setRemixingId(template.id);
    try {
      const { project } = await designClient.createProject({
        scenario: template.scenario,
        templateId: template.id,
        designSystemId: selectedSystem?.id ?? null,
      });
      onOpenProject(project.id);
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not remix template'), 'error', 'feedback');
    } finally {
      setRemixingId(null);
    }
  };

  const handleUseTemplateWithAgent = (template: DesignTemplateSummary) => {
    setSelectedTemplate(template);
    const seed = template.examplePrompt || `Adapt the "${template.title}" template for my project.`;
    if (!brief.trim()) setBrief(seed);
    const prompt = designBriefPrompt({
      scenario: template.scenario,
      brief: brief.trim() || seed,
      designSystemId: selectedSystem?.id ?? null,
      templateId: template.id,
      language: locale !== 'en' ? locale : null,
    });
    void copyInstruction(prompt);
  };

  return (
    <div className="om-assets-host om-creative-workspace" style={{ overflowY: 'auto' }}>
      <header className="om-studio-bar">
        <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="arrow-left-line" size={16} />} onClick={onExplore}>
          {t('Explore')}
        </Button>
        <h1 className="om-subtitle">
          <span className="om-creation-icon" data-tone="image"><RemixIcon name="palette-line" size={18} /></span>
          {t('Design Studio')}
        </h1>
        <nav className="om-asset-tabs" aria-label={t('Scenes')}>
          {imageScenes.map(item => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onSelectImageScene(item.id as 'text-to-image' | 'image-edit')}
            >
              {t(item.label)}
            </Button>
          ))}
          <DesignSceneTabs
            activeTab={scene}
            onSelectDesignScene={onSelectDesignScene}
            onChooseStudio={onChooseStudio}
            onSelectImageScene={onSelectImageScene}
          />
        </nav>
      </header>

      <div className="om-design-page">
        {scene === 'projects' || !scenario ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>{t('Design projects')}</h2>
                <p className="om-design-muted" style={{ margin: '4px 0 0' }}>{t('Preview responsive HTML designs, annotate elements, inspect versions and hand off edits to your MCP Agent.')}</p>
              </div>
              <Button type="button" size="sm" variant="secondary" icon={<RemixIcon name="plug-line" size={14} />} onClick={onOpenMcp}>
                {t('Connect an Agent')}
              </Button>
            </div>
            <DesignProjectList onOpen={onOpenProject} />
          </>
        ) : (
          <>
            {/* Brief Composer Hero */}
            <section className="om-design-hero">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <RemixIcon name={scenario.icon} size={22} />
                  <div>
                    <h2 style={{ margin: 0 }}>{t(scenario.label)}</h2>
                    <p className="om-design-muted" style={{ margin: '2px 0 0' }}>{t(scenario.hint)}</p>
                  </div>
                </div>
                <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="plug-line" size={14} />} onClick={onOpenMcp}>
                  {t('Connect an Agent')}
                </Button>
              </div>

              <textarea
                className="om-design-textarea"
                style={{ minHeight: 96 }}
                aria-label={t('Design brief')}
                placeholder={scenario.examples[placeholderIndex] ?? t(scenario.hint)}
                value={brief}
                onChange={e => setBrief(e.target.value)}
              />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* Design System picker */}
                  <Popover.Root modal={false} open={systemOpen} onOpenChange={setSystemOpen}>
                    <Popover.Trigger render={
                      <Button type="button" size="sm" variant="secondary" icon={<RemixIcon name="palette-line" size={14} />}>
                        {selectedSystem ? selectedSystem.title : t('Design system')}
                      </Button>
                    } />
                    <Popover.Portal>
                      <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-150">
                        <Popover.Popup className="om-design-popover" style={{ width: 320, maxHeight: 360 }}>
                          <input
                            type="search"
                            className="om-design-input"
                            placeholder={t('Search design systems…')}
                            value={systemQuery}
                            onChange={e => setSystemQuery(e.target.value)}
                          />
                          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {selectedSystem && (
                              <Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedSystem(null); setSystemOpen(false); }}>
                                {t('Clear design system')}
                              </Button>
                            )}
                            {filteredSystems.map(sys => (
                              <Button
                                key={sys.id}
                                type="button"
                                size="sm"
                                variant={selectedSystem?.id === sys.id ? 'secondary' : 'ghost'}
                                style={{ justifyContent: 'space-between' }}
                                onClick={() => { setSelectedSystem(sys); setSystemOpen(false); }}
                              >
                                <span>{sys.title}</span>
                                <span className="om-design-swatches">
                                  {sys.swatches.slice(0, 4).map(hex => (
                                    <span key={hex} className="om-design-swatch" style={{ backgroundColor: hex }} />
                                  ))}
                                </span>
                              </Button>
                            ))}
                          </div>
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>

                  {selectedTemplate && (
                    <span className="om-design-badge">
                      {t('Template')}: {selectedTemplate.title}
                      <IconButton aria-label={t('Clear template')} icon={<RemixIcon name="close-line" size={12} />} onClick={() => setSelectedTemplate(null)} />
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Button type="button" size="md" variant="secondary" loading={creating} icon={<RemixIcon name="add-line" size={15} />} onClick={() => void handleCreateBlank()}>
                    {t('Create blank project')}
                  </Button>
                  <Button type="button" size="md" variant="primary" icon={<RemixIcon name="plug-line" size={15} />} onClick={handleCopyBrief}>
                    {t('Copy to Agent')}
                  </Button>
                </div>
              </div>

              {manualPrompt && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="om-design-muted">{t('Copy this MCP instruction manually')}</span>
                  <textarea className="om-design-textarea" readOnly value={manualPrompt} onFocus={e => e.currentTarget.select()} />
                </div>
              )}
            </section>

            {/* Template gallery */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <h3 style={{ margin: 0 }}>{t('{scenario} templates', { scenario: t(scenario.label) })}</h3>
                <input
                  type="search"
                  className="om-design-input"
                  placeholder={t('Filter templates…')}
                  aria-label={t('Filter templates…')}
                  value={templateQuery}
                  onChange={e => setTemplateQuery(e.target.value)}
                />
              </div>

              {templatesLoading ? (
                <div className="om-design-muted">{t('Loading templates…')}</div>
              ) : templates.length === 0 ? (
                <div className="om-design-muted">{t('No matching templates.')}</div>
              ) : (
                <div className="om-design-grid">
                  {templates.map(tpl => (
                    <article key={tpl.id} className="om-design-card">
                      <TemplateCardThumb url={tpl.previewUrl} title={tpl.title} />
                      <div className="om-design-card-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.title}</strong>
                          <IconButton aria-label={t('Enlarge preview')} icon={<RemixIcon name="fullscreen-line" size={14} />} onClick={() => setPreviewTemplate(tpl)} />
                        </div>
                        <p className="om-design-muted" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {tpl.description}
                        </p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
                          <Button type="button" size="sm" variant="primary" onClick={() => handleUseTemplateWithAgent(tpl)}>
                            {t('Use with Agent')}
                          </Button>
                          <Button type="button" size="sm" variant="secondary" loading={remixingId === tpl.id} onClick={() => void handleRemixTemplate(tpl)}>
                            {t('Remix into project')}
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Recent projects for this scenario */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{t('Recent projects')}</h3>
                <Button type="button" size="sm" variant="ghost" onClick={() => onSelectDesignScene('projects')}>{t('View all')}</Button>
              </div>
              <DesignProjectList scenario={scenario.id} compact onOpen={onOpenProject} />
            </section>
          </>
        )}
      </div>

      {/* Template enlarge preview overlay */}
      {previewTemplate && (
        <div role="dialog" aria-label={previewTemplate.title} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--motion-scrim)', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div style={{ width: 'min(1120px, 94vw)', height: 'min(760px, 88vh)', background: 'var(--motion-panel)', border: '1px solid var(--motion-border)', borderRadius: 'var(--motion-radius-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="om-design-header">
              <strong>{previewTemplate.title}</strong>
              <div className="om-design-header-group">
                <Button type="button" size="sm" variant="primary" onClick={() => { handleUseTemplateWithAgent(previewTemplate); setPreviewTemplate(null); }}>{t('Use with Agent')}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => { void handleRemixTemplate(previewTemplate); setPreviewTemplate(null); }}>{t('Remix into project')}</Button>
                <IconButton aria-label={t('Close')} icon={<RemixIcon name="close-line" size={16} />} onClick={() => setPreviewTemplate(null)} />
              </div>
            </div>
            <iframe title={previewTemplate.title} src={previewTemplate.previewUrl} sandbox="allow-scripts" className="om-design-iframe" style={{ flex: 1 }} />
          </div>
        </div>
      )}

      <StudioToastViewport {...toast} />
    </div>
  );
}
