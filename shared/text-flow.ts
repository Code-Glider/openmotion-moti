/**
 * Text-flow metadata shared by native authored video and Studio.
 * This module never reorders, normalizes, or inserts controls into Unicode text.
 * HTML/CSS and Chromium own Unicode bidi resolution and OpenType shaping.
 */
export type TextDirection = 'auto' | 'ltr' | 'rtl';
export type TextAlignment = 'start' | 'end' | 'left' | 'right' | 'center' | 'justify';
export interface TextFlow {
  language?: string;
  direction?: TextDirection;
}

const RTL_SCRIPT_SUBTAGS = new Set(['Arab', 'Hebr', 'Syrc', 'Thaa', 'Nkoo', 'Adlm', 'Rohg', 'Mand', 'Samr']);
const LTR_SCRIPT_SUBTAGS = new Set(['Latn', 'Ethi', 'Cyrl', 'Grek', 'Deva', 'Guru', 'Hans', 'Hant']);
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'syr', 'syc', 'arc']);
const LTR_LANGUAGES = new Set(['en', 'fr', 'de', 'es', 'pt', 'it', 'ja', 'ko', 'zh', 'am', 'ti', 'ru']);

export function isTextDirection(value: unknown): value is TextDirection {
  return value === 'ltr' || value === 'rtl' || value === 'auto';
}

/** Reject malformed BCP-47 tags before embedding them in a native HTML attribute. */
export function canonicalTextLanguage(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 2 || value.length > 63 || !/^[a-zA-Z0-9-]+$/.test(value)) {
    throw new Error('INVALID_TEXT_LANGUAGE');
  }
  try {
    const canonical = Intl.getCanonicalLocales(value);
    if (canonical.length === 1 && canonical[0].length <= 63) return canonical[0];
  } catch { /* Reject malformed, dangling or duplicate subtags. */ }
  throw new Error('INVALID_TEXT_LANGUAGE');
}

/**
 * Use language or an explicit Unicode Script subtag only when it is known.
 * Unknown and ambiguous languages (e.g. Kurdish without script) stay unset.
 * An explicit script subtag overrides language-derived direction.
 */
export function directionFromLanguage(language: string | undefined): 'rtl' | 'ltr' | undefined {
  if (language === undefined) return undefined;
  const parts = canonicalTextLanguage(language)!.split('-');
  const script = parts.find(part => /^[A-Z][a-z]{3}$/.test(part));
  if (script && RTL_SCRIPT_SUBTAGS.has(script)) return 'rtl';
  if (script && LTR_SCRIPT_SUBTAGS.has(script)) return 'ltr';
  if (script) return undefined;
  const primary = parts[0].toLowerCase();
  if (RTL_LANGUAGES.has(primary)) return 'rtl';
  if (LTR_LANGUAGES.has(primary)) return 'ltr';
  return undefined;
}

/** Authored direction wins, including 'auto'. The legacy default stays unset. */
export function resolveTextDirection(flow: TextFlow): TextDirection | undefined {
  if (flow.direction !== undefined) {
    if (!isTextDirection(flow.direction)) throw new Error('INVALID_TEXT_DIRECTION');
    return flow.direction;
  }
  return directionFromLanguage(flow.language);
}

/** HTML-attribute serialization, with a tightly constrained and canonicalized language. */
export function textFlowAttributes(flow: TextFlow): string {
  const language = canonicalTextLanguage(flow.language);
  const direction = resolveTextDirection({ ...flow, language });
  return `${language === undefined ? '' : ` lang="${language}"`}${direction === undefined ? '' : ` dir="${direction}"`}`;
}

/** Preserve authored logical alignment; map it only to highlight physical UI controls. */
export function physicalTextAlignment(align: string, direction: 'ltr' | 'rtl'): string {
  if (align === 'start') return direction === 'rtl' ? 'right' : 'left';
  if (align === 'end') return direction === 'rtl' ? 'left' : 'right';
  return align;
}
