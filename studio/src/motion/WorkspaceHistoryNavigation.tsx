import { useEffect, useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { initializeWorkspaceHistory, traverseWorkspaceHistory, workspaceHistoryAvailability, WORKSPACE_LOCATION_CHANGED } from '../utils/workspaceHistory';

function subscribe(listener: () => void) {
  window.addEventListener(WORKSPACE_LOCATION_CHANGED, listener);
  window.addEventListener('popstate', listener);
  return () => {
    window.removeEventListener(WORKSPACE_LOCATION_CHANGED, listener);
    window.removeEventListener('popstate', listener);
  };
}

/** Shared by the shell and modal pages, which make the shell itself inert. */
export function WorkspaceHistoryNavigation() {
  const { t } = useI18n();
  useEffect(initializeWorkspaceHistory, []);
  const available = useSyncExternalStore(subscribe, workspaceHistoryAvailability);
  return <nav className="om-history-navigation" aria-label={t('Page navigation')}>
    <button type="button" className="om-nav-item" aria-label={t('Back')} title={t('Back')} disabled={!(available & 1)} onClick={() => traverseWorkspaceHistory(-1)}><RemixIcon name="arrow-left-line" size={18} /></button>
    <button type="button" className="om-nav-item" aria-label={t('Forward')} title={t('Forward')} disabled={!(available & 2)} onClick={() => traverseWorkspaceHistory(1)}><RemixIcon name="arrow-right-line" size={18} /></button>
  </nav>;
}
