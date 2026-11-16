// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerationLimitSettings } from './GenerationLimitSettings';
import { I18nProvider, languages, translate } from '../i18n/I18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
async function mount(showToast = vi.fn()) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<I18nProvider initialLocale="en"><GenerationLimitSettings showToast={showToast} /></I18nProvider>));
  return showToast;
}
async function change(value: string) {
  await act(async () => {
    const input = document.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function save() { await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

it('loads the workspace policy and saves zero through the settings API with floating feedback', async () => {
  const fetcher = vi.fn(async (_url: any, init: any) => Response.json({ limit: init.method === 'PUT' ? JSON.parse(init.body).limit : 30, used: 7, windowHours: 24 }));
  vi.stubGlobal('fetch', fetcher); const toast = await mount();
  expect(document.body.textContent).toContain('7 submissions in the last 24 hours');
  const input = document.querySelector('input')!;
  expect(input.value).toBe('30'); expect(input.min).toBe('0'); expect(input.max).toBe('500');
  await change('0'); await save();
  expect(fetcher).toHaveBeenLastCalledWith('/motion-api/settings/generation-limit', expect.objectContaining({ method: 'PUT', body: '{"limit":0}' }));
  expect(toast).toHaveBeenCalledWith('Generation limit saved', 'info');
  expect(document.body.textContent).not.toContain('Generation limit saved');
});

it('keeps repair available after unreadable settings and rejects invalid edits without a request', async () => {
  const fetcher = vi.fn(async (_url: any, init: any) => init.method === 'PUT' ? Response.json({ limit: 2, used: 0, windowHours: 24 }) : Response.json({ error: 'Unreadable settings' }, { status: 400 }));
  vi.stubGlobal('fetch', fetcher); await mount();
  expect(document.body.textContent).toContain('Save a limit to repair the setting');
  await change('501'); await save(); expect(fetcher).toHaveBeenCalledTimes(1);
  await change('2'); await save(); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(document.querySelector('input')!.value).toBe('2');
  expect(document.body.textContent).not.toContain('Could not load generation limit');
});

it('translates the submission limit controls in every supported non-English interface', () => {
  for (const { locale } of languages.filter(item => item.locale !== 'en')) {
    for (const message of ['Generation limit', 'New submissions per 24 hours', 'Failed and cancelled jobs count across this workspace.',
      '0 disables the limit; maximum 500. This is not a spending limit.', 'Generation limit saved', 'Save limit', 'Could not load generation limit. Save a limit to repair the setting.']) {
      expect(translate(locale, message), `${locale}: ${message}`).not.toBe(message);
    }
    expect(translate(locale, '{used} submissions in the last 24 hours', { used: 7 })).toContain('7');
  }
});
