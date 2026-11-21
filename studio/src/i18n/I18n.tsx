import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLocale, languages, translate, type Locale, type MessageValues } from './messages';
import { pageMetadata } from '../../../packages/design-system/metadata.js';
export { languages, isLocale, translate, sourceMessage } from './messages';
export type { Locale, MessageValues, Translate } from './messages';
export const LOCALE_STORAGE_KEY = 'motion.studio.locale';
export const UI_DIRECTION_STORAGE_KEY = 'motion.studio.navigationDirection';
export type NavigationDirection = 'ltr' | 'rtl';

/** Explicit navigation preference only: never infer it from authored video text. */
export function readNavigationDirection(): NavigationDirection {
  try { return localStorage.getItem(UI_DIRECTION_STORAGE_KEY) === 'rtl' ? 'rtl' : 'ltr'; }
  catch { return 'ltr'; }
}

function browserLocale(): Locale | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const value of preferred) {
    if (!value) continue;
    const normalized = value.replaceAll('_', '-').toLowerCase();
    const exact = languages.find(language => language.locale.toLowerCase() === normalized);
    if (exact) return exact.locale;
    const primary = normalized.split('-')[0];
    const match = languages.find(language => language.locale.toLowerCase().split('-')[0] === primary);
    if (match) return match.locale;
  }
  return undefined;
}

export function readLocale(): Locale {
  try { const saved = localStorage.getItem(LOCALE_STORAGE_KEY); if (isLocale(saved)) return saved; } catch { /* Private browsing can deny storage. */ }
  return browserLocale() ?? 'zh-CN';
}

function languageTools(locale: Locale) {
  return {
    locale,
    t: (message: string, values?: MessageValues) => translate(locale, message, values),
    formatDate: (date: number | Date, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date),
    formatNumber: (number: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(number),
  };
}

// Standalone upstream components keep English unless a product host provides a locale.
const I18nContext = createContext({
  ...languageTools('en'), navigationDirection: 'ltr' as NavigationDirection,
  setLocale: (_locale: Locale) => {}, setNavigationDirection: (_direction: NavigationDirection) => {},
});
export const useI18n = () => useContext(I18nContext);

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, updateLocale] = useState<Locale>(() => initialLocale ?? readLocale());
  const [navigationDirection, updateNavigationDirection] = useState<NavigationDirection>(readNavigationDirection);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    updateLocale(next);
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Switching still works without persistence. */ }
  }, []);
  const setNavigationDirection = useCallback((next: NavigationDirection) => {
    if (next !== 'rtl' && next !== 'ltr') return;
    updateNavigationDirection(next);
    try { localStorage.setItem(UI_DIRECTION_STORAGE_KEY, next); } catch { /* In-memory switch still works. */ }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    const metadata = pageMetadata(locale);
    document.title = metadata.title;
    for (const attribute of ['name', 'property'] as const) {
      for (const [key, value] of Object.entries(metadata[attribute])) {
        let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
        if (!element) {
          element = document.createElement('meta');
          element.setAttribute(attribute, key);
          document.head.append(element);
        }
        element.content = value;
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === LOCALE_STORAGE_KEY || event.key === null) updateLocale(isLocale(event.newValue) ? event.newValue : browserLocale() ?? 'zh-CN');
      if (event.key === UI_DIRECTION_STORAGE_KEY || event.key === null)
        updateNavigationDirection(event.key === null ? readNavigationDirection() : event.newValue === 'rtl' ? 'rtl' : 'ltr');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [locale]);
  // Deliberately never set html.dir: media-time coordinates and preview remain LTR-isolated.
  const value = useMemo(() => ({ ...languageTools(locale), navigationDirection, setLocale, setNavigationDirection }),
    [locale, navigationDirection, setLocale, setNavigationDirection]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
