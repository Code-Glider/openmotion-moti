// Source-only installer helper; never shipped as part of the npm application.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A previously registered checkout can be deleted or moved; that leaves a stale
// registration with nothing on disk to preserve, so it is reported as unresolved.
function existingDirectory(value) {
  try {
    const resolved = realpathSync(value);
    return statSync(resolved).isDirectory() ? resolved : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

export function sourceMarketplacePlan(root, inventory) {
  assert(Array.isArray(inventory.installed) && Array.isArray(inventory.available), 'Invalid Codex plugin inventory');
  const entries = [...inventory.installed, ...inventory.available];
  if (!entries.length) return { action: 'add' };
  assert(entries.every(item => item.pluginId === 'openmotion@openmotion-local'), 'Refusing to replace a marketplace containing unrelated plugins');
  const sources = [...new Set(entries.map(item => item.marketplaceSource?.source))];
  assert(sources.length === 1 && entries.every(item => item.marketplaceSource?.sourceType === 'local' && typeof item.marketplaceSource.source === 'string' && item.marketplaceSource.source),
    'Refusing a non-local or ambiguous OpenMotion source');
  const previous = existingDirectory(sources[0]);
  if (previous && previous === realpathSync(root)) return { action: 'reuse' };
  // The recorded checkout no longer exists: only the stale registration remains,
  // so rebind it instead of failing the whole install before registration.
  if (!previous) return { action: 'replace_uninstalled_source', previous: sources[0] };
  assert(!inventory.installed.length, 'OPENMOTION_SOURCE_IN_USE: another source is installed. Reuse that installation or explicitly select its upgrade; no configuration was changed.');
  const catalog = JSON.parse(readFileSync(path.join(previous, '.agents/plugins/marketplace.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(previous, '.codex-plugin/plugin.json'), 'utf8'));
  assert(catalog.name === 'openmotion-local' && catalog.plugins?.length === 1
    && catalog.plugins[0].name === 'openmotion' && catalog.plugins[0].source?.source === 'local'
    && catalog.plugins[0].source.path === './' && manifest.name === 'openmotion', 'Refusing to replace an unrecognized OpenMotion marketplace');
  return { action: 'replace_uninstalled_source', previous };
}

export function registerSourceMarketplace(root, { checkOnly = false, codex = 'codex' } = {}) {
  const run = args => execFileSync(codex, args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const inventory = JSON.parse(run(['plugin', 'list', '--marketplace', 'openmotion-local', '--available', '--json']));
  const plan = sourceMarketplacePlan(root, inventory);
  if (checkOnly || plan.action === 'reuse') return plan;
  if (plan.previous) run(['plugin', 'marketplace', 'remove', 'openmotion-local']);
  try { run(['plugin', 'marketplace', 'add', root]); }
  catch (error) {
    if (plan.previous && existingDirectory(plan.previous)) {
      try { run(['plugin', 'marketplace', 'add', plan.previous]); }
      catch { throw new Error('Marketplace registration and rollback failed; restore the previous OpenMotion source: ' + plan.previous); }
    }
    throw error;
  }
  return plan;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(registerSourceMarketplace(path.resolve(process.argv[2]), { checkOnly: process.argv.includes('--check') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
