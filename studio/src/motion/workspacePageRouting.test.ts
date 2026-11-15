import { expect, it } from 'vitest';
import { readWorkspacePage, settingsSections, workspacePageHref } from './workspacePageRouting';

it.each(settingsSections)('round-trips the %s destination without changing editor or host context', settings => {
  const source = 'http://localhost/?session=project&project=project&embed=1&tracking_context=11111111-1111-1111-1111-111111111111#project/project?v=1&t=12&tab=design&rc=0';
  const next = new URL(workspacePageHref(source, { settings }), source);
  expect(readWorkspacePage(next.search).settings).toBe(settings);
  expect(next.hash).toBe(new URL(source).hash);
  for (const key of ['session', 'project', 'embed', 'tracking_context']) expect(next.searchParams.get(key)).toBe(new URL(source).searchParams.get(key));
  const editor = new URL(workspacePageHref(next.href, { settings: null }), source);
  expect(editor.href).toBe(source);
});

it('retains the library return page and selected detail, and clears page-specific options on exit', () => {
  const source = 'http://localhost/?page=mcp&host=claude&setup=manual';
  const library = new URL(workspacePageHref(source, { templates: true, template: 'film/a & b' }), source);
  expect(readWorkspacePage(library.search)).toMatchObject({ settings: 'mcp', templates: true, template: 'film/a & b', client: 'claude', setup: 'manual' });
  expect(workspacePageHref(library.href, { templates: false })).toBe('/?page=mcp&host=claude&setup=manual');
  const providers = new URL(workspacePageHref(library.href, { settings: 'providers', templates: false, provider: 'custom-a' }), source);
  expect(providers.search).toBe('?page=settings&section=providers&provider=custom-a');
  expect(workspacePageHref(providers.href, { settings: 'general' })).toBe('/?page=settings&section=general');
});

it('keeps legacy editor and template URLs and safely defaults unknown options', () => {
  expect(readWorkspacePage('?templates=1').templates).toBe(true);
  expect(readWorkspacePage('?project=project').settings).toBeNull();
  expect(readWorkspacePage('?page=unknown').settings).toBeNull();
  expect(readWorkspacePage('?page=settings&section=unknown').settings).toBe('general');
  expect(readWorkspacePage('?page=mcp&host=unknown&setup=unknown')).toMatchObject({ settings: 'mcp', client: 'codex', setup: 'agent' });
});
