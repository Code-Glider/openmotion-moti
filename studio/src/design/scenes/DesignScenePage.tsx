import { useCallback, useEffect, useMemo, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../../packages/design-system/react/RemixIcons';
import {
  designBriefPrompt, findDesignScenario,
  type DesignSkillSummary, type DesignSystemSummary, type DesignTemplateSummary,
} from '../../../../shared/design-project';
import { findMediaStudio, type CreativeStudio } from '../../../../shared/studio-catalog';
import { IconButton } from '../../components/ui';
import { StudioToastViewport } from '../../components/StudioToastViewport';
import { useToast } from '../../hooks/useToast';
import { useI18n } from '../../i18n/I18n';
import { scenesForStudio } from '../../motion/creativeStudios';
import { designClient } from '../designClient';
import { DesignProjectList } from '../DesignProjectList';
import { ScaledPreviewThumb } from '../ScaledPreviewThumb';
import { DesignSceneTabs, type DesignTabId } from './DesignSceneTabs';
import '../design.css';

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
  const showToast = toast.showToast;
  const designMediaStudio = findMediaStudio('design')!;
  const imageScenes = scenesForStudio(designMediaStudio);
  const scenario = scene === 'projects' ? null : findDesignScenario(scene) ?? null;

  const [brief, setBrief] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [systems, setSystems] = useState<DesignSystemSummary[]>([]);
  const [systemQuery, setSystemQuery] = useState('');
  const [selectedSystem, setSelectedSystem] = useState<DesignSystemSummary | null>(null);
  const [systemOpen, setSystemOpen] = useState(false);

  const [skills, setSkills] = useState<DesignSkillSummary[]>([]);
  const [skillQuery, setSkillQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<DesignSkillSummary | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);

  const [selectedTemplate, setSelectedTemplate] = useState<DesignTemplateSummary | null>(null);
  const [templates, setTemplates] = useState<DesignTemplateSummary[]>([]);
  const [templateQuery, setTemplateQuery] = useState('');
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [remixingId, setRemixingId] = useState<string | null>(null);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<DesignTemplateSummary | null>(null);

  useEffect(() => {
    setPlaceholderIndex(0);
    setSelectedTemplate(null);
    setSelectedSkill(null);
    setManualPrompt(null);
    if (!scenario || scenario.examples.length <= 1) return;
    const id = window.setInterval(() => setPlaceholderIndex(i => (i + 1) % scenario.examples.length), 6000);
    return () => window.clearInterval(id);
  }, [scenario?.id]);

  useEffect(() => {
    designClient.listSystems().then(res => { if (Array.isArray(res?.systems)) setSystems(res.systems); }).catch(() => setSystems([]));
    designClient.listSkills().then(res => { if (Array.isArray(res?.skills)) setSkills(res.skills); }).catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    if (!scenario) return;
    let cancelled = false;
    setTemplatesLoading(true);
    designClient.listTemplates({ scenario: scenario.id, q: templateQuery.trim() || undefined, limit: 24 })
      .then(res => { if (!cancelled && Array.isArray(res?.items)) setTemplates(res.items); })
      .catch(() => { if (!cancelled) setTemplates([]); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [scenario?.id, templateQuery]);

  const filteredSystems = useMemo(() => {
    const q = systemQuery.trim().toLowerCase();
    return systems.filter(s => !q || s.title.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)).slice(0, 48);
  }, [systems, systemQuery]);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    const list = skills.filter(s => !q || s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.includes(q));
    return [...list].sort((a, b) => Number(b.scenario === scenario?.id) - Number(a.scenario === scenario?.id)).slice(0, 48);
  }, [skills, skillQuery, scenario?.id]);

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
      skillId: selectedSkill?.id ?? null,
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
      showToast(err instanceof Error ? err.message : t('Could not create project'), 'error', 'feedback');
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
      showToast(err instanceof Error ? err.message : t('Could not remix template'), 'error', 'feedback');
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
      skillId: selectedSkill?.id ?? null,
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
          <span className="om-design-divider" aria-hidden="true" />
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
            <div className="om-design-section-head">
              <div>
                <h2 className="om-design-hero-title" style={{ fontSize: 28 }}>{t('Design projects')}</h2>
                <p className="om-design-hero-sub" style={{ marginTop: 4 }}>{t('Preview responsive HTML designs, annotate elements, inspect versions and hand off edits to your MCP Agent.')}</p>
              </div>
              <Button type="button" size="sm" variant="secondary" icon={<RemixIcon name="plug-line" size={14} />} onClick={onOpenMcp}>
                {t('Connect an Agent')}
              </Button>
            </div>
            <DesignProjectList onOpen={onOpenProject} />
          </>
        ) : (
          <>
            {/* Editorial centered Hero + Composer */}
            <section className="om-design-hero-wrap">
              <div className="om-design-hero-head">
                <span className="om-design-badge">
                  <RemixIcon name={scenario.icon} size={13} />
                  {t(scenario.label)}
                </span>
                <h2 className="om-design-hero-title">{t('What would you like to design?')}</h2>
                <p className="om-design-hero-sub">{t(scenario.hint)}</p>
              </div>

              <div className="om-design-composer">
                <textarea
                  className="om-design-composer-input"
                  aria-label={t('Design brief')}
                  placeholder={scenario.examples[placeholderIndex] ?? t(scenario.hint)}
                  value={brief}
                  onChange={e => setBrief(e.target.value)}
                />
                <div className="om-design-composer-dock">
                  <div className="om-design-header-group">
                    {/* Design System picker */}
                    <Popover.Root modal={false} open={systemOpen} onOpenChange={setSystemOpen}>
                      <Popover.Trigger render={
                        <Button type="button" size="sm" variant={selectedSystem ? 'secondary' : 'ghost'} icon={<RemixIcon name="palette-line" size={14} />}>
                          {selectedSystem ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span>{selectedSystem.title}</span>
                              <span className="om-design-swatches">
                                {selectedSystem.swatches.slice(0, 3).map(hex => <span key={hex} className="om-design-swatch" style={{ backgroundColor: hex }} />)}
                              </span>
                            </span>
                          ) : t('Design system')}
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

                    {/* Design Skill picker */}
                    <Popover.Root modal={false} open={skillOpen} onOpenChange={setSkillOpen}>
                      <Popover.Trigger render={
                        <Button type="button" size="sm" variant={selectedSkill ? 'secondary' : 'ghost'} icon={<RemixIcon name="book-open-line" size={14} />}>
                          {selectedSkill ? selectedSkill.title : t('Design skill')}
                        </Button>
                      } />
                      <Popover.Portal>
                        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-150">
                          <Popover.Popup className="om-design-popover" style={{ width: 340, maxHeight: 360 }}>
                            <input
                              type="search"
                              className="om-design-input"
                              placeholder={t('Search design skills…')}
                              value={skillQuery}
                              onChange={e => setSkillQuery(e.target.value)}
                            />
                            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {selectedSkill && (
                                <Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedSkill(null); setSkillOpen(false); }}>
                                  {t('Clear design skill')}
                                </Button>
                              )}
                              {filteredSkills.map(sk => (
                                <Button
                                  key={sk.id}
                                  type="button"
                                  size="sm"
                                  variant={selectedSkill?.id === sk.id ? 'secondary' : 'ghost'}
                                  style={{ justifyContent: 'space-between' }}
                                  onClick={() => { setSelectedSkill(sk); setSkillOpen(false); }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sk.title}</span>
                                  {sk.scenario && <span className="om-design-badge">{sk.scenario}</span>}
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

                  <div className="om-design-header-group">
                    <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="plug-line" size={14} />} onClick={onOpenMcp}>
                      {t('Connect an Agent')}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" loading={creating} icon={<RemixIcon name="add-line" size={14} />} onClick={() => void handleCreateBlank()}>
                      {t('Create blank project')}
                    </Button>
                    <Button type="button" size="sm" variant="primary" icon={<RemixIcon name="file-copy-line" size={14} />} onClick={handleCopyBrief}>
                      {t('Copy to Agent')}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Quick example prompt chips */}
              {scenario.examples.length > 0 && (
                <div className="om-design-example-chips">
                  {scenario.examples.map(example => (
                    <Button
                      key={example}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="om-design-example-chip"
                      title={example}
                      icon={<RemixIcon name="sparkling-line" size={13} />}
                      onClick={() => setBrief(example)}
                    >
                      <span className="om-design-example-chip-label">{example}</span>
                    </Button>
                  ))}
                </div>
              )}

              {manualPrompt && (
                <div style={{ width: '100%', maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="om-design-muted">{t('Copy this MCP instruction manually')}</span>
                  <textarea className="om-design-textarea" readOnly value={manualPrompt} onFocus={e => e.currentTarget.select()} />
                </div>
              )}
            </section>

            {/* Template gallery */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="om-design-section-head">
                <h3 className="om-design-section-title">{t('{scenario} templates', { scenario: t(scenario.label) })}</h3>
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
                      <ScaledPreviewThumb
                        src={tpl.previewUrl}
                        title={tpl.title}
                        badge={tpl.category !== tpl.scenario ? tpl.category : undefined}
                        topRight={
                          <IconButton
                            aria-label={t('Enlarge preview')}
                            icon={<RemixIcon name="fullscreen-line" size={14} />}
                            onClick={() => setPreviewTemplate(tpl)}
                          />
                        }
                      />
                      <div className="om-design-card-body">
                        <strong className="om-design-card-title">{tpl.title}</strong>
                        <p className="om-design-card-desc">{tpl.description}</p>
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
            <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="om-design-section-head">
                <h3 className="om-design-section-title">{t('Recent projects')}</h3>
                <Button type="button" size="sm" variant="ghost" onClick={() => onSelectDesignScene('projects')}>{t('View all')}</Button>
              </div>
              <DesignProjectList scenario={scenario.id} compact onOpen={onOpenProject} />
            </section>
          </>
        )}
      </div>

      {/* Template enlarge preview dialog */}
      {previewTemplate && (
        <div role="dialog" aria-label={previewTemplate.title} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--motion-scrim)', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div style={{ width: 'min(1140px, 94vw)', height: 'min(780px, 88vh)', background: 'var(--motion-panel)', border: '1px solid var(--motion-border)', borderRadius: 'var(--motion-radius-xl)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--motion-shadow-lg)' }}>
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
