import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getWorkflow, readWorkflowResource, workflowDocumentAliases, workflowReferences } from '../shared/workflow.ts';

test('legacy director resources return the shared body while references use production identity', async () => {
  for (const [legacy, canonical] of Object.entries(workflowDocumentAliases)) {
    const section = canonical.endsWith('/review.md') ? 'review' : 'decisions';
    const current = await getWorkflow(section, 'production');
    const previous = JSON.parse((await readWorkflowResource(`openmotion://workflow/director/${section}`, '/unused')).text);
    assert.equal(previous.workflow, 'director');
    assert.equal(previous.section, section);
    assert.equal(previous.documentId, canonical);
    assert.equal(previous.content, current.content);
    assert.equal(previous.contentHash, current.contentHash);
    assert.deepEqual(previous.references, current.references);
    const linked = workflowReferences(`[legacy](../openmotion-director/references/${legacy.split('/').at(-1)})`, 'skills/openmotion-recreate/SKILL.md');
    assert.deepEqual(linked, [{ workflow: 'production', section, documentId: canonical }]);
    const forwarding = await readFile(new URL('../' + legacy, import.meta.url), 'utf8');
    assert.deepEqual(workflowReferences(forwarding, legacy), linked);
    assert.ok(!forwarding.includes(current.content), 'Old local paths must not maintain another rule body');
  }
});

test('shared audio execution and review do not require original sound design or contributor evaluation', async () => {
  const sound = await getWorkflow('sound');
  const review = await getWorkflow('review');
  for (const document of [sound, review]) {
    assert.ok(!document.references.some(reference => reference.workflow === 'director'));
    assert.ok(!document.content.includes('## Skill 自身的行为验证'));
  }
  assert.match(sound.content, /锁定画面版本/);
  assert.match(sound.content, /实际使用的音频版本/);
  assert.match(sound.content, /正常速度声画体验/);
});
