import { useRef } from 'react';
import { useI18n } from '../i18n/I18n';
import { StudioTemplateShelf } from './StudioTemplateShelf';
import { reportCreativeClick } from './exploreTracking';
import { BackToExploreButton } from './BackToExploreButton';
import { useWorkspaceChrome } from './WorkspaceChromeContext';

export function MotionStudioPage({ active, onBackToExplore }: { active: boolean; onBackToExplore?: () => void }) {
  const { t, locale } = useI18n();
  const { projectNavigation } = useWorkspaceChrome();
  const root = useRef<HTMLElement>(null);
  return <main ref={root} className="om-explore" aria-label={t('Motion templates')}>
    <div className="om-discovery-page">
    {onBackToExplore && <div><BackToExploreButton onClick={() => {
      reportCreativeClick('creative_studio', 'studio_bar', 'back_to_explore', { studio: 'motion' });
      onBackToExplore();
    }} /></div>}
    <StudioTemplateShelf key={locale} studio="motion" root={root} active={active} navigation={projectNavigation} />
  </div></main>;
}
