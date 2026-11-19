// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkspaceSearch } from './WorkspaceSearch';
import { assetRequest } from './assetClient';

vi.mock('./assetClient', () => ({ assetRequest: vi.fn() }));
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./useMediaCatalog', () => ({ useMediaCatalog: () => ({ catalog: {
  status: { providers: [{ id: 'atlascloud', label: 'Atlas Cloud' }] },
  models: [{ id: 'atlascloud:bytedance/seedance-2.0/text-to-video', modelId: 'bytedance/seedance-2.0/text-to-video',
    label: 'Seedance 2.0', provider: 'atlascloud', modality: 'video', mode: 'text-to-video' }],
}, failed: false }) }));

it('retries a workspace search, pages asset matches and opens the selected version', async () => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onAsset = vi.fn(), noop = vi.fn();
  vi.mocked(assetRequest).mockRejectedValueOnce(new Error('offline')).mockImplementation(async ({ offset }) => ({
    assets: [{ id: 'asset-' + offset, name: 'Orbit ' + offset, modality: 'image', currentVersionId: 'version-' + offset }],
    nextOffset: offset === 0 ? 24 : null,
  }));
  const click = async (button: Element) => act(async () => (button as HTMLButtonElement).click());
  const tick = async () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
  const byText = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!;
  try {
    await act(async () => root.render(<WorkspaceSearch onSkill={noop} destination={null} onAsset={onAsset} onStudio={noop} onScene={noop} onAccount={noop} onLibrary={noop} onCommunity={noop} />));
    await click(container.querySelector('button')!);
    const input = document.querySelector<HTMLInputElement>('.om-workspace-search input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'orbit');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick();
    expect(document.body.textContent).not.toContain('No matches');
    await click(byText('Retry loading assets')); await tick();
    expect(document.body.textContent).toContain('Orbit 0');
    await click(byText('Next')); await tick();
    expect(document.body.textContent).toContain('Orbit 24');
    expect(document.body.textContent).not.toContain('Orbit 0');
    await click(document.querySelector('.om-search-results [aria-label="Workspace assets"] button')!);
    expect(onAsset).toHaveBeenCalledWith('asset-24', 'version-24');
    expect(document.querySelector('.om-workspace-search input')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    container.remove();
  }
});

it('shows the model identity, serving provider and matched text while keeping the whole row actionable', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(assetRequest).mockResolvedValue({ assets: [], nextOffset: null });
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const onScene = vi.fn(), noop = vi.fn();
  try {
    await act(async () => root.render(<WorkspaceSearch onSkill={noop} destination={null} onAsset={noop} onStudio={noop} onScene={onScene} onAccount={noop} onLibrary={noop} onCommunity={noop} />));
    await act(async () => container.querySelector('button')!.click());
    const input = document.querySelector<HTMLInputElement>('.om-workspace-search input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'see 2.0 cloud');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const row = document.querySelector<HTMLButtonElement>('.om-search-results [aria-label="Models"] button')!;
    expect(row.getAttribute('aria-label')).toBe('Seedance 2.0, Atlas Cloud, Video');
    expect(row.querySelector('img')?.getAttribute('src')).toContain('bytedance-color.svg');
    expect([...row.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['See', '2.0', 'Cloud']);
    expect(row.querySelector('.om-badge')?.getAttribute('data-tone')).toBe('video');
    await act(async () => row.click());
    expect(onScene).toHaveBeenCalledWith(expect.objectContaining({ model: 'atlascloud:bytedance/seedance-2.0/text-to-video' }));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
