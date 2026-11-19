import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { posix, sep } from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const designSystem = 'packages/design-system/';
const components = designSystem + 'components/';
const site = components + 'site/';
const studio = 'studio/src/';
const alias = 'open-design-ui/';
const dependencies = /^(?:react|react-dom|@base-ui\/react|cn)(?:\/|$)/;
const previewDependencies = new Set(['@lezer/highlight', '@lezer/javascript']);
const legacyEntries = new Set([studio + 'components/ui/Button', studio + 'components/ui/Slider']);
const nativeControls = { button: '<button>', slider: '<input type="range">' } as const;
type NativeControl = keyof typeof nativeControls;
type NativeControlCounts = Partial<Record<NativeControl, number>>;

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
    } else if (dependencies.test(target) || preview && (target.startsWith(alias) || previewDependencies.has(target))) {
      return;
    }
    return 'Component code must depend on library source and shared UI dependencies';
  }

  if (legacyEntries.has(target) || target.startsWith(components) && target !== components + 'cn') {
    return 'Import shared controls through open-design-ui';
  }
}

export function nativeControlLines(file: string, source: string) {
  const lines: Record<NativeControl, number[]> = { button: [], slider: [] };
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(parsed);
      const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
      if (tag === 'button') lines.button.push(line);
      if (tag === 'input') {
        const type = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(parsed) === 'type');
        const value = type && ts.isJsxAttribute(type) ? type.initializer : undefined;
        const literal = value && ts.isJsxExpression(value) ? value.expression : value;
        if (literal && ts.isStringLiteralLike(literal) && literal.text.toLowerCase() === 'range') lines.slider.push(line);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return lines;
}

export function nativeControlViolations(file: string, source: string, baseline: NativeControlCounts) {
  const lines = nativeControlLines(file, source);
  // shortcut: legacy counts are tracked per file, track individual sites if same-count substitutions need enforcement.
  return (Object.keys(nativeControls) as NativeControl[]).flatMap(control => {
    const allowed = baseline[control] ?? 0;
    const actual = lines[control];
    if (actual.length > allowed) {
      return [`${file}:${actual.join(',')}: ${actual.length} native ${nativeControls[control]} elements (baseline ${allowed}). Use open-design-ui/${control}.`];
    }
    if (actual.length < allowed) {
      return [`${file}: reduce the ${control} count in studio-native-controls.json to ${actual.length}.`];
    }
    return [];
  });
}

export async function checkComponentUsage() {
  const violations: string[] = [];
  const nativeViolations: string[] = [];
  const baseline: Record<string, NativeControlCounts> = JSON.parse(
    await readFile(new URL('studio-native-controls.json', import.meta.url), 'utf8'),
  );
  const remainingBaseline = new Set(Object.keys(baseline));
  for (const directory of [components, studio]) {
    const files = (await readdir(new URL(directory, root), { recursive: true }))
      .map(name => directory + name.split(sep).join('/'))
      .filter(name => /\.(?:[cm]?tsx?|jsx)$/.test(name) && name !== components + 'vite.config.ts' && !name.startsWith(components + 'dist/'));
    await Promise.all(files.map(async file => {
      const source = await readFile(new URL(file, root), 'utf8');
      for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
        const violation = componentImportViolation(file, specifier);
        if (violation) violations.push(`${file}: ${specifier}. ${violation}.`);
      }
      if (directory === studio && /\.[jt]sx$/.test(file) && !/\/(?:__tests__|tests)\/|\.(?:test|spec)\./.test(file)) {
        const relative = file.slice(studio.length);
        remainingBaseline.delete(relative);
        nativeViolations.push(...nativeControlViolations(file, source, baseline[relative] ?? {}));
      }
    }));
  }
  assert.deepEqual(violations.sort(), [], 'Component import boundaries');
  for (const file of remainingBaseline) nativeViolations.push(`${studio}${file}: remove the entry from studio-native-controls.json.`);
  assert.deepEqual(nativeViolations.sort(), [], 'Studio native control boundaries');
}
