export interface ImportedFontAsset {
  family: string;
  path: string;
  url: string;
  weight?: string;
  style?: "normal" | "italic";
}

export type FontImportInput = FileList | File[] | string;

const FONT_EXT_RE = /\.(eot|otf|ttc|ttf|woff2?)$/i;
const FONT_STYLE_SUFFIX_RE =
  /\s+(thin|extralight|extra light|light|regular|roman|medium|semibold|semi bold|bold|extrabold|extra bold|black|italic|oblique|variable)$/i;

function cssString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\3c ");
}

export function fontFamilyFromAssetPath(path: string): string {
  let basename = path.split(/[\\/]/).pop() ?? path;
  try { basename = decodeURIComponent(basename); }
  catch { /* Local filenames may contain literal percent signs rather than URL escapes. */ }
  const fileName = basename.replace(FONT_EXT_RE, "");
  let family = fileName
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  while (FONT_STYLE_SUFFIX_RE.test(family)) {
    family = family.replace(FONT_STYLE_SUFFIX_RE, "").trim();
  }

  return family || fileName;
}

export function importedFontFaceCss(asset: ImportedFontAsset, url: string = asset.url): string {
  const weight =
    asset.weight && /^(?:[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?$/.test(asset.weight)
      ? ` font-weight: ${asset.weight};`
      : "";
  const style = asset.style
    ? ` font-style: ${asset.style === "italic" ? "italic" : "normal"};`
    : "";
  return `@font-face { font-family: ${cssString(asset.family)}; src: url(${cssString(url)});${weight}${style} font-display: swap; }`;
}


/**
 * Resolve a selected preview's authored family alias to a known project font.
 * Never copy a project stylesheet or fetch a URL from its CSS into Studio.
 * Only a single, exact, same-origin asset from the current project's inventory
 * is eligible. Unsupported or ambiguous rules retain the inspector fallback.
 */
export function resolveInspectorProjectFont(
  preview: Document,
  fontFamily: string,
  assets: readonly ImportedFontAsset[],
  studioBase: string,
): string | null {
  const first = /^\s*(?:"([^"\\]+)"|'([^'\\]+)'|([^,]+))/.exec(fontFamily);
  const family = (first?.[1] ?? first?.[2] ?? first?.[3] ?? "").trim().toLowerCase();
  if (!family || !assets.length) return null;
  let studioOrigin: string;
  try { studioOrigin = new URL(studioBase).origin; }
  catch { return null; }

  const known = new Set<string>();
  for (const asset of assets) {
    try {
      const url = new URL(asset.url, studioBase);
      if (url.origin === studioOrigin && !url.username && !url.password && !url.search && !url.hash &&
          /^\/api\/projects\/[^/]+\/preview\/.+\.(?:ttf|otf|woff2?)$/i.test(url.pathname)) {
        known.add(url.href);
      }
    } catch { /* Invalid inventory entry is not eligible. */ }
  }

  const matches = new Set<string>();
  for (const sheet of Array.from(preview.styleSheets)) {
    if (sheet.disabled) continue;
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; }
    catch { continue; } // Cross-origin stylesheet: never request it from Studio.
    for (const rule of Array.from(rules)) {
      if (rule.type !== 5) continue; // CSSRule.FONT_FACE_RULE across iframe realms.
      const style = (rule as CSSFontFaceRule).style;
      const declared = style.getPropertyValue("font-family").trim().replace(/^(['"])(.*)\1$/, "$2").toLowerCase();
      if (declared !== family) continue;
      const source = style.getPropertyValue("src").trim();
      // Deliberately accept one URL (and an optional format hint) only, not
      // local(), multiple alternatives, escaped CSS, or arbitrary descriptors.
      const match = /^url\(\s*(?:"([^"\\]+)"|'([^'\\]+)'|([^()\s"'\\]+))\s*\)(?:\s+format\(\s*(?:"[^"\\]+"|'[^'\\]+'|[a-z0-9-]+)\s*\))?$/i.exec(source);
      if (!match) continue;
      try {
        const href = new URL(match[1] ?? match[2] ?? match[3], sheet.href ?? preview.baseURI).href;
        if (known.has(href)) matches.add(href);
      } catch { /* Unresolvable project CSS is not eligible. */ }
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}
