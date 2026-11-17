import { readFile } from 'node:fs/promises';
import type { WorkspaceStore } from './workspace.ts';
import { fontFaces, loadFontParser, readFontFile } from './shared/studio-fonts.ts';
import { meaningfulAssetName, projectAssetNames, type ProjectAssetName } from './shared/asset-names.ts';

async function optionalJson(store: WorkspaceStore, file: string, fallback: any) {
  try { return JSON.parse(await readFile(await store.safePath(file), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}

/** Shared read model for MCP and Studio. Existing projects need no migration. */
export async function readProjectAssetNames(store: WorkspaceStore, paths?: readonly string[], fonts?: Parameters<typeof projectAssetNames>[3], runtimeRoot?: string) {
  const [meta, records] = await Promise.all([
    optionalJson(store, 'motion-project.json', {}), optionalJson(store, 'motion-assets.json', []),
  ]);
  if (!Array.isArray(records)) throw new Error('INVALID_ASSET_INDEX');
  const assetPaths = paths ?? (await store.files()).map(file => file.path);
  // Studio already inspected fonts for its editor picker. MCP lazily parses only
  // anonymous historical faces absent from the import index, using the same parser.
  if (!fonts && runtimeRoot) {
    const parsed: Array<NonNullable<ProjectAssetName['font']> & { path: string }> = [];
    for (const assetPath of assetPaths) {
      if (!/\.(?:ttf|otf|ttc|woff2?)$/i.test(assetPath) || meaningfulAssetName(assetPath.split('/').at(-1))
        || records.some(record => record.path === assetPath && (record.font?.family || meaningfulAssetName(record.name)))) continue;
      try {
        const face = fontFaces(await readFontFile(await store.safePath(assetPath)), loadFontParser(runtimeRoot))[0];
        if (face) parsed.push({ ...face, path: assetPath });
      } catch { /* Unreadable historical fonts receive the localized type fallback. */ }
    }
    fonts = parsed;
  }
  const language = typeof meta.namingLanguage === 'string' ? meta.namingLanguage : null;
  return { namingLanguage: language, assetNames: projectAssetNames(assetPaths, records as ProjectAssetName[], language ?? 'en', fonts) };
}
