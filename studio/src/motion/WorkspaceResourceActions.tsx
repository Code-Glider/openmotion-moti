import { Tooltip } from '../components/ui/Tooltip';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useWorkspaceChrome } from './WorkspaceChromeContext';

export function WorkspaceResourceActions({ onBrandKit, brandKitOpen = false }: { onBrandKit: () => void; brandKitOpen?: boolean }) {
  const { t } = useI18n();
  const { openAssets, assetsOpen } = useWorkspaceChrome();
  return <>
    <Tooltip label={t('Brand Kit')}>
      <button type="button" className="om-nav-item" aria-label={t('Brand Kit')} aria-current={brandKitOpen ? 'page' : undefined} onClick={onBrandKit}>
        <RemixIcon name="palette-line" size={17} weight={brandKitOpen ? 'fill' : undefined} />
      </button>
    </Tooltip>
    <Tooltip label={t('Workspace assets')}>
      <button type="button" className="om-nav-item" aria-label={t('Workspace assets')} aria-current={assetsOpen ? 'page' : undefined} onClick={openAssets}>
        <RemixIcon name={assetsOpen ? 'folder-open-fill' : 'folder-line'} size={17} />
      </button>
    </Tooltip>
  </>;
}
