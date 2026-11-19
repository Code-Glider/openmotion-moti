import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { workspaceHistoryIndex } from '../utils/workspaceHistory';

export function WorkspaceBack({ fallback, inline = false, onBack }: { fallback: () => void; inline?: boolean; onBack?: () => void }) {
  const { t } = useI18n();
  const back = () => {
    onBack?.();
    if ((workspaceHistoryIndex() ?? 0) > 0) window.history.back();
    else fallback();
  };
  const button = <button type="button" className="om-nav-item om-studio-back" onClick={back}>
    <RemixIcon name="arrow-left-line" size={16} /><span>{t('Back')}</span>
  </button>;
  return inline ? button : <div className="om-page-back-row">{button}</div>;
}
