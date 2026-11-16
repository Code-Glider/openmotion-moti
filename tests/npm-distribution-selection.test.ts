import test from 'node:test';
import assert from 'node:assert/strict';
import { distributionFiles } from '../scripts/distribution.ts';

test('application selection validates only its selected positive-list files', async () => {
  assert.deepEqual(await distributionFiles('phase1', file => file === '.codex-plugin/plugin.json'), ['.codex-plugin/plugin.json']);
});

test('an empty application selection does not require optional showcase downloads', async () => {
  assert.deepEqual(await distributionFiles('phase1', () => false), []);
});

test('the onboarding distribution keeps the in-turn renderer without the retired queue scheduler', async () => {
  const files = await distributionFiles('phase1', file => /^scripts\/(?:install-onboarding|inline-onboarding|onboarding-callback)\.mjs$/.test(file));
  assert.deepEqual(files.sort(), ['scripts/inline-onboarding.mjs', 'scripts/install-onboarding.mjs']);
});
