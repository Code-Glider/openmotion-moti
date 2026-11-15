import { useEffect, useRef, useState } from 'react';
import { brand, designSystemAsset } from '../../../packages/design-system/index.js';
import { BrandLogo } from '../../../packages/design-system/react/BrandLogo';
import { manualConnection, setupPrompt, templatePrompt, type IntegrationHost } from '../../../shared/integration';
import { isEditableTemplate, type GalleryTemplate, type TemplatePage } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Tabs, TabsList, Tab, TabPanel } from '../components/ui/Tabs';
import { Skeleton } from '../components/ui/Skeleton';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { ProviderAvatar, SettingsError, SettingsLoading } from './settingsPrimitives';
import { useIntegrationInfo } from './useIntegrationInfo';
import { motionApi } from './useWorkspace';
import { GITHUB_REPOSITORY } from './githubRepository';
import { mcpCapabilities, mcpBenefits, mcpFaq } from './mcpCapabilities';
import './McpConnectionPage.css';

const clients: { id: string; name: string; brand: string; host: IntegrationHost }[] = [
  { id: 'codex', name: 'Codex', brand: 'codex', host: 'codex' },
  { id: 'claude', name: 'Claude Code', brand: 'claude-code', host: 'claude' },
  { id: 'cursor', name: 'Cursor', brand: 'cursor-agent', host: 'mcp' },
  { id: 'deepseek', name: 'DeepSeek Harness', brand: 'deepseek', host: 'deepseek' },
  { id: 'desktop', name: 'Claude Desktop', brand: 'claude-code', host: 'mcp' },
  { id: 'chatgpt', name: 'ChatGPT', brand: 'openai', host: 'chatgpt' },
  { id: 'mcp', name: 'Other MCP clients', brand: 'mcp', host: 'mcp' },
];

export function McpConnectionPage({ openLibrary, openProviders }: { openLibrary: (trigger?: HTMLElement) => void; openProviders: () => void }) {
  const { t, locale } = useI18n(), toast = useToast();
  const { info, failed, retry } = useIntegrationInfo();
  const [clientId, setClientId] = useState(() => new URLSearchParams(location.search).get('host') || 'codex');
  const client = clients.find(item => item.id === clientId) ?? clients[0];
  const [setupMode, setSetupMode] = useState('agent');
  const [templates, setTemplates] = useState<GalleryTemplate[] | null>(null), [templateFailed, setTemplateFailed] = useState(false), [attempt, retryTemplates] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setTemplates(null); setTemplateFailed(false);
    void motionApi<TemplatePage>(`/template-catalog?category=all&covered=true&limit=6&offset=0&locale=${encodeURIComponent(locale)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      .then(page => { if (!Array.isArray(page.items)) throw new Error('Invalid catalogue'); if (!controller.signal.aborted) setTemplates(page.items.slice(0, 6)); })
      .catch(() => { if (!controller.signal.aborted) setTemplateFailed(true); });
    return () => controller.abort();
  }, [locale, attempt]);
  const supported = client.host !== 'chatgpt';
  const language = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const prompt = info ? setupPrompt(info, client.host, language).replace('MCP / CLI', client.name) : '';
  const manual = info ? manualConnection(info, client.host, language) : '';
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.showToast(t('Copied to clipboard'), 'info', 'feedback'); }
    catch { toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback'); }
  }
  const copyCreation = (text: string) => copy(`${prompt}\n\n${t(text)}`);
  const copyButton = (text: string, label = 'Copy prompt') => <button className="om-button" disabled={!info || !supported} onClick={() => void copy(text)}><RemixIcon name="file-copy-line" size={16} />{t(label)}</button>;
  return <main className="om-mcp-page" aria-labelledby="mcp-title" onKeyDown={event => event.stopPropagation()}>
    <div className="om-mcp-content">
      <section className="om-mcp-hero om-mcp-section">
        <div className="om-mcp-art" aria-hidden="true">
          <div className="om-mcp-art-tile om-mcp-art-left"><ProviderAvatar name="ChatGPT" provider={{ id: 'openai', custom: false }} /></div>
          <div className="om-mcp-art-tile om-mcp-art-center"><img src={designSystemAsset(brand.loadingMark)} alt="" /></div>
          <div className="om-mcp-art-tile om-mcp-art-right"><ClientAvatar client={client} /></div>
        </div>
        <p className="om-mcp-eyebrow">OPENMOTION × MCP</p>
        <h1 id="mcp-title" ref={heading} tabIndex={-1}>{t('Create in {agent}', { agent: t(client.name) })}<br /><span>{t('Make it move with OpenMotion.')}</span></h1>
        <p className="om-mcp-lead">{t('Your Agent. Your ideas. One editable video workspace.')}</p>
        <Tabs value={client.id} onValueChange={value => setClientId(String(value))}>
          <TabsList className="om-mcp-client-tabs" aria-label={t('Agent client')}>{clients.map(item => <Tab value={item.id} key={item.id}><ClientAvatar client={item} /><span>{t(item.name)}</span></Tab>)}</TabsList>
          {clients.map(item => <TabPanel value={item.id} key={item.id}>
            <div className="om-mcp-setup-tray">
              <div className="om-mcp-setup-top"><span className="om-badge"><RemixIcon name="computer-line" size={14} />{t('Local workspace · stdio')}</span><span className="om-muted">{t('No project changes during setup')}</span></div>
              {failed ? <SettingsError retry={retry} /> : !info ? <SettingsLoading /> : !supported ? <div className="om-card om-mcp-unavailable"><RemixIcon name="information-line" size={28} /><h2>{t('Remote connection unavailable')}</h2><p>{t('ChatGPT cloud cannot connect to this local workspace. Choose a local Agent above.')}</p><pre className="om-code-block">{manual}</pre><button className="om-button" onClick={() => setClientId('codex')}>{t('Use a local Agent')}</button></div> : <div className="om-mcp-setup-grid">
                <article className="om-card om-mcp-step">
                  <h2><span className="om-mcp-step-number">1</span>{t('Connect your Agent')}</h2>
                  <Tabs value={setupMode} onValueChange={value => setSetupMode(String(value))}><TabsList aria-label={t('Setup method')}><Tab value="agent">{t('Let your Agent set it up')}</Tab><Tab value="manual">{t('Manual setup')}</Tab></TabsList>
                    <TabPanel value="agent"><p className="om-muted">{t('Paste this instruction into your Agent on this computer. It will guide you through setup and verify access.')}</p><pre className="om-code-block">{prompt}</pre><div className="om-mcp-actions">{copyButton(prompt, 'Copy connection instruction')}<a className="om-button" href={`/connect/guide?host=${client.host}`} target="_blank" rel="noreferrer">{t('Connection guide')}<RemixIcon name="external-link-line" size={14} /></a></div></TabPanel>
                    <TabPanel value="manual"><p className="om-muted">{t(client.host === 'mcp' ? 'Merge this configuration into your client’s local MCP settings. Preserve your other servers, then reload the connection.' : 'Run this command in a local terminal, then reload the Agent connection.')}</p><pre className="om-code-block">{manual}</pre><div className="om-mcp-actions">{copyButton(manual, 'Copy configuration')}<a className="om-button" href={`/connect/config?host=${client.host}`} download>{t('Download configuration')}</a></div></TabPanel>
                  </Tabs>
                </article>
                <article className="om-card om-mcp-step"><h2><span className="om-mcp-step-number">2</span>{t('Start creating in {agent}', { agent: t(client.name) })}</h2><p className="om-muted">{t('After connection, ask your Agent to read this workspace, then describe your film. Start with an idea, your material or a template.')}</p>
                  <div className="om-mcp-starters">{mcpCapabilities.slice(0, 4).map(capability => <button className="om-nav-item" key={capability.id} onClick={() => void copyCreation(capability.prompt)}><RemixIcon name={capability.icon} size={18} />{t(capability.title)}</button>)}</div>
                  <button className="om-button" data-primary onClick={event => openLibrary(event.currentTarget)}><RemixIcon name="clapperboard-line" size={16} />{t('Explore templates')}<RemixIcon name="arrow-right-line" size={16} /></button>
                </article>
              </div>}
            </div>
          </TabPanel>)}
        </Tabs>
        <p className="om-mcp-connection-note om-muted">{t('Workspace status confirms this app is reachable. Your Agent verifies its connection after setup.')}{info && <span> · v{info.version}</span>}</p>
      </section>

      <section className="om-mcp-section" aria-labelledby="mcp-templates"><div className="om-mcp-section-heading"><div><p className="om-mcp-eyebrow">{t('A starting point for every idea')}</p><h2 id="mcp-templates">{t('Bring a template into your conversation')}</h2></div><button className="om-button" onClick={event => openLibrary(event.currentTarget)}>{t('View all templates')}<RemixIcon name="arrow-right-line" size={16} /></button></div>
        {templateFailed ? <div className="om-card om-mcp-unavailable"><p>{t('Templates could not be loaded.')}</p><button className="om-button" onClick={() => retryTemplates(value => value + 1)}>{t('Retry')}</button></div> : <div className="om-mcp-template-grid">{templates === null ? [1, 2, 3].map(key => <Skeleton key={key} className="om-mcp-template-skeleton" />) : templates.map(template => <article className="om-mcp-template" key={template.id}>
          <McpTemplatePoster template={template} />
          <div className="om-mcp-template-body"><span className="om-badge">{t(isEditableTemplate(template) ? 'Ready to edit' : 'Reference · Agent recreation')}</span><h3>{template.title}</h3><p className="om-muted">{template.description || template.subtitle}</p><div className="om-mcp-actions">{copyButton(info ? `${prompt}\n\n${templatePrompt(info, client.host, template, locale)}` : '', 'Copy template prompt')}<button className="om-button" onClick={event => openLibrary(event.currentTarget)} aria-label={t('View all templates')}>{t('Template library')}<RemixIcon name="arrow-right-line" size={14} /></button></div></div>
        </article>)}</div>}{templates?.length === 0 && <p className="om-muted">{t('No templates available. Open the library or try again later.')}</p>}
      </section>

      <section className="om-mcp-section"><h2>{t('Why create with OpenMotion in your Agent?')}</h2><div className="om-mcp-benefit-grid">{mcpBenefits.map((item, index) => <article key={item.title} className="om-mcp-feature" data-featured={index === 0}><RemixIcon name={item.icon} size={26} /><h3>{t(item.title)}</h3><p>{t(item.description)}</p></article>)}</div></section>
      <section className="om-mcp-section"><h2>{t('What you can ask it to do')}</h2><p className="om-muted">{t('Every capability below maps to the current public MCP tools. Media generation requires a configured provider.')}</p><div className="om-mcp-capability-grid">{mcpCapabilities.map(item => <article className="om-mcp-feature" key={item.id}><RemixIcon name={item.icon} size={24} /><h3>{t(item.title)}</h3><p>{t(item.description)}</p><button className="om-text-link" disabled={!info || !supported} onClick={() => void copyCreation(item.prompt)}>{t('Copy an example')}<RemixIcon name="file-copy-line" size={14} /></button></article>)}</div>
        <details className="om-mcp-tool-details"><summary>{t('Tools exposed by this installation')}{info && ` · ${info.tools.length}`}</summary><div className="om-mcp-tool-list">{info?.tools.map(tool => <div key={tool.name}><code>{tool.name}</code><p className="om-muted">{t(mcpCapabilities.find(item => (item.tools as readonly string[]).includes(tool.name))?.description || tool.description)}</p></div>)}</div></details>
      </section>
      <section className="om-mcp-section"><h2>{t('What each client can do')}</h2><p className="om-muted">{t('Local connection, generation and inline presentation are different capabilities.')}</p><div className="om-mcp-table-wrap" tabIndex={0} role="region" aria-label={t('Client compatibility')}><table className="om-mcp-table"><thead><tr><th>{t('Capability')}</th><th>Codex / Claude Code / DeepSeek</th><th>{t('Desktop / other MCP clients')}</th><th>ChatGPT {t('Cloud')}</th></tr></thead><tbody>{[
        ['Connection', 'Local stdio', 'Local stdio, when supported', 'Not available'],
        ['Templates, editing and version history', 'Supported', 'Requires tools and resource support', 'Not available'],
        ['Images, video, music and voice', 'With configured providers', 'With configured providers', 'Not available'],
        ['Local material', 'Explicit local file paths', 'Host file access required', 'Not available'],
        ['Preview and MP4 export', 'Local Studio and export links', 'Local Studio and export links', 'Not available'],
        ['Inline template cards and final video', 'Requires MCP Apps negotiation', 'Requires MCP Apps negotiation', 'Not available'],
      ].map(row => <tr key={row[0]}>{row.map((cell, i) => i === 0 ? <th scope="row" key={i}>{t(cell)}</th> : <td key={i}>{t(cell)}</td>)}</tr>)}</tbody></table></div></section>
      <section className="om-mcp-section"><h2>{t('MCP, Skills or local API?')}</h2><div className="om-mcp-capability-grid">{[
        ['plug-line', 'MCP', 'Connect compatible Agents to the same local project tools. Use the generated configuration above; the editor address is not an HTTP MCP endpoint.', 'docs/mcp-phase1-tools.md'],
        ['file-text-line', 'Production Skills', 'Give your Agent the creative workflow, reference guides and verification rules. Installed Skills and MCP resources share the maintained guidance.', 'docs/skills.md'],
        ['code-s-slash-line', 'Local API & CLI', 'For local development and automation. Use the documented application boundary and project safeguards; no hosted public API is provided here.', 'docs/agent-adapters.md'],
      ].map(([icon, title, body, doc]) => <article className="om-mcp-feature" key={title}><RemixIcon name={icon} size={24} /><h3>{t(title)}</h3><p>{t(body)}</p><a className="om-text-link" href={`${GITHUB_REPOSITORY}/blob/main/${doc}`} target="_blank" rel="noreferrer">{t('Documentation')}<RemixIcon name="external-link-line" size={14} /></a></article>)}</div></section>
      <section className="om-mcp-section om-mcp-policy-grid"><div><h2>{t('Costs & limits')}</h2><ul>{['Connecting does not run a model or start a render. Agent subscriptions and media-provider charges are separate.', 'Generation depends on provider access, model support and available quota. There is no universal free-generation allowance or fixed completion time.', 'Use the same generation or export job to check progress. Cancellation depends on the task and provider; it does not guarantee a refund.'].map(text => <li key={text}>{t(text)}</li>)}</ul><button className="om-button" onClick={openProviders}><RemixIcon name="sparkling-line" size={16} />{t('Manage providers')}</button></div><div><h2>{t('Privacy & permissions')}</h2><ul>{['The local Agent receives access to workspace tools. Keep your existing MCP servers and connect the correct installation.', 'Provider credentials are stored outside projects and injected by the local service. Never paste API keys into a conversation.', 'Cloud generation sends the required prompt and reference material to the selected provider. Projects and local exports remain in your workspace.'].map(text => <li key={text}>{t(text)}</li>)}</ul></div></section>
      <section className="om-mcp-section om-mcp-faq"><h2>{t('Frequently asked questions')}</h2><div>{mcpFaq.map(([question, answer]) => <details key={question}><summary>{t(question)}<RemixIcon name="arrow-down-s-line" size={18} /></summary><p className="om-muted">{t(answer)}</p></details>)}<a className="om-text-link" href={`${GITHUB_REPOSITORY}/issues/new/choose`} target="_blank" rel="noreferrer">{t('Feedback')}<RemixIcon name="external-link-line" size={14} /></a></div></section>
      <footer className="om-mcp-footer"><BrandLogo /><h2>{t('Your next film starts with a conversation.')}</h2><div className="om-mcp-actions"><button className="om-button" onClick={event => openLibrary(event.currentTarget)}>{t('Explore templates')}</button><a className="om-button" href={`${GITHUB_REPOSITORY}/tree/main/docs`} target="_blank" rel="noreferrer">{t('Documentation')}</a></div></footer>
    </div><StudioToastViewport {...toast} />
  </main>;
}

function McpTemplatePoster({ template }: { template: GalleryTemplate }) {
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false);
  return <div className="om-mcp-template-poster">{template.posterUrl && !failed ? <>{!loaded && <Skeleton />}<img src={template.posterUrl} alt={template.title} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /></> : <div className="om-mcp-poster-fallback"><RemixIcon name="clapperboard-line" size={32} /><span>{template.title}</span></div>}</div>;
}

function ClientAvatar({ client }: { client: typeof clients[number] }) {
  return client.id === 'mcp'
    ? <span className="om-avatar" aria-hidden="true"><RemixIcon name="plug-line" size={24} /></span>
    : <ProviderAvatar name={client.name} provider={{ id: client.brand, custom: false }} />;
}
