import { FeedbackLayer } from "../components/FeedbackLayer";
import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { ConnectionDialog } from './ConnectionDialog';
import { MotionIcon } from './icons';
import { RemixIcon } from '../icons/RemixIcons';
import { useWorkspace } from './useWorkspace';
import { Tooltip } from '../components/ui/Tooltip';
import { Dialog } from '@base-ui/react/dialog';
import { StudioToast } from '../components/StudioToast';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { isConnectionFailure } from '../components/ui/errorNoticeMessage';
import { workspacePresentation } from '../../../shared/workspace-url';
import { trackMotion } from './tracking';
import { ApplicationHeader, ApplicationRail } from './ApplicationChrome';
import { SettingsCenter, type SettingsSection } from './SettingsCenter';
import { SettingsSurfaceBoundary } from './SettingsSurfaceBoundary';
import { McpConnectionPage } from './McpConnectionPage';
import { WorkspaceHomeButton } from './WorkspaceHomeButton';

// Settings shares the model-picker dependencies. Keep it in the loaded shell so
// an open editor never requests a removed Settings chunk after a local rebuild.

type WorkspaceChrome = {
  workspace: ReturnType<typeof useWorkspace>;
  switchingDisabled: boolean;
  saveState: string;
  openLibrary: (trigger?: HTMLElement) => void;
  openConnections: () => void;
  openModelSettings: () => void;
  openHome: () => void;
  toggleSidebar: () => void;
  sidebarOpen: boolean;
  navigationCollapsed: boolean;
  toggleNavigation: () => void;
  settingsOpen?: boolean;
  registerEditor: (guard: EditorGuard | null) => void;
  beforeViewChange: () => Promise<void>;
};
export type EditorGuard = { waitForSaves: () => Promise<void>; blocked: boolean; saveState: string; message: string };
const WorkspaceChromeContext = createContext<WorkspaceChrome | null>(null);
export const useOptionalWorkspaceChrome = () => useContext(WorkspaceChromeContext);
export function useWorkspaceChrome() {
  const value = useContext(WorkspaceChromeContext);
  if (!value) throw new Error('Workspace controls require WorkspaceFrame');
  return value;
}

export function WorkspaceFrame({ children, waitForSaves, projectId, sessionId, blocked = false, message = '', saveState = '', onLibraryClose }: {
  children: ReactNode; waitForSaves: () => Promise<void>; projectId?: string; sessionId?: string; blocked?: boolean; message?: string; saveState?: string; onLibraryClose?: () => void;
}) {
  const { t } = useI18n();
  const presentation = workspacePresentation(location.search);
  const guard = useRef<EditorGuard | null>(null);
  const [editorState, setEditorState] = useState<Pick<EditorGuard, 'blocked' | 'saveState' | 'message'> | null>(null);
  const registerEditor = useCallback((value: EditorGuard | null) => {
    guard.current = value;
    setEditorState(previous => previous?.blocked === value?.blocked && previous?.saveState === value?.saveState && previous?.message === value?.message ? previous : value);
  }, []);
  const beforeViewChange = useCallback(async () => {
    if (guard.current?.blocked) throw new Error(guard.current.message || t('Working…'));
    await (guard.current?.waitForSaves ?? waitForSaves)();
  }, [waitForSaves, t]);
  const workspace = useWorkspace(beforeViewChange, projectId, sessionId);
  const [connectionSection, setConnectionSection] = useState<'setup' | 'templates'>(() => 'templates');
  const libraryTrigger = useRef<HTMLElement | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(() => new URLSearchParams(location.search).get('templates') === '1');
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1000);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1000);
  const [projectQuery, setProjectQuery] = useState('');
  const [navigationCollapsed, setNavigationCollapsed] = useState(() => {
    try { return localStorage.getItem('motion.workspace.navigation.v1') === 'collapsed'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('motion.workspace.navigation.v1', navigationCollapsed ? 'collapsed' : 'expanded'); }
    catch { /* Navigation remains usable when browser storage is unavailable. */ }
  }, [navigationCollapsed]);
  const toggleSidebar = useCallback(() => {
    if (navigationCollapsed) { setNavigationCollapsed(false); setSidebarOpen(true); }
    else setSidebarOpen(open => !open);
  }, [navigationCollapsed]);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const openSettings = useCallback((section: SettingsSection) => {
    setSettings(section); if (narrow) setSidebarOpen(false);
  }, [narrow]);
  const homeRef = useRef<HTMLDivElement>(null);
  const openHome = useCallback(() => {
    setSettings(null);
    setNavigationCollapsed(false);
    setSidebarOpen(true);
    // Returning home keeps the current editor mounted. The mobile drawer owns
    // its focus; on desktop, move focus off the departing settings controls.
    if (!narrow) requestAnimationFrame(() => homeRef.current?.querySelector<HTMLButtonElement>('.om-app-rail [aria-pressed="true"]')?.focus());
  }, [narrow]);
  const toggleHome = useCallback(() => {
    if (settings) openHome();
    else toggleSidebar();
  }, [settings, openHome, toggleSidebar]);
  useEffect(() => {
    const open = () => openSettings('local');
    window.addEventListener('motion:agents-open', open);
    return () => window.removeEventListener('motion:agents-open', open);
  }, [openSettings]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 999px)');
    const update = () => { setNarrow(query.matches); if (query.matches) setSidebarOpen(false); };
    query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); openSettings('general'); }
      if (event.altKey && event.key.toLowerCase() === 'b') { event.preventDefault(); setSettings(null); toggleSidebar(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [openSettings, toggleSidebar]);
  const libraryBusy = workspace.busy || blocked || Boolean(editorState?.blocked);
  const switchingDisabled = libraryBusy || !workspace.status;
  const notice = workspace.error || message || editorState?.message || "";
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const noticeKey = `${workspace.error ? workspace.errorSource : 'editor'}:${notice || ''}`;
  // Hiding a notice never clears an editor's write guard. New errors reset the dismissal.
  const visibleNotice = notice && dismissedNotice !== noticeKey;
  if (!notice && dismissedNotice !== null) setDismissedNotice(null);
  const value: WorkspaceChrome = { workspace, switchingDisabled, saveState: editorState?.saveState || saveState, registerEditor, beforeViewChange,
    openLibrary: trigger => { libraryTrigger.current = trigger ?? null; workspace.clearError(); setConnectionSection('templates'); setConnectionsOpen(true); },
    openConnections: () => openSettings('mcp'),
    openModelSettings: () => openSettings('providers'),
    openHome, toggleSidebar, sidebarOpen, navigationCollapsed,
    toggleNavigation: () => setNavigationCollapsed(collapsed => !collapsed), settingsOpen: Boolean(settings) };
  return <WorkspaceChromeContext.Provider value={value}>
    <Dialog.Root open={sidebarOpen && narrow && !settings && !navigationCollapsed} onOpenChange={setSidebarOpen}>
    <div ref={homeRef} className="om-application" data-embedded={presentation.embedded} data-navigation-collapsed={navigationCollapsed}>
      <ApplicationHeader settings={settings} />
      <ApplicationRail settings={settings} openSettings={openSettings} home={<WorkspaceHomeButton
        active={!settings} expanded={sidebarOpen && !settings && !navigationCollapsed}
        previewEnabled={!narrow && !sidebarOpen && !settings && !navigationCollapsed && !connectionsOpen}
        onToggle={toggleHome}>
        {close => <WorkspaceSidebar currentId={projectId} close={close} onNavigate={close} query={projectQuery} setQuery={setProjectQuery} />}
      </WorkspaceHomeButton>} />
      <div className="motion-workspace">
      <Dialog.Portal>
        <Dialog.Backdrop className="hf-overlay-backdrop motion-sidebar-backdrop" />
        <Dialog.Popup id="om-project-navigation" className="motion-sidebar-drawer" aria-label={t('Project list')} onKeyDown={event => event.stopPropagation()}>
          <WorkspaceSidebar currentId={projectId} close={() => setSidebarOpen(false)} query={projectQuery} setQuery={setProjectQuery} />
        </Dialog.Popup>
      </Dialog.Portal>
      {!narrow && !settings && <div id="om-project-navigation" className="om-project-navigation om-collapsible" aria-hidden={!sidebarOpen || navigationCollapsed} inert={!sidebarOpen || navigationCollapsed}>
        <WorkspaceSidebar currentId={projectId} close={() => setSidebarOpen(false)} query={projectQuery} setQuery={setProjectQuery} />
      </div>}
      <div className="motion-workspace-content" hidden={Boolean(settings)} inert={Boolean(settings)}>
        {visibleNotice && (workspace.error && workspace.errorSource === 'connection' && isConnectionFailure(notice)
          ? <FeedbackLayer><div data-testid="motion-connection-toast" className="pointer-events-none absolute top-16 left-1/2 z-91 flex max-w-[calc(100%-32px)] -translate-x-1/2 justify-center">
              <StudioToast message="Connection lost." tone="error" presentation="feedback" singleLine
                status="Reconnecting…" />
            </div></FeedbackLayer>
          : <ErrorNotice key={noticeKey} message={notice}
              onDismiss={() => { setDismissedNotice(noticeKey); if (workspace.error) workspace.clearError(); }} />)}
        {children}
      </div>
      {settings && <SettingsSurfaceBoundary key={settings}>{settings === 'mcp'
        ? <McpConnectionPage openLibrary={value.openLibrary} openProviders={value.openModelSettings} />
        : <SettingsCenter navigationCollapsed={navigationCollapsed} section={settings} onSection={setSettings} openConnections={value.openConnections} />}</SettingsSurfaceBoundary>}
      </div>
    </div>
    </Dialog.Root>
    {connectionsOpen && <ConnectionDialog open returnFocus={libraryTrigger.current} section={connectionSection} busy={libraryBusy} openingDisabled={switchingDisabled} error={workspace.error} onClose={() => { setConnectionsOpen(false); if (connectionSection === 'templates') onLibraryClose?.(); }} onOpen={id => { if (!switchingDisabled) void (sessionId ? workspace.createArtifact(sessionId, id) : workspace.startSession(undefined, id)); }} />}
  </WorkspaceChromeContext.Provider>;
}

function WorkspaceSidebar({ currentId, close, query, setQuery, onNavigate }: {
  currentId?: string; close: () => void; query: string; setQuery: (query: string) => void; onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const { workspace, switchingDisabled } = useWorkspaceChrome();
  const projects = workspace.projects;
  const filtered = projects.filter(project => project.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <aside className="motion-sidebar" aria-label={t('Workspace navigation')}>
    <div className="motion-sidebar-brand">
      <strong className="om-subtitle">{t('Home')}</strong>
      <button className="motion-icon-button" onClick={close} aria-label={t('Close project list')}><MotionIcon name="sidebar" size={16} /></button>
    </div>
    <div className="motion-session-heading">
      <span>{t('Projects')}</span>
      <Tooltip label={t('New project')}>
        <button type="button" className="motion-icon-button" aria-label={t('New project')} disabled={switchingDisabled} onClick={event => {
          void trackMotion('ui_click', { page_name: 'studio', area: 'workspace', element: 'new_creation', interaction_method: event.detail === 0 ? 'keyboard' : 'pointer' });
          void workspace.create();
          onNavigate?.();
        }}>
          <MotionIcon name="plus" size={16} />
        </button>
      </Tooltip>
    </div>
    <label className="motion-session-search"><MotionIcon name="search" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search projects…')} aria-label={t('Search projects')} /></label>
    <nav className="motion-session-list" aria-label={t('Project list')}>
      {!workspace.status && !workspace.error && <p className="motion-session-empty" role="status">{t('Loading projects…')}</p>}
      {workspace.status && !filtered.length && <p className="motion-session-empty">{t(query ? 'No matching projects' : 'Create a project with your Agent to start editing.')}</p>}
      {filtered.map(project => <button key={project.id} className="motion-session" aria-current={currentId === project.id ? 'page' : undefined}
        title={project.title} disabled={switchingDisabled} onClick={event => {
          if (project.id === currentId) close();
          else {
            void trackMotion('ui_click', { page_name: 'studio', area: 'workspace', element: 'open_project', interaction_method: event.detail === 0 ? 'keyboard' : 'pointer' });
            void workspace.open('projects', project.id);
            onNavigate?.();
          }
        }}>
        <span className="motion-session-dot" aria-hidden="true" /><span><strong>{project.title}</strong></span>
      </button>)}
    </nav>
  </aside>;
}

export function WorkspaceMenuButton() {
  const { t } = useI18n();
  const { toggleSidebar, sidebarOpen, navigationCollapsed } = useWorkspaceChrome();
  const visible = sidebarOpen && !navigationCollapsed;
  return <button className="motion-icon-button motion-workspace-menu" onClick={toggleSidebar} aria-expanded={visible} title={t(visible ? 'Collapse project list' : 'Open project list')} aria-label={t(visible ? 'Collapse project list' : 'Open project list')}><MotionIcon name="sidebar" size={16} /></button>;
}
