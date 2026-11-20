import { Button } from 'open-design-ui/button';
import { useRef } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { StudioTemplateShelf } from './StudioTemplateShelf';
import { reportCreativeClick } from './exploreTracking';
import { BackToExploreButton } from './BackToExploreButton';
import { useWorkspaceChrome } from './WorkspaceChromeContext';
import { motionStudioCover } from './skillCatalog';

export function MotionStudioPage({ active, editorDisabled, onOpenEditor, onBackToExplore }: {
  active: boolean; editorDisabled: boolean; onOpenEditor: () => void; onBackToExplore?: () => void;
}) {
  const { t, locale } = useI18n();
  const { projectNavigation } = useWorkspaceChrome();
  const root = useRef<HTMLElement>(null);
  return <main ref={root} className="om-explore" aria-label={t('Motion templates')}>
    <div className="om-discovery-page">
    {onBackToExplore && <div><BackToExploreButton onClick={() => {
      reportCreativeClick('creative_studio', 'studio_bar', 'back_to_explore', { studio: 'motion' });
      onBackToExplore();
    }} /></div>}
    <header className="om-discovery-hero om-studio-landing-hero">
      {motionStudioCover?.poster && <img src={motionStudioCover.poster} alt="" />}
      <div className="om-discovery-hero-copy">
        <h1>{t('Motion Studio')}</h1>
        <p>{t('Animate type and shapes, then edit their timing on the timeline.')}</p>
        <Button variant="ghost" type="button" className="om-button h-auto" data-primary="media" disabled={editorDisabled} onClick={() => {
          reportCreativeClick('creative_studio', 'studio_bar', 'open_editor', { studio: 'motion' });
          onOpenEditor();
        }}>
          {t('Open Motion Editor')}<RemixIcon name="arrow-right-line" size={16} />
        </Button>
      </div>
    </header>
    <StudioTemplateShelf key={locale} studio="motion" root={root} active={active} navigation={projectNavigation} />
  </div></main>;
}
