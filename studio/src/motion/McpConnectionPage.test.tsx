// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { McpConnectionPage } from './McpConnectionPage';

vi.mock('./useWorkspace', () => ({ motionApi: async (path: string, options: RequestInit) => {
  const response = await fetch('/motion-api' + path, options);
  if (!response.ok) throw new Error('Unavailable');
  return response.json();
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const info = { name: 'OpenMotion', version: '1.2.3', previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/fixture/data', templateSource: 'repository',
  transport: { type: 'stdio', command: 'node', args: ['/fixture/mcp.ts'], cwd: '/fixture', env: { MOTION_DATA_DIR: '/fixture/data' } }, tools: [{ name: 'openmotion_media_use', description: 'Media Use' }] };
const template = { id: 'fixture-film', title: 'Fixture film', description: 'Editable typography', subtitle: 'Launch', posterUrl: '/poster.png' };
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name)!;
const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(node => node.textContent === name)!;
async function mount() {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const openLibrary = vi.fn(), openProviders = vi.fn();
  await act(async () => root!.render(<I18nProvider initialLocale="en"><McpConnectionPage openLibrary={openLibrary} openProviders={openProviders} /></I18nProvider>));
  return { openLibrary, openProviders };
}

it('switches client-specific setup, copies exact template instructions and performs no mutations', async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [template] } : info));
  vi.stubGlobal('fetch', fetcher);
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const { openLibrary, openProviders } = await mount();
  expect(document.querySelector('h1')?.textContent).toContain('Codex');
  await act(async () => tab('Claude Code').click());
  expect(document.querySelector('h1')?.textContent).toContain('Claude Code');
  await act(async () => tab('Manual setup').click());
  expect(document.querySelector('pre')?.textContent).toContain('claude mcp add');
  expect(document.querySelector('a[download]')?.getAttribute('href')).toBe('/connect/config?host=claude');
  await act(async () => button('Copy template prompt').click());
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('fixture-film'));
  expect(copy.mock.calls[0][0]).toContain('host=claude');
  expect(document.querySelector('.motion-feedback-layer [role=status]')?.textContent).toContain('Copied to clipboard');
  expect(document.querySelector('.om-mcp-content [role=status]')).toBeNull();
  await act(async () => button('View all templates').click()); expect(openLibrary).toHaveBeenCalledOnce();
  await act(async () => button('Manage providers').click()); expect(openProviders).toHaveBeenCalledOnce();
  await act(async () => tab('ChatGPT').click());
  expect(document.body.textContent).toContain('Remote connection unavailable');
  expect(button('Copy template prompt').disabled).toBe(true);
  expect(document.querySelector('a[download]')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) expect(init?.method ?? 'GET').toBe('GET');
});

it('contains unavailable setup and catalogue independently, retries and reserves failed poster geometry', async () => {
  let broken = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => broken ? Response.json({}, { status: 503 }) : Response.json(url.includes('template-catalog') ? { items: [template] } : info)));
  await mount();
  expect(document.body.textContent).toContain('Could not load settings');
  expect(document.body.textContent).toContain('Templates could not be loaded');
  expect(document.body.textContent).toContain('What you can ask it to do');
  broken = false;
  for (const retry of [...document.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent === 'Retry')) await act(async () => retry.click());
  expect(button('Copy connection instruction').disabled).toBe(false);
  expect(document.body.textContent).toContain('Fixture film');
  const poster = document.querySelector('.om-mcp-template-poster')!;
  act(() => poster.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(poster.querySelector('img')).toBeNull();
  expect(poster.textContent).toBe('Fixture film');
});

it('aborts pending setup and template reads when leaving the page', async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { signals.push(init.signal!); return new Promise(() => {}); }));
  await mount(); expect(signals).toHaveLength(2);
  act(() => root!.unmount()); root = undefined;
  expect(signals.every(signal => signal.aborted)).toBe(true);
});
