// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { studioEvents } from '../../../tracking/events.ts';
import { validProperties } from '../../../tracking/core.ts';
import { BlackFridayTopBanner, resetBlackFridayImpression } from './BlackFridayTopBanner';
import { campaignPricingUrl } from './campaignAttribution';
import { PricingEntry } from './PricingEntry';
import { trackMotion } from './tracking';

vi.mock('./tracking', () => ({ trackMotion: vi.fn(async () => 'queued') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tracked = () => vi.mocked(trackMotion).mock.calls.map(([event, properties]) => ({ event, properties: properties as Record<string, unknown> }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.mocked(trackMotion).mockClear();
  resetBlackFridayImpression();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (node: React.ReactNode) => act(() => root.render(<I18nProvider initialLocale="zh-CN">{node}</I18nProvider>));
const params = (href: string) => new URL(href).searchParams;

it('builds a Pricing link that carries the OpenMotion entry the website keeps through checkout', () => {
  const url = new URL(campaignPricingUrl('zh-CN', 'openmotion_bf_banner', '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11', new Date('2026-11-21T00:00:00Z')));
  expect(url.origin + url.pathname).toBe('https://open-design.ai/zh/pricing/');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    od_origin: 'openmotion', od_entry_source: 'openmotion_bf_banner', od_entry_id: '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11', od_entry_at: '2026-11-21T00:00:00.000Z',
    utm_source: 'openmotion', utm_medium: 'banner', utm_campaign: 'black_friday_2026',
  });
  expect(new URL(campaignPricingUrl('en', 'openmotion_header_pricing', 'x')).pathname).toBe('/pricing/');
  expect(params(campaignPricingUrl('en', 'openmotion_header_pricing', 'x')).get('utm_medium')).toBe('header');
});

it('reports one banner impression per page load and joins each claim click to its Pricing link', async () => {
  const onClose = vi.fn();
  render(<BlackFridayTopBanner trackingPage="explore" onClose={onClose} />);
  render(<BlackFridayTopBanner trackingPage="explore" onClose={onClose} />);
  expect(tracked().filter(row => row.event === 'surface_view')).toEqual([
    { event: 'surface_view', properties: { page_name: 'explore', area: 'campaign_banner', element: 'banner', campaign_id: 'black_friday_2026' } },
  ]);

  const cta = container.querySelector<HTMLAnchorElement>('a[href*="pricing"]')!;
  cta.addEventListener('click', event => event.preventDefault());
  const firstEntry = params(cta.href).get('od_entry_id');
  expect(params(cta.href).get('od_entry_source')).toBe('openmotion_bf_banner');
  await act(async () => { cta.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  const click = tracked().find(row => row.event === 'ui_click')!.properties;
  expect(click).toMatchObject({ page_name: 'explore', area: 'campaign_banner', element: 'claim_offer', campaign_id: 'black_friday_2026', entry_id: firstEntry });
  expect(params(cta.href).get('od_entry_id')).not.toBe(firstEntry);

  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="关闭活动 Banner"]')!.click());
  expect(tracked().at(-1)).toMatchObject({ event: 'ui_click', properties: { area: 'campaign_banner', element: 'close_banner' } });
  expect(onClose).toHaveBeenCalledOnce();
});

it('reports the header Pricing click with the entry id on its link', async () => {
  render(<PricingEntry trackingPage="studio" />);
  const link = container.querySelector<HTMLAnchorElement>('a')!;
  link.addEventListener('click', event => event.preventDefault());
  const entry = params(link.href).get('od_entry_id');
  expect(params(link.href).get('od_entry_source')).toBe('openmotion_header_pricing');
  await act(async () => { link.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(tracked()).toEqual([{ event: 'ui_click', properties: expect.objectContaining({ page_name: 'studio', area: 'header', element: 'open_pricing', campaign_id: 'black_friday_2026', entry_id: entry }) }]);
});

it('registers every reported campaign event in the closed schema', () => {
  const id = '7d1c6f4e-6a1f-4c55-9a43-0c7a4a0a8f11';
  for (const [event, properties] of [
    ['surface_view', { page_name: 'explore', area: 'campaign_banner', element: 'banner', campaign_id: 'black_friday_2026' }],
    ['ui_click', { page_name: 'explore', area: 'campaign_banner', element: 'claim_offer', campaign_id: 'black_friday_2026', entry_id: id, interaction_method: 'pointer' }],
    ['ui_click', { page_name: 'studio', area: 'campaign_banner', element: 'close_banner', campaign_id: 'black_friday_2026', interaction_method: 'keyboard' }],
    ['ui_click', { page_name: 'studio', area: 'header', element: 'open_pricing', campaign_id: 'black_friday_2026', entry_id: id, interaction_method: 'pointer' }],
  ] as const) expect(validProperties(studioEvents, event, properties)).toBe(true);
  expect(validProperties(studioEvents, 'ui_click', { page_name: 'studio', area: 'header', element: 'open_pricing', campaign_id: 'cyber_monday' })).toBe(false);
});
