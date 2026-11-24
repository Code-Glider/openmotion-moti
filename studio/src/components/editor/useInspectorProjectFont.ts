import { useEffect, useState } from "react";
import { resolveInspectorProjectFont, type ImportedFontAsset } from "./fontAssets";

let nextInspectorFont = 0;

/** A private, temporary face for the selected inspector, never a project mutation. */
export function useInspectorProjectFont(
  preview: Document | undefined,
  fontFamily: string,
  assets: readonly ImportedFontAsset[],
): string | undefined {
  const url = preview && typeof document !== "undefined"
    ? resolveInspectorProjectFont(preview, fontFamily, assets, document.baseURI)
    : null;
  const [loaded, setLoaded] = useState<{ preview: Document; url: string; family: string } | null>(null);

  useEffect(() => {
    if (!preview || !url || typeof FontFace === "undefined" || !document.fonts) return;
    let cancelled = false;
    const family = `OpenMotionInspectorFont-${++nextInspectorFont}`;
    let face: FontFace;
    try {
      face = new FontFace(family, `url(${JSON.stringify(url)})`);
    } catch {
      return;
    }
    void face.load().then(() => {
      if (cancelled) return;
      document.fonts.add(face);
      setLoaded({ preview, url, family });
    }).catch(() => {
      // Keep the native inspector's normal fallback on failed font decoding.
    });
    return () => {
      cancelled = true;
      document.fonts.delete(face);
    };
  }, [preview, url]);

  // Never display a previous selection's face while the new font is loading.
  return loaded && loaded.preview === preview && loaded.url === url
    ? `"${loaded.family}", monospace`
    : undefined;
}
