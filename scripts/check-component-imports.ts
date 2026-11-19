import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { posix, sep } from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const designSystem = 'packages/design-system/';
const components = designSystem + 'components/';
const site = components + 'site/';
const studio = 'studio/src/';
const alias = '@openmotion/ui/';
const dependencies = /^(?:react|react-dom|@base-ui\/react|cn)(?:\/|$)/;
const legacyEntries = new Set([studio + 'components/ui/Button', studio + 'components/ui/Slider']);

export function componentImportViolation(file: string, specifier: string) {
  const relative = specifier.startsWith('.');
  const target = relative
    ? posix.normalize(posix.join(posix.dirname(file), specifier.split(/[?#]/)[0])).replace(/\.[cm]?tsx?$/, '')
    : specifier;

  if (file.startsWith(components)) {
    const preview = file.startsWith(site);
    if (relative) {
      if (target.startsWith(components) && (preview || !target.startsWith(site))) return;
      if (preview && (target.startsWith(designSystem + 'react/') || target === designSystem + 'studio.css')) return;
    } else if (dependencies.test(target) || preview && target.startsWith(alias)) {
      return;
    }
    return 'Component code must depend on library source and shared UI dependencies';
  }

  if (legacyEntries.has(target) || target.startsWith(components) && target !== components + 'cn') {
    return 'Import shared controls through @openmotion/ui';
  }
}

export async function checkComponentImports() {
  const violations: string[] = [];
  for (const directory of [components, studio]) {
    const files = (await readdir(new URL(directory, root), { recursive: true }))
      .map(name => directory + name.split(sep).join('/'))
      .filter(name => /\.[cm]?tsx?$/.test(name) && name !== components + 'vite.config.ts' && !name.startsWith(components + 'dist/'));
    await Promise.all(files.map(async file => {
      const source = await readFile(new URL(file, root), 'utf8');
      for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
        const violation = componentImportViolation(file, specifier);
        if (violation) violations.push(`${file}: ${specifier}. ${violation}.`);
      }
    }));
  }
  assert.deepEqual(violations.sort(), [], 'Component import boundaries');
}
