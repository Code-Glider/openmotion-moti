import { Button } from 'open-design-ui/button';
import { Tooltip } from '../components/ui/Tooltip';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useWorkspaceChrome } from './WorkspaceChromeContext';

export function WorkspaceResourceActions({ onBrandKit, closeMenu }: {
  onBrandKit?: () => void; closeMenu?: () => void;
}) {
  const { t } = useI18n();
  const { openAssets, assetsOpen } = useWorkspaceChrome();
  const actions = [
    { label: t('Workspace assets'), icon: assetsOpen ? 'folder-open-fill' : 'folder-line', active: assetsOpen, open: openAssets },
  ];
  if (onBrandKit) actions.unshift({ label: t('Brand Kit'), icon: 'palette-line', active: false, open: onBrandKit });
  return actions.map(({ label, icon, active, open }) => {
    const button = <Button key={label} type="button" variant="ghost" className={closeMenu ? 'om-nav-item' : 'om-nav-item om-header-icon'} aria-label={label}
      aria-current={active ? 'page' : undefined} onClick={() => { closeMenu?.(); open(); }}>
      <RemixIcon name={icon} size={17} />{closeMenu && label}
    </Button>;
    return closeMenu ? button : <Tooltip key={label} label={label}>{button}</Tooltip>;
  });
}
