import type { ExploreCommunity } from '../../../shared/studio-catalog';
import { BrandLogo } from '../../../packages/design-system/react/BrandLogo';
import { PrimaryNavigationButton, PrimaryNavigationRail } from '../../../packages/design-system/react/PrimaryNavigationRail';
import { RemixIcon } from '../icons/RemixIcons';
import { Menu, MenuItem, MenuSeparator, MenuSubmenu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { Tooltip } from '../components/ui/Tooltip';
import { languages, useI18n, type Locale } from '../i18n/I18n';
import { useWorkspaceChrome } from './WorkspaceFrame';
import { useAccountSummary } from './AccountSettings';
import { CommunityLink } from './CommunityLink';
import { GitHubLink } from './GitHubLink';
import { repositorySupportLinks } from './githubRepository';
import type { SettingsSection } from './SettingsCenter';
import type { ReactNode } from 'react';
import type { MouseEvent } from 'react';

import { CreativeNavigation, type CreativeNavigationProps } from './CreativeNavigation';
import { WorkspaceSearch } from './WorkspaceSearch';

const avatarSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function ApplicationHeader({ settings, openAsset, onCommunity, onAccount, ...navigation }: Omit<CreativeNavigationProps, 'openProviders'> & {
  settings: SettingsSection | null;
  onAccount: () => void;
  openAsset: (assetId: string, version: string) => void;
  onCommunity: (community: ExploreCommunity) => void;
}) {
  const { t } = useI18n();
  const { openAssets, openHome, openModelSettings, navigationCollapsed, toggleNavigation } = useWorkspaceChrome();
  return <header className="om-app-header">
    <div className="om-app-leading">
      <Tooltip label={t(navigationCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}><button className="om-nav-item om-app-sidebar-toggle" onClick={toggleNavigation} aria-expanded={!navigationCollapsed} aria-controls="om-application-navigation" aria-label={t(navigationCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}><RemixIcon name="side-bar-line" size={16} /></button></Tooltip>
      <Tooltip label={t('Back to home')}><button type="button" className="om-nav-item om-app-brand" onClick={openHome} aria-label={t('Back to home')}><BrandLogo compact /></button></Tooltip>
    </div>
    <CreativeNavigation {...navigation} openProviders={openModelSettings} />
    <div className="om-app-header-actions">
      <WorkspaceSearch onSkill={navigation.onSkill} destination={navigation.destination} onLibrary={openAssets} onAccount={onAccount} onAsset={openAsset} onScene={navigation.onNavigate} onStudio={navigation.onChooseStudio} onCommunity={onCommunity} />
      <div className="om-app-header-links"><CommunityLink /><GitHubLink /></div>
      {settings && <button className="motion-icon-button" aria-label={t(settings === 'brand-kit' ? 'Close Brand Kit' : 'Close settings')} onClick={openHome}><RemixIcon name="close-line" size={20} /></button>}
    </div>
  </header>;
}
export function ApplicationRail({ settings, openSettings, home }: { settings: SettingsSection | null; openSettings: (section: SettingsSection) => void; home: ReactNode }) {
  const { t, locale, setLocale } = useI18n(), { account } = useAccountSummary();
  const { openLibrary, openConnections, openAssets, assetsOpen, openSkills, skillsOpen, switchingDisabled, navigationCollapsed } = useWorkspaceChrome();
  const userName = account?.user?.name?.trim() || account?.user?.email?.trim() || t('Account');
  const avatarInitial = avatarSegmenter.segment(userName)[Symbol.iterator]().next().value?.segment;
  const item = (label: string, icon: string, action: (event: MouseEvent<HTMLButtonElement>) => void, active = false, disabled = false) => (
    <Tooltip label={t(label)} side="right">
      <PrimaryNavigationButton aria-label={t(label)} aria-pressed={active} onClick={action} disabled={disabled}>
        <RemixIcon name={icon} size={18} weight={active ? 'fill' : undefined} />
      </PrimaryNavigationButton>
    </Tooltip>
  );
  const footer = <>
    {item('Help', 'question-line', () => openSettings('help'), settings === 'help')}
    {item('Settings', 'settings-3-line', () => openSettings('general'), Boolean(settings && !['mcp', 'brand-kit', 'providers', 'help', 'account', 'subscription'].includes(settings)))}
    {item('Model providers', 'brain-line', () => openSettings('providers'), settings === 'providers')}
    <Menu tooltip={t('Account menu')} modal={false} side="top" align="start" aria-label={t('Account menu')} className="om-account-menu om-selection-panel om-menu-panel" trigger={<PrimaryNavigationButton className="om-account-trigger" aria-current={settings === 'account' || settings === 'subscription' ? 'page' : undefined} aria-label={t('Account menu')}><span className="om-avatar" aria-hidden="true">{account?.state === 'signed-in' ? avatarInitial : <RemixIcon name="user-3-line" size={18} />}</span></PrimaryNavigationButton>}>
      <MenuItem onClick={() => openSettings('account')}><span className="om-menu-label"><RemixIcon name="user-3-line" size={16} /><strong>{userName}</strong></span></MenuItem><MenuSeparator />
      <MenuItem onClick={() => openSettings('subscription')}><span className="om-menu-label"><RemixIcon name="bank-card-line" size={16} />{t('Subscription & usage')}</span></MenuItem>
      <MenuSeparator />
      <MenuItem shortcut="⌘ ," onClick={() => openSettings('general')}><span className="om-menu-label"><RemixIcon name="settings-3-line" size={16} />{t('Settings')}</span></MenuItem>
      <MenuItem onClick={() => openSettings('appearance')}><span className="om-menu-label"><RemixIcon name="sun-line" size={16} />{t('Appearance')}</span></MenuItem>
      <MenuSubmenu aria-label={t('Language')} className="om-selection-panel om-menu-panel" label={<span className="om-menu-label"><RemixIcon name="global-line" size={16} />{t('Language')}</span>} detail={languages.find(language => language.locale === locale)?.label}>
        <MenuRadioGroup value={locale} onValueChange={value => setLocale(value as Locale)}>{languages.map(language => <MenuRadioItem key={language.locale} value={language.locale} closeOnClick>{language.label}</MenuRadioItem>)}</MenuRadioGroup>
      </MenuSubmenu>
      <MenuSeparator />
      {repositorySupportLinks.map(link => <MenuItem key={link.href} render={<a href={link.href} target="_blank" rel="noopener noreferrer" />}><span className="om-menu-label"><RemixIcon name={link.icon} size={16} />{t(link.label)}<RemixIcon className="om-menu-external" name="external-link-line" size={14} /></span></MenuItem>)}
      <MenuItem onClick={() => openSettings('help')}><span className="om-menu-label"><RemixIcon name="question-line" size={16} />{t('Help')}</span></MenuItem>
    </Menu>
  </>;

  return (
    <PrimaryNavigationRail id="om-application-navigation" className="om-app-rail om-collapsible" data-collapsed={navigationCollapsed}
      aria-label={t('Application navigation')} aria-hidden={navigationCollapsed} inert={navigationCollapsed} footer={footer}>
      {home}
      {item('Workspace assets', 'book-open-line', openAssets, assetsOpen)}
      {item('Template library', 'apps-2-line', event => openLibrary(event.currentTarget), false, switchingDisabled)}
      {item('Brand Kit', 'palette-line', () => openSettings('brand-kit'), settings === 'brand-kit')}
      {item('Skills', 'puzzle-line', openSkills, skillsOpen)}
      {item('MCP · Connect Agent', 'plug-line', () => openConnections('app_rail'), settings === 'mcp')}
    </PrimaryNavigationRail>
  );
}
