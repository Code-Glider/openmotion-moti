import { useEffect, useState } from 'react';
import type { GalleryTemplate, TemplatePage } from '../../../shared/catalog';
import { motionApi } from './useWorkspace';

export async function loadCoveredTemplates(locale: string, signal: AbortSignal) {
  const items = new Map<string, GalleryTemplate>();
  let offset = 0;
  while (true) {
    const page = await motionApi<TemplatePage>(`/template-catalog?category=all&covered=true&limit=60&offset=${offset}&locale=${encodeURIComponent(locale)}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    });
    signal.throwIfAborted();
    if (!Array.isArray(page.items)) throw new Error('Invalid catalogue');
    for (const item of page.items) items.set(item.id, item);
    if (page.next == null) return { items: [...items.values()], catalogVersion: page.catalogVersion, warning: page.warning };
    if (!Number.isSafeInteger(page.next) || page.next <= offset) throw new Error('Invalid catalogue cursor');
    offset = page.next;
  }
}

export function useCoveredTemplates(locale: string, enabled = true) {
  const [loaded, setLoaded] = useState<{ locale: string; items: GalleryTemplate[] } | null>(null);
  const catalog = loaded?.locale === locale ? loaded.items : null;
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || catalog) return;
    const controller = new AbortController();
    setFailed(false);
    void loadCoveredTemplates(locale, controller.signal).then(result => {
      if (!controller.signal.aborted) setLoaded({ locale, items: result.items });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [locale, enabled, attempt, catalog]);
  return { catalog, failed, retry: () => setAttempt(value => value + 1) };
}
