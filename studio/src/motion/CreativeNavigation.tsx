import type { CreativeStudio, TechniqueStudio } from '../../../shared/studio-catalog';
import { useEffect, useRef, useState } from 'react';
import { modalities, type Modality } from '../../../shared/gateway';
import { Popover } from '../components/ui/Popover';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { workspacePageHref } from './workspacePageRouting';
import { creativeStudios, mediaLabels, motionStudio, sceneDestination, studioScenes, supportsScene, type StudioDestination } from './creativeStudios';
import { mcpClients, type McpClient } from './mcpClients';
import { useMediaCatalog } from './useMediaCatalog';
import { editingPresets } from './skillCatalog';
import { MediaModelChoices } from './MediaModelChoices';

export type CreativeNavigationProps = {
  onModel: (id: string) => void;
  onChooseStudio: (studio: CreativeStudio) => void;
  specialty: TechniqueStudio | null;
  destination: StudioDestination | null;
  motionActive: boolean;
  onNavigate: (destination: StudioDestination | null) => void;
  openProviders: () => void;
  onSkill: (id: string) => void;
  currentPage: 'explore' | 'api' | 'mcp' | null;
  onOpenPage: (page: 'explore' | 'api' | 'mcp', client?: McpClient) => void;
};

function MediaChoices({ kind, onModel, destination, onNavigate, onSkill, openProviders, catalog, failed, retry }: Pick<CreativeNavigationProps, 'destination' | 'onModel' | 'onNavigate' | 'openProviders' | 'onSkill'> & ReturnType<typeof useMediaCatalog> & { kind: Modality }) {
  const { t } = useI18n();
  const [modelScene, setModelScene] = useState(destination?.scene.modality === kind ? destination.scene : null);
  const modelsHeading = useRef<HTMLHeadingElement>(null);
  const matchingScenes = studioScenes.filter(scene => scene.modality === kind);
  const pinned = catalog?.models.find(model => model.id === destination?.model);
  return <div className="om-creative-menu-columns">
    <section><h2 className="om-eyebrow">{t('Scenes')}</h2>
      {matchingScenes.map(scene => {
        const current = destination?.scene.id === scene.id;
        const filtering = modelScene?.id === scene.id;
        const filterLabel = t('Models for {scene}', { scene: t(scene.label) });
        return <div className="om-nav-row om-creative-scene-row" data-active={current} key={scene.id}>
          <button className="om-nav-item om-nav-row-link om-creative-option" aria-current={current ? 'page' : undefined}
            onClick={() => onNavigate(sceneDestination(scene, destination, pinned && supportsScene(pinned, scene) ? pinned.id : null))}>
            <span className="om-creation-icon" data-tone={kind}><RemixIcon name={scene.icon} size={18} /></span>
            <span><strong>{t(scene.label)}</strong><small className="om-muted">{t(scene.hint)}</small></span>
          </button>
          <button className="om-nav-item om-nav-row-action" title={filterLabel} aria-label={filterLabel} aria-pressed={filtering}
            onClick={() => {
              setModelScene(filtering ? null : scene);
              if (window.matchMedia('(max-width: 560px)').matches) modelsHeading.current?.scrollIntoView({ block: 'nearest' });
            }}><RemixIcon name={filtering ? 'equalizer-fill' : 'equalizer-line'} size={16} /></button>
        </div>;
      })}
    </section>
    <section><h2 className="om-eyebrow" ref={modelsHeading}>{t('Models')}</h2>
      {modelScene && <button className="om-nav-item om-model-scene-chip" aria-label={t('Clear filters')} onClick={() => setModelScene(null)}>{t(modelScene.label)}<RemixIcon name="close-line" size={14} /></button>}
      <MediaModelChoices scene={modelScene} {...{ kind, onModel, destination, onNavigate, openProviders, catalog, failed, retry }} />
    </section>
    {kind === 'video' && <section className="om-creative-related-skills"><h2 className="om-eyebrow">{t('Skills')}</h2><div>
      {editingPresets.map(skill => <button className="om-nav-item" key={skill.id} onClick={() => onSkill(skill.id)}><RemixIcon name="movie-line" size={15} /><span>{t(skill.title)}</span></button>)}
    </div></section>}
  </div>;
}

export function CreativeNavigation({ specialty, onModel, onChooseStudio, destination, motionActive, onNavigate, openProviders, onSkill, currentPage, onOpenPage }: CreativeNavigationProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Modality | 'mcp' | null>(null);
  const [popupHost, setPopupHost] = useState<HTMLElement>();
  const rail = useRef<HTMLElement>(null);
  const catalog = useMediaCatalog(open !== null && open !== 'mcp');

  useEffect(() => {
    const viewport = rail.current!;
    // Native dialogs own their top layer. Anchor menus inside the dialog, outside the scrolling strip.
    setPopupHost(viewport.closest<HTMLElement>('dialog, [data-feedback-modal]') ?? undefined);
    const update = () => {
      viewport.toggleAttribute('data-scroll-start', viewport.scrollLeft > 1);
      viewport.toggleAttribute('data-scroll-end', viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft > 1);
      const trigger = viewport.querySelector('button[aria-expanded="true"]');
      if (trigger) {
        const anchor = trigger.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
        if (anchor.right < bounds.left || anchor.left > bounds.right) setOpen(null);
      }
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaX || !event.deltaY || !event.cancelable) return;
      const previous = viewport.scrollLeft;
      const unit = event.deltaMode === 1 ? viewport.clientHeight : event.deltaMode === 2 ? viewport.clientWidth : 1;
      viewport.scrollLeft += event.deltaY * unit;
      if (viewport.scrollLeft !== previous) event.preventDefault();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(viewport.firstElementChild!);
    viewport.addEventListener('scroll', update);
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', update);
      viewport.removeEventListener('wheel', wheel);
    };
  }, []);

  const choose = (action: () => void) => {
    const navigation = rail.current;
    if (open && navigation && !navigation.contains(document.activeElement)) {
      // A disappearing menu item must not reclaim focus from an input on the destination page.
      navigation.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus({ preventScroll: true });
    }
    setOpen(null);
    action();
  };
  return <nav ref={rail} className="om-creative-navigation" aria-label={t('Creative studio')}>
    <div className="om-creative-strip">
      <button className="om-nav-item" aria-current={currentPage === 'explore' ? 'page' : undefined} onClick={() => choose(() => onOpenPage('explore'))}>{t('Explore')}</button>
      <button className="om-nav-item" aria-current={motionActive ? 'page' : undefined} onClick={() => choose(() => onChooseStudio(motionStudio))}>
        <RemixIcon name={motionStudio.icon} size={16} />{t(motionStudio.title)}
      </button>
      {modalities.map(kind => <Popover key={kind} container={popupHost} modal={false} openOnHover open={open === kind}
        onOpenChange={value => setOpen(previous => value ? kind : previous === kind ? null : previous)}
        aria-label={t(mediaLabels[kind])} align="start" className="om-selection-panel om-creative-menu"
        trigger={<button className="om-nav-item" aria-current={destination?.scene.modality === kind ? 'location' : undefined}>{t(mediaLabels[kind])}<RemixIcon name="arrow-down-s-line" size={12} /></button>}>
        {open === kind && <MediaChoices {...catalog} kind={kind} destination={destination}
          onModel={id => choose(() => onModel(id))} onNavigate={next => choose(() => onNavigate(next))} onSkill={id => choose(() => onSkill(id))} openProviders={() => choose(openProviders)} />}
      </Popover>)}
      <Popover container={popupHost} modal={false} openOnHover open={open === 'mcp'}
        onOpenChange={value => setOpen(previous => value ? 'mcp' : previous === 'mcp' ? null : previous)}
        aria-label={t('Agent client')} align="start" className="om-selection-panel om-creative-client-menu"
        trigger={<button className="om-nav-item" aria-current={currentPage === 'mcp' ? 'page' : undefined}>MCP<RemixIcon name="arrow-down-s-line" size={12} /></button>}>
        <h2 className="om-eyebrow">{t('Agent client')}</h2>
        {mcpClients.map(client => <button className="om-nav-item" key={client.id} onClick={() => choose(() => onOpenPage('mcp', client.id))}>
          {t(client.name)}{client.host === 'chatgpt' && <small className="om-muted">{t('Remote connection unavailable')}</small>}
        </button>)}
      </Popover>
      <a className="om-nav-item" href={workspacePageHref(location.href, { api: true, tool: null, templates: false })} aria-current={currentPage === 'api' ? 'page' : undefined}
        onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose(() => onOpenPage('api')); }}>API</a>
      <span className="om-divider om-creative-divider" aria-hidden="true" />
      {creativeStudios.filter(studio => studio.surface !== 'editor').map(studio => <button key={studio.id} className="om-nav-item"
        aria-current={((studio.id === destination?.studio.id && !destination?.landing) || studio.id === specialty?.id) ? 'page' : undefined}
        onClick={() => choose(() => onChooseStudio(studio))}>{t(studio.title)}</button>)}
    </div>
  </nav>;
}
