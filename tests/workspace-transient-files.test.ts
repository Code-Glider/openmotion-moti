import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';

// Real @hyperframes editor staging names are not user-authored project files.
// On Windows the staged file may disappear after directory enumeration,
// producing ENOENT while Studio reads source revisions during editing.
test('editor hf-hash temporary files do not enter revisions; other .tmp assets still do', () => fixture(async store => {
  const initial = await store.get();
  assert(initial.project?.files.some(file => file.path === 'index.html'));
  const temporary = path.join(store.projectDirectory, 'index.html.hf322ba5.tmp');
  const userFile = path.join(store.projectDirectory, 'notes.tmp');
  const nearMatch = path.join(store.projectDirectory, 'notes.hf322ba5.tmp.backup');
  try {
    await writeFile(temporary, 'staging bytes can disappear while a revision is being read');
    // A native editor may remove this at any time, but it must never appear
    // in the project manifest, hash, timeline, or export even while present.
    const during = await store.get();
    assert.equal(during.revision, initial.revision);
    assert(!during.project?.files.some(file => file.path.endsWith('.hf322ba5.tmp')));
    await writeFile(userFile, 'User-owned file, not an editor staging handoff');
    await writeFile(nearMatch, 'Not an exact native editor staging suffix');
    const withUserData = await store.get();
    assert.notEqual(withUserData.revision, initial.revision);
    assert(withUserData.project?.files.some(file => file.path === 'notes.tmp'));
    assert(withUserData.project?.files.some(file => file.path === 'notes.hf322ba5.tmp.backup'));
    assert(!withUserData.project?.files.some(file => file.path === 'index.html.hf322ba5.tmp'));
    await rm(temporary);
    const afterNativeRemoval = await store.get();
    assert.equal(afterNativeRemoval.revision, withUserData.revision);
  } finally {
    await Promise.all([temporary, userFile, nearMatch].map(file => rm(file, { force: true })));
  }
  assert.equal((await store.get()).revision, initial.revision);
}));
