import { studioApiFetch } from "../../utils/studioApiFetch";
import type { ImportedFontAsset } from "./fontAssets";

// The prepare endpoint returns normalized font bytes (TTC is extracted to TTF).
// Never derive a saved extension from an arbitrary Content-Type header: the
// browser and the project exporter must agree on the exact portable format.
const FONT_TYPES: Record<string, string> = {
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
};

export async function prepareFontImport(file: File) {
  const response = await studioApiFetch("/api/fonts/prepare", { method: "POST", body: file });
  if (!response.ok) throw new Error("Unsupported or invalid font file");
  const metadata = JSON.parse(decodeURIComponent(response.headers.get("X-Font-Metadata") ?? "")) as Pick<ImportedFontAsset, "family" | "weight" | "style">;
  if (!metadata.family || typeof metadata.family !== "string") throw new Error("Font has no family");
  const type = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  const extension = type && FONT_TYPES[type];
  if (!extension) throw new Error("Unsupported prepared font format");
  const bytes = await response.arrayBuffer();
  await new FontFace("Motion font validation", bytes).load();
  const name = file.name.replace(/\.[^.]+$/, "") + "." + extension;
  return { file: new File([bytes], name, { type }), metadata };
}
