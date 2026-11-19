import type { TechniqueStudio } from '../../../shared/studio-catalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { studioSkillDefaults, localizedSkillPrompt, skillShotPrompt, aspectRatios, durations, motionSkills, skillCategories, skillShortcut, type MotionSkill, type SkillCategory, type SkillParameters } from './skillCatalog';
import type { AssetDraft } from './AssetComposer';
import { studioDestination, type StudioDestination } from './creativeStudios';
import { SkillMedia } from './SkillMedia';
import { GitHubMark } from '../../../packages/design-system/react/GitHubMark';
import { MotionIcon } from './icons';
import { motionApi } from './useWorkspace';
import { setupGuideUrl, type IntegrationInfo } from '../../../shared/integration';
import { AssetPicker } from './AssetBrowser';
import { Popover } from '../components/ui/Popover';
import * as tracking from './pageTracking';
import './skills.css';

/** The contribution guide section with the paste-ready Agent brief for a new library Skill. */
export const skillSubmissionUrl = 'https://github.com/nexu-io/openmotion/blob/main/CONTRIBUTING.md#submit-a-skill-with-your-agent';

/** Cards lead with the task, like the template library; the upstream project name stays verbatim as the source. */
const displayNameOf = (t: (text: string) => string) => (skill: MotionSkill) => t(skill.title);

/** Open-source motion techniques the user can hand to an Agent through OpenMotion MCP. */
export function SkillsPage({ skillId, onSkillChange, studio, onExplore, onCreate, briefs, hasProject = false }: { studio?: TechniqueStudio; briefs?: Map<string, SkillParameters>; onCreate?: (destination: StudioDestination, draft?: AssetDraft) => void; onExplore?: () => void; skillId: string | null; onSkillChange: (id: string | null) => void; hasProject?: boolean }) {
  const { t, locale } = useI18n(), toast = useToast(), displayName = displayNameOf(t);
  const [query, setQuery] = useState(''), [category, setCategory] = useState<SkillCategory | null>(null);
  const [picking, setPicking] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const studioDefaults = useMemo<SkillParameters>(() => studioSkillDefaults(studio?.id), [studio]);
  const [parameters, setParameters] = useState<SkillParameters>(studioDefaults), [manualCopy, setManualCopy] = useState<{ text: string; surface: 'instruction' | 'command' } | null>(null);
  // Same install guide as template instructions; the repository guide is the fallback until the service answers.
  const [installUrl, setInstallUrl] = useState(() => setupGuideUrl(null));
  useEffect(() => {
    let cancelled = false;
    motionApi<IntegrationInfo>('/integration').then(info => { if (!cancelled) setInstallUrl(setupGuideUrl(info)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const instruction = useRef<HTMLPreElement>(null), command = useRef<HTMLPreElement>(null), search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.current?.focus(); } };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, []);
  // Select the failed text in its own visible surface so one ⌘C copies the requested content.
  useEffect(() => {
    if (!manualCopy || (manualCopy.surface === 'command' && !commandOpen)) return;
    const element = manualCopy.surface === 'command' ? command.current : instruction.current;
    if (element?.isConnected) { element.focus(); window.getSelection()?.selectAllChildren(element); }
  }, [manualCopy, commandOpen]);
  const catalog = useMemo(() => studio ? studio.techniques.flatMap(id => motionSkills.filter(skill => skill.id === id)) : motionSkills, [studio]);
  const selected = catalog.find(skill => skill.id === skillId) ?? null;
  const matching = (group: SkillCategory | null, text: string) => {
    const needle = text.trim().toLocaleLowerCase();
    return catalog.filter(skill => (!group || skill.category === group)
      && (!needle || [skill.name, skill.title, displayName(skill), t(skill.useWhen), skill.tagline, t(skill.tagline), t(skill.output), skill.repository ?? 'OpenMotion'].some(value => value.toLocaleLowerCase().includes(needle))));
  };
  const visible = useMemo(() => matching(category, query), [query, category, t, catalog]);
  const featured = studio ? catalog[0] : undefined;
  const featureInHero = featured?.cover?.poster && !query.trim();
  const cards = featureInHero ? visible.filter(skill => skill.id !== featured.id) : visible;
  const recording = parameters.reference && parameters.reference.modality !== 'image';
  const canCreateShot = Boolean(studio && onCreate && !recording);
  const startShot = () => {
    if (!studio || !selected || !onCreate) return;
    const reference = parameters.reference;
    if (reference && reference.modality !== 'image') return;
    const destination = studioDestination(studio, reference ? 'image-to-video' : 'text-to-video');
    onCreate(destination, { modality: 'video', prompt: skillShotPrompt(selected, parameters, t), shotPreferences: { aspect: parameters.aspect, duration: parameters.duration },
      references: reference ? [{ reference: { assetId: reference.assetId, versionId: reference.versionId }, name: reference.label }] : [] });
  };
  const updateBrief = (next: SkillParameters) => {
    if (studio && selected) briefs?.set(selected.id, next);
    setParameters(next);
  };
  // One page view per visit; one detail view per opened Skill; one search result per settled query (500 ms after typing stops).
  useEffect(() => { tracking.reportSkillsPageView(hasProject); }, []);
  const detailView = useRef<string | undefined>(undefined), searchId = useRef<string | undefined>(undefined);
  useEffect(() => {
    detailView.current = selected ? tracking.newTrackingId() : undefined;
    if (selected && detailView.current) tracking.reportSkillDetailShown(selected, detailView.current);
  }, [selected?.id]);
  // Any change to the query, category or interface language (which changes what matches) ends the previous search; a card opened before the new one settles carries no search id.
  const resultCount = visible.length;
  useEffect(() => {
    searchId.current = undefined;
    if (!query.trim()) return;
    const timer = setTimeout(() => { searchId.current = tracking.newTrackingId(); tracking.reportSkillSearch(searchId.current, query, resultCount, category); }, 500);
    return () => clearTimeout(timer);
  }, [query, category, locale]);
  const pickCategory = (value: SkillCategory | null) => {
    setCategory(value);
    tracking.reportSkillCategory(value, matching(value, query).length);
  };
  // The instruction follows the interface language, including the example brief and borrowed technique.
  const prompt = selected ? localizedSkillPrompt(selected, parameters, locale, installUrl, t) : '';
  const shortcut = selected ? skillShortcut({ ...selected, title: displayName(selected), example: t(selected.example) }, parameters, locale, installUrl) : '';
  const latest = useRef({ instruction: prompt, command: shortcut }); latest.current = { instruction: prompt, command: shortcut };
  const open = (skill: MotionSkill, position: number) => { tracking.reportSkillCardOpened(skill, position, searchId.current); onSkillChange(skill.id); };
  // A failed copy keeps its exact text for manual copying only until the brief changes; then show the live text again.
  useEffect(() => { setManualCopy(null); }, [prompt, shortcut]);
  // The brief belongs to one skill; any route change (card, history, link) starts a fresh brief.
  useEffect(() => { setPicking(false); setParameters((skillId && briefs?.get(skillId)) || studioDefaults); setManualCopy(null); setCommandOpen(false); }, [skillId, studioDefaults, briefs]);
  async function copy(surface: 'instruction' | 'command' = 'instruction') {
    if (!selected) return;
    const text = surface === 'command' ? shortcut : prompt, attempt = tracking.newTrackingId(), brief = parameters, view = detailView.current;
    if (surface === 'command') tracking.reportSkillCommandCopyClicked(selected, view, attempt);
    else tracking.reportSkillDetailClick(selected, 'copy_instruction', view, attempt);
    try {
      await navigator.clipboard.writeText(text); setManualCopy(null); toast.showToast(t('Copied. Paste into your Agent.'), 'info');
      tracking.reportSkillCopyResult(selected, surface, 'clipboard_written', attempt, brief, view);
    }
    catch {
      // A late failure for a brief that has since changed must not restore stale text.
      if (latest.current[surface] !== text) return;
      tracking.reportSkillCopyResult(selected, surface, 'manual_fallback_shown', attempt, brief, view);
      setManualCopy({ text, surface }); toast.showToast(t(surface === 'command' ? 'Copy failed. Select and copy the command below.' : 'Copy failed. Select and copy the instruction below.'), 'error', 'feedback');
    }
  }
  return <div className="om-gallery-surface om-skills-page om-skills-library" data-detail={Boolean(selected)}>
    <StudioToastViewport {...toast} />
    <div className="om-skills-main">
      <div className="om-gallery-sticky-header">
        <div className="om-gallery-toolbar om-skills-toolbar">
          {studio ? <button className="om-nav-item" onClick={onExplore}><RemixIcon name="arrow-left-line" size={16} />{t('Back to Explore')}</button> : <div className="om-gallery-categories" role="group" aria-label={t('Skill category')}>
            <button aria-pressed={!category} onClick={() => pickCategory(null)}>{t('All')}</button>
            {skillCategories.map(value => <button key={value} aria-pressed={category === value} onClick={() => pickCategory(value)}>{t(value)}</button>)}
          </div>}
          <label className="om-field om-search-field"><MotionIcon name="search" size={18} /><input ref={search} type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search skills...')} aria-label={t('Search skills')} /><kbd aria-hidden="true">⌘ K</kbd></label>
        </div>
      </div>
      <main className="om-gallery-results">
        {studio ? <section className="om-specialty-intro">
          <div><h1 className="om-title">{studio.title}</h1><p className="om-muted">{t(studio.briefHint)}</p>
            {onCreate && <div className="om-specialty-actions">
              <button className="om-button" data-primary onClick={() => onCreate(studioDestination(studio))}><RemixIcon name="add-line" size={16} />{t(studio.createLabel)}</button>
              {studio.id === 'marketing' && <button className="om-button" onClick={() => onCreate(studioDestination(studio, 'text-to-video'))}>{t('Create an ad clip')}</button>}
            </div>}
          </div>{featured?.cover?.poster && <button className="om-specialty-feature" onClick={() => open(featured, 1)}>
            <img src={featured.cover.poster} alt="" /><span className="om-button">{t(featured.title)}<RemixIcon name="arrow-right-line" size={16} /></span>
          </button>}
        </section> : <section className="om-gallery-intro om-skills-intro"><span className="om-gallery-eyebrow">{t('Pick a skill. Let your Agent make it.')}</span><h1>{t('Teach your Agent new moves.')}</h1><p>{t('Pick a skill, fill in the brief and copy the instruction. Your Agent builds an editable project in OpenMotion.')}</p>
          <div className="om-gallery-intro-actions"><a className="om-gallery-submit" href={skillSubmissionUrl} target="_blank" rel="noopener noreferrer" onClick={() => tracking.reportSkillSubmitClicked()}>{t('Submit a skill')}<MotionIcon name="arrow-up-right" size={15} /></a></div>
        </section>}
        <div className="om-gallery-masonry om-skills-grid">
          {cards.map((skill, index) => <SkillCard key={skill.id} skill={skill} name={displayName(skill)} useWhen={t(skill.useWhen)} category={t(skill.category)} selected={skill.id === skillId} onSelect={() => open(skill, index + (featureInHero ? 2 : 1))} />)}
        </div>
        {!visible.length && <div className="om-empty"><MotionIcon name="search" size={28} /><p>{t('No matching skills.')}</p><button className="om-button" onClick={() => { setQuery(''); setCategory(null); tracking.reportSkillFiltersCleared(); }}>{t('Clear filters')}</button></div>}
      </main>
    </div>
    {selected && <aside className="om-skill-detail om-surface-divider" aria-label={displayName(selected)}>
      <header className="om-skill-detail-header"><h2 className="om-subtitle">{displayName(selected)}</h2><button className="motion-icon-button" aria-label={t('Close skill')} onClick={() => { tracking.reportSkillDetailClick(selected, 'close_detail', detailView.current); onSkillChange(null); }}><RemixIcon name="close-line" size={18} /></button></header>
      <SkillMedia key={selected.id} skill={selected} large />
      <p className="om-skill-output"><span>{t('When to use')}</span>{t(selected.useWhen)}</p>
      <p className="om-skill-output"><span>{t('You get')}</span>{t(selected.output)}</p>
      {selected.repository ? <a className="om-skill-source" href={selected.repository} target="_blank" rel="noopener noreferrer" onClick={() => tracking.reportSkillDetailClick(selected, 'view_source', detailView.current)}><GitHubMark width={14} height={14} /><span>{selected.repository.replace('https://', '')}</span><span className="om-badge">{selected.license}</span><RemixIcon name="external-link-line" size={14} /></a>
        : <p className="om-skill-source"><RemixIcon name="flashlight-line" size={16} /><span>{t('OpenMotion skill')}</span></p>}
      {selected.cover?.source && <p className="om-skill-credit"><span>{t('Cover source')}</span>{/^https?:\/\//.test(selected.cover.source)
        ? <a href={selected.cover.source} target="_blank" rel="noopener noreferrer">{selected.cover.source.replace(/^https?:\/\//, '')}</a>
        : selected.cover.source}</p>}
      <section className="om-skill-form" aria-label={t('Brief')}>
        <label><span>{t('What to make')}</span><span className="om-field"><textarea rows={2} maxLength={500} value={parameters.subject} placeholder={t(selected.example)} onChange={event => updateBrief({ ...parameters, subject: event.target.value })} /></span></label>
        {studio && <fieldset><legend>{t('Reference asset')}</legend><div className="om-skill-options">
          <button className="om-button" onClick={() => setPicking(true)}><RemixIcon name="folder-open-line" size={15} />{parameters.reference?.label ?? t('Choose an asset')}</button>
          {parameters.reference && <button className="om-nav-item" aria-label={t('Remove reference: {name}', { name: parameters.reference.label })} onClick={() => updateBrief({ ...parameters, reference: undefined })}><RemixIcon name="close-line" size={15} /></button>}
        </div></fieldset>}
        <fieldset><legend>{t('Duration')}</legend><div className="om-skill-options">{durations.map(value => <button key={value} className="om-nav-item" aria-pressed={parameters.duration === value} onClick={() => updateBrief({ ...parameters, duration: value })}>{t('{count}s', { count: value })}</button>)}</div></fieldset>
        <fieldset><legend>{t('Aspect ratio')}</legend><div className="om-skill-options">{aspectRatios.map(value => <button key={value} className="om-nav-item" aria-pressed={parameters.aspect === value} onClick={() => updateBrief({ ...parameters, aspect: value })}>{value}</button>)}</div></fieldset>
        <label><span>{t('Style (optional)')}</span><span className="om-field"><input maxLength={200} value={parameters.style} placeholder={t('e.g. dark background, neon green accents')} onChange={event => updateBrief({ ...parameters, style: event.target.value })} /></span></label>
      </section>
      <section className="om-skill-prompt" aria-label={t('Agent instruction')}>
        <span className="om-subtitle">{t('Agent instruction')}</span>
        <pre ref={instruction} data-manual={manualCopy?.surface === 'instruction'} tabIndex={0}>{manualCopy?.surface === 'instruction' ? manualCopy.text : prompt}</pre>
      </section>
      <footer className="om-skill-footer">
        {studio && onCreate && (recording
          ? <p className="om-muted">{t('Use the Agent brief to work with this recording. Clip generation accepts a still image as its first frame.')}</p>
          : <button className="om-button" data-primary onClick={startShot}><RemixIcon name="film-line" size={16} />{t('Create a shot from this brief')}</button>)}
        <div className="om-skill-actions">
          <button className="om-button" data-primary={!canCreateShot || undefined} onClick={() => void copy()}><RemixIcon name="file-copy-line" size={16} />{t('Copy for Agent')}</button>
          <Popover open={commandOpen} onOpenChange={open => { setCommandOpen(open); setManualCopy(null); if (open) tracking.reportSkillDetailClick(selected, 'open_command', detailView.current); }} side="top" align="end" aria-label={t('Use in another AI Agent')} className="om-skill-shortcut"
            trigger={<button className="om-button"><RemixIcon name="plug-line" size={16} />{t('Connect Agent')}</button>}>
            <strong>{t('Use in another AI Agent')}</strong>
            <p className="om-muted">{t('Copy this command into a chat with Codex, Claude or another AI Agent to run this skill.')}</p>
            <pre ref={command} data-manual={manualCopy?.surface === 'command'} tabIndex={0}>{manualCopy?.surface === 'command' ? manualCopy.text : shortcut}</pre>
            <button className="om-button" data-primary onClick={() => void copy('command')}><RemixIcon name="file-copy-line" size={16} />{t('Copy command')}</button>
          </Popover>
        </div>
      </footer>
    </aside>}
    {studio && selected && picking && <AssetPicker onClose={() => setPicking(false)} onPick={(reference, asset) => {
      const number = asset.versions.findIndex(version => version.id === reference.versionId) + 1;
      updateBrief({ ...parameters, reference: { ...reference, modality: asset.modality, label: `${asset.name} · V${number}` } });
      setPicking(false);
    }} />}
  </div>;
}

/** Gallery card shared with the template library: poster first, upstream demo video while hovered or focused. */
function SkillCard({ skill, name, useWhen, category, selected, onSelect }: { skill: MotionSkill; name: string; useWhen: string; category: string; selected: boolean; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false), [visible, setVisible] = useState(false), [near, setNear] = useState(false);
  const card = useRef<HTMLElement>(null);
  // Autoplay while at least half the card is on screen (paused off screen, so only the visible few load).
  // Reduced-motion users keep hover-to-play.
  useEffect(() => {
    const element = card.current;
    if (!element || typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.5 });
    // Start buffering a screen ahead so playback is smooth when the card arrives.
    const ahead = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); }, { rootMargin: '100% 0px' });
    observer.observe(element); ahead.observe(element);
    return () => { observer.disconnect(); ahead.disconnect(); };
  }, []);
  const active = hovered || visible;
  const setActive = setHovered;
  // Keep the cover clean; the task name and what it makes sit under it, so a glance says what the skill does.
  return <article ref={card} className="om-gallery-card om-skill-gallery-card" data-skill-id={skill.id} data-selected={selected}
    onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)}>
    <button className="motion-gallery-card-cover om-gallery-cover" style={{ aspectRatio: skill.cover?.aspect ?? coverAspect[skill.motif.length % coverAspect.length] }} onClick={onSelect} aria-pressed={selected} aria-label={name}
      onFocus={() => setActive(true)} onBlur={() => setActive(false)}>
      <SkillMedia skill={skill} playing={active} near={near || hovered} />
      <span className="om-gallery-card-top"><span>{category}</span></span>
    </button>
    <button className="om-skill-card-meta" onClick={onSelect} tabIndex={-1} aria-hidden="true"><strong>{name}</strong><span>{useWhen}</span></button>
  </article>;
}
const coverAspect = [1.78, 1.35, 1, 1.78];
