import { BrandLogo } from '../../../packages/design-system/react/BrandLogo';
import type { MouseEvent } from 'react';
import { RemixIcon } from '../icons/RemixIcons';
import { Menu, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { useWorkspaceChrome } from './WorkspaceFrame';
import { useAccountSummary } from './AccountSettings';
import { ModelSwitcher } from './ModelSwitcher';
import { CommunityLink } from './CommunityLink';
import { GitHubLink } from './GitHubLink';
import type { SettingsSection } from './SettingsCenter';

export function ApplicationHeader({ settings }: { settings: SettingsSection | null }) {
  const { t } = useI18n();
  const { openHome, openModelSettings, navigationCollapsed, toggleNavigation } = useWorkspaceChrome();
  return <header className="om-app-header">
    <div className="om-app-leading"><Tooltip label={t(navigationCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}><button className="om-nav-item om-app-sidebar-toggle" onClick={toggleNavigation} aria-expanded={!navigationCollapsed} aria-controls="om-application-navigation" aria-label={t(navigationCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}><RemixIcon name="side-bar-line" size={16} /></button></Tooltip><div className="om-app-brand"><BrandLogo /></div></div>
    <div className="om-app-navigation">{settings ? <button className="om-nav-item" onClick={openHome} aria-label={t('Back to home')}><RemixIcon name="arrow-left-line" size={16} /><span>{t('Back to home')}</span></button> : null}</div>
    <div className="om-app-header-actions"><div className="om-app-header-links"><CommunityLink /><GitHubLink /></div>{!settings && <ModelSwitcher openSettings={openModelSettings} />}{settings && <Tooltip label={t('Close settings')}><button className="motion-icon-button" aria-label={t('Close settings')} onClick={openHome}><RemixIcon name="close-line" size={20} /></button></Tooltip>}</div>
  </header>;
}
export function ApplicationRail({ settings, openSettings }: { settings: SettingsSection | null; openSettings: (section: SettingsSection) => void }) {
  const { t } = useI18n(), { account } = useAccountSummary();
  const { openHome, openLibrary, switchingDisabled, navigationCollapsed } = useWorkspaceChrome();
  const userName = account?.user?.name || account?.user?.email || t('Account');
  const item = (label: string, icon: string, action: (event: MouseEvent<HTMLButtonElement>) => void, active = false, disabled = false) => <Tooltip label={t(label)} side="right"><button className="om-nav-item om-rail-button" aria-label={t(label)} aria-pressed={active} onClick={action} disabled={disabled}><RemixIcon name={icon} size={18} /></button></Tooltip>;
  return <nav id="om-application-navigation" className="om-app-rail om-collapsible" aria-label={t('Application navigation')} aria-hidden={navigationCollapsed} inert={navigationCollapsed}>
    {item('Home', 'home-line', openHome, !settings)}
    {item('Template library', 'apps-2-line', event => openLibrary(event.currentTarget), false, switchingDisabled)}
    <div className="om-rail-spacer" />
    {item('Help', 'question-line', () => openSettings('help'), settings === 'help')}
    {item('Settings', 'settings-3-line', () => openSettings('general'), Boolean(settings && !['providers', 'help', 'account', 'subscription'].includes(settings)))}
    {item('Model providers', 'plug-line', () => openSettings('providers'), settings === 'providers')}
    <Menu modal={false} side="top" align="start" aria-label={t('Account menu')} className="om-account-menu" trigger={<button className="om-nav-item om-rail-button om-account-trigger" aria-current={settings === 'account' || settings === 'subscription' ? 'page' : undefined} aria-label={t('Account menu')}><span className="om-avatar">{account?.state === 'signed-in' ? userName.slice(0, 2).toUpperCase() : <RemixIcon name="user-3-line" size={18} />}</span></button>}>
      <MenuItem onClick={() => openSettings('account')}><span className="om-account-menu-item"><RemixIcon name="user-3-line" size={16} /><strong>{userName}</strong></span></MenuItem><MenuSeparator />
      {([{ id: 'subscription', label: 'Subscription & usage', icon: 'bank-card-line' }, { id: 'appearance', label: 'Appearance', icon: 'sun-line' }, { id: 'help', label: 'Help', icon: 'question-line' }] as const).map(item => <MenuItem key={item.id} onClick={() => openSettings(item.id)}><span className="om-account-menu-item"><RemixIcon name={item.icon} size={16} />{t(item.label)}</span></MenuItem>)}
      <MenuSeparator /><MenuItem shortcut="⌘ ," onClick={() => openSettings('general')}><span className="om-account-menu-item"><RemixIcon name="settings-3-line" size={16} />{t('Settings')}</span></MenuItem>
    </Menu>
  </nav>;
}
