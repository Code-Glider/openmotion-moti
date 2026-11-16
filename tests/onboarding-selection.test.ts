import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { renderInlineOnboarding } from '../scripts/inline-onboarding.mjs';
import { loadTemplatePresentation, showTemplateRecommendations } from '../shared/mcp-template-recommendations.ts';
import { readRecommendation, recreationPrompt } from '../mcp-ui/template-recommendations/app.ts';
import type { TemplateCardsBootstrap } from '../mcp-ui/template-recommendations/types.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
// Acceptance values deliberately do not import the implementation's selection.
const selected = [
  'motion-664184d9-593e-4984-b473-701248b69cfe',
  'motion-b31d078a-4e5e-461e-8b43-3101ee0a2f93',
  'motion-1e48dea5-903d-48f6-b10e-99a70f1c183d',
];
const titles = ['Bolt Skills｜团队能力展示', 'A New Era of No-Code', 'Magic Share'];

test('first-run recommends the three selected catalog references in the requested order', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-selected-onboarding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await renderInlineOnboarding({ appRoot, output: path.join(directory, 'cards.html'), language: 'zh' });
  assert.deepEqual(result.templateIds, selected);
});

test('reference recommendations keep exact catalog identities without builtin creation arguments', () => {
  const presentation = loadTemplatePresentation();
  const result = showTemplateRecommendations(presentation, { templateIds: selected, onboarding: true, language: 'zh' });
  assert.deepEqual(result.cards.map(card => card.title), titles);
  for (const card of result.cards) {
    assert.equal(card.templateKind, 'reference');
    assert.equal(card.createArgs, undefined);
    const record = JSON.parse(requireRecord(card.templateId));
    assert.equal(card.durationSeconds, Number(record.entry.original.durationSeconds));
  }
  assert.match(result.selectionGuide, /openmotion_get_template/);
  assert.match(result.selectionGuide, /openmotion-recreate/);
  const bootstrap = JSON.parse(presentation.content.text.match(/window\.__OPENMOTION_TEMPLATE_CARDS__=(.*?);<\/script>/s)![1]) as TemplateCardsBootstrap;
  assert(readRecommendation(result, bootstrap));
  for (const language of ['zh', 'en', 'ja', 'ko', 'fr', 'es', 'pt'] as const) {
    const prompt = recreationPrompt(result.cards[0], language);
    assert(prompt.includes(selected[0]));
    assert.match(prompt, /openmotion_get_template/);
    assert.match(prompt, /openmotion-recreate/);
  }
  const injected = structuredClone(result);
  Object.assign(injected.cards[0], { createArgs: { projectType: 'template', templateId: selected[0] } });
  assert.equal(readRecommendation(injected, bootstrap), null, 'References must never acquire builtin-copy arguments');
});

function requireRecord(id: string) {
  return readFileSync(path.join(appRoot, 'library/templates/catalog', id, 'template.json'), 'utf8');
}

test('reference presentation rejects a substituted media URL or missing source identity', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-reference-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(path.join(appRoot, 'mcp-ui/template-recommendations'), directory, { recursive: true });
  const file = path.join(directory, 'manifest.json');
  const original = await readFile(file, 'utf8');
  for (const mutate of [
    (item: any) => { item.videoUrl = 'https://r.open-design.ai/files/' + 'a'.repeat(64); },
    (item: any) => { item.posterUrl = 'https://example.com/poster.jpg'; },
    (item: any) => { item.sourceFiles.pop(); },
    (item: any) => { item.durationSeconds = 1; },
  ]) {
    const manifest = JSON.parse(original);
    mutate(manifest.templates.find((item: any) => item.id === selected[0]));
    await writeFile(file, JSON.stringify(manifest));
    assert.throws(() => loadTemplatePresentation({ directory }), /TEMPLATE_PRESENTATION_INVALID/);
  }
});
