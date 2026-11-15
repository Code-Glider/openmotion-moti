import { useEffect, useState } from 'react';
import { hostNames, integrationHost, integrationHosts, manualConnection, setupPrompt, type IntegrationInfo } from '../../../shared/integration';
import { useI18n } from '../i18n/I18n';
import { Select } from '../components/ui/Select';
import { RemixIcon } from '../icons/RemixIcons';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { SettingsDialog, SettingsLoading } from './settingsPrimitives';

/** Connect an external client to this installation; never installs or grants access itself. */
export function AgentConnectionDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus?: HTMLElement | null }) {
  const { t, locale } = useI18n(), toast = useToast();
  const [host, setHost] = useState(() => integrationHost(new URLSearchParams(location.search).get('host')));
  const [info, setInfo] = useState<IntegrationInfo | null>(null), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setInfo(null); setFailed(false);
    void (async () => {
      try {
        const response = await fetch('/motion-api/integration', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (!response.ok) throw new Error('Unavailable');
        const value = await response.json() as IntegrationInfo;
        if (!['OpenMotion', 'OpenDesign', 'OpenDesign Motion'].includes(value.name) || value.transport?.type !== 'stdio'
          || !value.transport.command || !Array.isArray(value.transport.args) || !value.transport.env?.MOTION_DATA_DIR
          || !Array.isArray(value.tools) || !value.previewUrl) throw new Error('Invalid integration');
        if (!controller.signal.aborted) setInfo(value);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  }, [attempt]);
  const language = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const prompt = info ? setupPrompt(info, host, language) : '';
  const manual = info ? manualConnection(info, host, language) : '';
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.showToast(t('Copied to clipboard'), 'info', 'feedback'); }
    catch { toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback'); }
  }
  return <SettingsDialog title={t('Connect Agent')} onClose={onClose} returnFocus={returnFocus}>
    <div className="om-agent-connection">
      <p className="om-muted">{t('Choose your Agent, then paste the connection instruction into its conversation.')}</p>
      <div className="om-label"><span>{t('Agent client')}</span><Select label={t('Agent client')} value={host} onCommit={value => setHost(integrationHost(value))} options={integrationHosts.map(value => ({ value, label: hostNames[value] }))} /></div>
      {failed ? <div className="om-card om-card-stack" role="alert"><h3 className="om-subtitle">{t('Could not reach this workspace')}</h3><p className="om-muted">{t('Check your connection and try again.')}</p><button className="om-button" onClick={() => setAttempt(value => value + 1)}>{t('Retry')}</button></div>
        : !info ? <SettingsLoading /> : <>
          <div className="om-settings-row"><span className="om-badge">{t('Workspace reachable')} · v{info.version}</span><button className="motion-icon-button" aria-label={t('Refresh status')} onClick={() => setAttempt(value => value + 1)}><RemixIcon name="refresh-line" size={16} /></button></div>
          <div className="om-card om-card-stack"><h3 className="om-subtitle">{t(host === 'chatgpt' ? 'Remote connection unavailable' : 'Connect from your Agent')}</h3>
            <p className="om-muted">{t(host === 'chatgpt' ? 'ChatGPT cloud cannot connect to this local workspace. Choose a local Agent above.' : 'Paste this instruction into your Agent on this computer. It will guide you through setup and verify access.')}</p>
            <pre className="om-code-block">{host === 'chatgpt' ? manual : prompt}</pre>
            {host !== 'chatgpt' && <button className="om-button" data-primary onClick={() => void copy(prompt)}><RemixIcon name="file-copy-line" size={15} />{t('Copy connection instruction')}</button>}
          </div>
          {host !== 'chatgpt' && <details key={host}><summary className="om-muted">{t('Manual setup')}</summary><pre className="om-code-block">{manual}</pre><div className="om-settings-actions"><button className="om-button" onClick={() => void copy(manual)}>{t('Copy configuration')}</button><a className="om-button" href={`/connect/config?host=${host}`} download>{t('Download configuration')}</a><a className="om-text-link" href={`/connect/guide?host=${host}`} target="_blank" rel="noreferrer">{t('Connection guide')}<RemixIcon name="external-link-line" size={14} /></a></div></details>}
          <p className="om-muted">{t('Workspace status confirms this app is reachable. Your Agent verifies its connection after setup.')}</p>
        </>}
    </div>
    <StudioToastViewport {...toast} />
  </SettingsDialog>;
}
