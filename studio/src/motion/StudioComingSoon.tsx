import type { CreativeStudio } from '../../../shared/studio-catalog';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import threeDimensionalScene from './scene-art/studio-glass-sculpture.jpg';

/** Shared placeholder for Studio interfaces whose integration is still pending. */
export function StudioComingSoon({ studio }: { studio: CreativeStudio }) {
  const { t } = useI18n();
  return <section className="om-studio-coming-soon" data-coming-soon>
    {studio.id === '3d' && <img className="om-studio-coming-soon-art" src={threeDimensionalScene} alt="" />}
    <div className="om-studio-coming-soon-content">
    <span className="om-studio-heading-icon"><RemixIcon name={studio.icon} size={32} /></span>
    <h1 className="om-title">{t(studio.title)}</h1>
    <p className="om-studio-coming-soon-status" lang="en">Coming soon</p>
    </div>
  </section>;
}
