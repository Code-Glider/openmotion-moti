// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetsPage } from './AssetsPage';
import { assetRequest, uploadLibraryAsset } from './assetClient';
import { AssetUploadError } from './assetUploadError';
import type { LibraryAsset } from '../../../shared/asset-library';

vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string, values?: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key) => String(values?.[key] ?? match)), formatDate: () => 'Nov 15' }) }));
vi.mock('./ResizablePane', () => ({ ResizablePane: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./AssetComposer', () => ({ AssetComposer: ({ onReference }: { onReference: () => void }) => <><input aria-label="Creation draft" /><button onClick={onReference}>References</button></> }));
vi.mock('./AssetTaskHistory', () => ({ AssetTaskMenu: () => null }));
vi.mock('./assetClient', () => ({ assetRequest: vi.fn(), uploadLibraryAsset: vi.fn() }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: async () => ({ conversations: [] }) }));

function fixture(id: string): LibraryAsset {
  return { id, name: `Picture ${id}`, modality: 'image', createdAt: 1, updatedAt: 1, currentVersionId: `${id}-v1`, versions: [{ id: `${id}-v1`, createdAt: 1, source: 'upload', filename: `${id}.png`, mimeType: 'image/png', bytes: 1024, sha256: id, references: [] }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root, container: HTMLDivElement, records: Map<string, LibraryAsset>;
let pendingWrite: ReturnType<typeof deferred<void>> | undefined;
let pendingRead: ReturnType<typeof deferred<{ asset: LibraryAsset }>> | undefined;
let pendingList: ReturnType<typeof deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>> | undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); pendingWrite = undefined; pendingRead = undefined; pendingList = undefined;
  records = new Map(['A', 'B'].map(id => [id, fixture(id)]));
  vi.mocked(assetRequest).mockImplementation(async args => {
    if (args.action === 'jobs') return { jobs: [] };
    if (args.action === 'list') {
      if (pendingList) { const current = pendingList; pendingList = undefined; return current.promise; }
      const assets = [...records.values()].filter(asset => Boolean(asset.trashedAt) === Boolean(args.trash) && (!args.modality || asset.modality === args.modality));
      return { assets: structuredClone(assets), total: assets.length, nextOffset: null };
    }
    if (args.action === 'get') {
      if (pendingRead) { const current = pendingRead; pendingRead = undefined; return current.promise; }
      return { asset: structuredClone(records.get(String(args.assetId))!) };
    }
    if (args.action === 'update') {
      if (pendingWrite) { const current = pendingWrite; pendingWrite = undefined; await current.promise; }
      const asset = structuredClone(records.get(String(args.assetId))!);
      const changes = args.changes as { trashed?: boolean };
      if (changes.trashed) asset.trashedAt = 10;
      if (changes.trashed === false) delete asset.trashedAt;
      asset.updatedAt++;
      records.set(asset.id, asset);
      return { asset: structuredClone(asset) };
    }
    throw new Error(`Unexpected action ${args.action}`);
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
async function render(active = true) { await act(async () => root.render(<AssetsPage active={active} />)); await flush(); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text)!;
async function click(text: string) { await act(async () => button(text).click()); await flush(); }
const previewName = () => container.querySelector('.om-asset-workspace-header strong')?.textContent;
const updates = () => vi.mocked(assetRequest).mock.calls.map(([args]) => args).filter(args => args.action === 'update');

async function uploadBatch(count: number) {
  const input = container.querySelector<HTMLInputElement>('input[type=file][multiple]')!;
  const files = Array.from({ length: count }, (_, i) => new File(['data'], `file-${i}.png`));
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await flush();
}
it('summarizes four failures and one success once and displays the successful asset in the library', async () => {
  await render();
  vi.mocked(uploadLibraryAsset).mockRejectedValue(new AssetUploadError('rejected', 'size'))
    .mockImplementationOnce(async () => { const asset = fixture('uploaded'); records.set(asset.id, asset); return asset; });
  await uploadBatch(5);
  const notices = document.querySelectorAll('[role=alert], [role=status]');
  expect(notices).toHaveLength(1);
  expect(notices[0].textContent).toBe('Uploaded 1, not uploaded 4. Known issue: files exceed the size limit. Compress or replace those files.');
  expect(container.querySelector('[aria-label="Picture uploaded"]')).not.toBeNull();
  expect(vi.mocked(uploadLibraryAsset)).toHaveBeenCalledTimes(5);
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(document.querySelector('[role=alert]')).not.toBeNull();
  expect([...notices[0].querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Dismiss error']);
});
it('combines only observed causes and keeps unknown results out of the failure count', async () => {
  await render();
  vi.mocked(uploadLibraryAsset).mockRejectedValueOnce(new AssetUploadError('rejected', 'unreadable'))
    .mockRejectedValueOnce(new AssetUploadError('rejected', 'unsupported'))
    .mockRejectedValueOnce(new AssetUploadError('unknown'));
  await uploadBatch(3);
  const text = document.querySelector('[role=alert]')?.textContent;
  expect(text).toBe('Uploaded 0, not uploaded 2, awaiting confirmation 1. Known issues: unreadable files and unsupported formats. Re-export, convert or replace those files. Check the asset library before uploading unconfirmed files again.');
  expect(text).not.toContain('oversized');
  expect(vi.mocked(uploadLibraryAsset)).toHaveBeenCalledTimes(3);
});
it('refreshes the library after an unconfirmed response without resubmitting or inventing success', async () => {
  await render();
  vi.mocked(uploadLibraryAsset).mockImplementationOnce(async () => { records.set('uncertain', fixture('uncertain')); throw new AssetUploadError('unknown'); });
  await uploadBatch(1);
  expect(document.querySelector('[role=alert]')?.textContent).toBe('Uploaded 0, awaiting confirmation 1. Check the asset library before uploading unconfirmed files again.');
  expect(container.querySelector('[aria-label="Picture uncertain"]')).not.toBeNull();
  expect(vi.mocked(uploadLibraryAsset)).toHaveBeenCalledOnce();
});
it('shows one short success summary and no notice for an empty selection', async () => {
  await render(); vi.mocked(uploadLibraryAsset).mockResolvedValue(fixture('uploaded'));
  await uploadBatch(0); expect(document.querySelector('[role=status]')).toBeNull();
  await uploadBatch(2); expect(document.querySelector('[role=status]')?.textContent).toBe('Uploaded 2.');
  await act(async () => vi.advanceTimersByTimeAsync(3160));
  expect(document.querySelector('[role=status]')).toBeNull();
});
it('reports a definite rejection with no invented cause', async () => {
  await render(); vi.mocked(uploadLibraryAsset).mockRejectedValue(new AssetUploadError('rejected'));
  await uploadBatch(2);
  expect(document.querySelector('[role=alert]')?.textContent).toBe('Uploaded 0, not uploaded 2.');
});

it('opens the compact asset navigation during creation and selects a category without losing the draft', async () => {
  await render(); await click('AI Create');
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Creation draft"]')!;
  draft.value = 'Keep this draft';
  await click('Asset types');
  expect(button('Asset types').getAttribute('aria-expanded')).toBe('true');
  const drawer = document.querySelector('[role="dialog"]')!;
  expect(drawer.textContent).toContain('Trash');
  const audio = [...drawer.querySelectorAll('nav button')].find(node => node.textContent === 'Audio') as HTMLButtonElement;
  await act(async () => audio.click()); await flush();
  expect(button('Asset types').getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('.om-assets-main h2')?.textContent).toBe('Audio');
  expect(container.querySelector('.om-assets-page')?.getAttribute('data-mobile-view')).toBe('library');
  expect(container.querySelector('[aria-label="Creation draft"]')).toBe(draft);
  expect(draft.value).toBe('Keep this draft');
});

it('switches between the narrow gallery and creator without remounting the draft or losing gallery state', async () => {
  await render(); await click('AI Create');
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Creation draft"]')!;
  draft.value = 'Keep this draft';
  const gallery = container.querySelector<HTMLElement>('.om-assets-main')!;
  gallery.scrollTop = 240;
  const listCount = vi.mocked(assetRequest).mock.calls.filter(([args]) => args.action === 'list').length;
  const switcher = container.querySelector('.om-assets-view-switch')!;
  await act(async () => switcher.querySelectorAll('button')[0].click());
  expect(container.querySelector('.om-assets-page')?.getAttribute('data-mobile-view')).toBe('library');
  await act(async () => switcher.querySelectorAll('button')[1].click());
  expect(container.querySelector('.om-assets-page')?.getAttribute('data-mobile-view')).toBe('create');
  expect(container.querySelector('[aria-label="Creation draft"]')).toBe(draft);
  expect(draft.value).toBe('Keep this draft');
  expect(gallery.scrollTop).toBe(240);
  expect(vi.mocked(assetRequest).mock.calls.filter(([args]) => args.action === 'list')).toHaveLength(listCount);
});

it('removes only the selected asset, exits its preview and restores the exact asset with Undo', async () => {
  await render(); await click('Picture A'); await click('Move to trash');
  expect(previewName()).toBeUndefined();
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).not.toBeNull();
  expect(container.textContent).toContain('1 assets');
  expect(document.querySelector('[role=status]')?.textContent).toContain('Asset removed');
  expect(updates()).toEqual([{ action: 'update', assetId: 'A', changes: { trashed: true } }]);
  await click('Picture B'); await click('Undo');
  expect(previewName()).toBe('Picture B');
  expect(records.get('A')?.trashedAt).toBeUndefined();
  expect(records.get('B')?.trashedAt).toBeUndefined();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.textContent).toContain('2 assets');
  expect(updates()[1]).toEqual({ action: 'update', assetId: 'A', changes: { trashed: false } });
});

it('does not change a later selection when a pending trash write finishes and blocks duplicate writes', async () => {
  await render(); await click('Picture A');
  const write = deferred<void>(); pendingWrite = write;
  await click('Move to trash'); await click('Move to trash');
  expect(updates()).toHaveLength(1);
  await click('Picture B');
  expect(button('Move to trash').disabled).toBe(false);
  await act(async () => write.resolve()); await flush();
  expect(previewName()).toBe('Picture B');
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(records.get('B')?.trashedAt).toBeUndefined();
});

it('keeps the selected asset on failure and allows a failed Undo to be retried once', async () => {
  await render(); await click('Picture A');
  const failure = deferred<void>(); pendingWrite = failure;
  await click('Move to trash');
  await act(async () => failure.reject(new Error('Failed to fetch'))); await flush();
  expect(previewName()).toBe('Picture A'); expect(records.get('A')?.trashedAt).toBeUndefined();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Connection lost');
  await click('Move to trash');
  const restore = deferred<void>(); pendingWrite = restore;
  await click('Undo'); await click('Undo');
  expect(updates()).toHaveLength(3);
  await act(async () => restore.reject(new Error('Failed to fetch'))); await flush();
  expect(records.get('A')?.trashedAt).toBeDefined(); expect(button('Undo').disabled).toBe(false);
  await click('Undo'); expect(updates()).toHaveLength(4); expect(records.get('A')?.trashedAt).toBeUndefined();
});

it('ignores stale detail and filmstrip reads after a successful trash operation', async () => {
  await render(); await click('Picture A'); await render(false);
  const read = deferred<{ asset: LibraryAsset }>(); pendingRead = read;
  const list = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = list;
  await render(); await click('Move to trash');
  await act(async () => { read.resolve({ asset: fixture('A') }); list.resolve({ assets: [fixture('A'), fixture('B')], total: 2, nextOffset: null }); }); await flush();
  expect(previewName()).toBeUndefined();
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).not.toBeNull();
  expect(container.textContent).toContain('1 assets');
});

it('reuses the loaded collection when entering and leaving preview, preserving filters and scroll', async () => {
  await render();
  const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Picture'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); }); await flush();
  const lists = () => vi.mocked(assetRequest).mock.calls.filter(([args]) => args.action === 'list');
  const before = lists().length;
  container.querySelector<HTMLElement>('.om-assets-main')!.scrollTop = 240;
  await click('Picture A');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('Picture');
  await click('Picture B'); await click('All assets');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('Picture');
  expect(container.querySelector<HTMLElement>('.om-assets-main')?.scrollTop).toBe(240);
  expect(lists()).toHaveLength(before);
});

it('keeps the settled gallery visible while switching asset tabs', async () => {
  await render();
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  const list = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = list;
  await click('Images');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(true);
  await act(async () => list.resolve({ assets: [fixture('A')], total: 1, nextOffset: null })); await flush();
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(false);
});

it('shows skeletons on the first load but retains the empty state on later tab loads', async () => {
  const initial = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = initial;
  await render();
  expect(container.querySelectorAll('.om-asset-loading-card')).toHaveLength(6);
  expect(container.querySelector('.om-asset-welcome')).toBeNull();
  await act(async () => initial.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  const next = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = next;
  await click('Videos');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('.om-asset-welcome')).not.toBeNull();
  await act(async () => next.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
});

it('ignores an older tab response after a newer tab finishes loading', async () => {
  await render();
  const older = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = older;
  await click('Images');
  const newer = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = newer;
  await click('Videos');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  await act(async () => newer.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  await act(async () => older.resolve({ assets: [fixture('A')], total: 1, nextOffset: null })); await flush();
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(container.querySelector('.om-asset-welcome')).not.toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
});

it('replaces retained results with a usable retry on failure and recovers', async () => {
  await render();
  const failure = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = failure;
  await click('Videos');
  await act(async () => failure.reject(new Error('offline'))); await flush();
  expect(container.textContent).toContain('Could not load assets');
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(false);
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
  const retry = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = retry;
  await click('Retry');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('true');
  await act(async () => retry.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  expect(container.textContent).not.toContain('Could not load assets');
  expect(container.querySelector('.om-asset-welcome')).not.toBeNull();
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(false);
});

it('restores from Trash without switching the filmstrip into the active library', async () => {
  records.get('A')!.trashedAt = 10;
  await render(); await click('Trash'); await click('Picture A'); await click('Restore asset');
  expect(previewName()).toBeUndefined();
  expect(container.textContent).toContain('Trash is empty');
  expect(document.querySelector('[role=status]')?.textContent).toContain('Asset restored');
  await click('All assets');
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).not.toBeNull();
});

it('keeps Undo accessible inside the reference modal and refreshes both asset browsers', async () => {
  await render(); await click('Picture A'); await click('Move to trash');
  await click('AI Create'); await click('References');
  expect(document.querySelector('[data-feedback-layer]')?.closest('[role=dialog]')).not.toBeNull();
  await click('Undo');
  expect(document.querySelector('[role=dialog] [aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('.om-assets-page')?.getAttribute('data-creating')).toBe('true');
});
