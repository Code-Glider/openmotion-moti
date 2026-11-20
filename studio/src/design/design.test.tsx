// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { readWorkspacePage, workspacePageHref } from '../motion/workspacePageRouting';
import { CodeViewer } from './CodeViewer';
import { DesignApiError, designClient } from './designClient';
import { DesignProjectEditor } from './DesignProjectEditor';
import { DesignProjectList } from './DesignProjectList';
import { buildBridgeSrcDoc, looksLikeDeck, parseDeckSlides, parseSpeakerNotes } from './previewBridge';

const projectId = '22222222-2222-4222-8222-222222222222';
const revision = 'b'.repeat(64);

const mockProject = {
  id: projectId,
  title: 'Test Prototype',
  scenario: 'prototype' as const,
  entry: 'index.html',
  designSystemId: 'stripe',
  templateId: null,
  source: 'blank' as const,
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
  trashedAt: null,
  revision,
  versionId: 'v-1',
  versionLabel: 'v1',
  files: [{ path: 'index.html', size: 80, sha256: revision, kind: 'html' as const }],
  path: '/tmp/design/projects/' + projectId,
  previewUrl: `/motion-api/design/raw/${projectId}/index.html`,
  editorUrl: `/?page=design&scene=projects&designProject=${projectId}`,
  openComments: 1,
};

const mockComment = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId,
  text: 'Increase hero button contrast',
  status: 'open' as const,
  anchor: {
    filePath: 'index.html',
    viewport: { id: 'desktop' as const, width: 1440, height: 900 },
    element: { selector: 'h1', tagName: 'h1', label: 'Hero', box: { x: 40, y: 40, width: 300, height: 48 } },
  },
  sourceRevision: revision,
  author: 'user' as const,
  createdAt: 1700000000500,
  updatedAt: 1700000000500,
  commentRevision: 1,
};

describe('Design Studio client, bridge and routing', () => {
  it('parses structured API errors with code and status', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Stale revision' } }), { status: 409 }),
    );
    try {
      await expect(designClient.getProject(projectId)).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
        status: 409,
        message: 'Stale revision',
      });
      await expect(designClient.getProject(projectId).catch(e => e)).resolves.toBeInstanceOf(Error);
    } finally { spy.mockRestore(); }
  });

  it('extracts deck slides, speaker notes and injects base href into bridge srcdoc', () => {
    const deckHtml = `<!doctype html><html><head><title>Deck</title></head><body>
      <section class="slide active" data-screen-label="Intro"><h1>Welcome</h1></section>
      <section class="slide"><h2>Details</h2></section>
      <script type="application/json" id="speaker-notes">["First note", "Second note"]</script>
    </body></html>`;
    expect(looksLikeDeck(deckHtml)).toBe(true);
    expect(parseSpeakerNotes(deckHtml)).toEqual(['First note', 'Second note']);
    expect(parseDeckSlides(deckHtml)).toEqual([
      { index: 0, label: 'Intro' },
      { index: 1, label: 'Details' },
    ]);
    const wrapped = buildBridgeSrcDoc(deckHtml, 'http://localhost/motion-api/design/raw/id/', 'tok-1', true);
    expect(wrapped).toContain('<base href="http://localhost/motion-api/design/raw/id/" />');
    expect(wrapped).toContain('om:design-pick');
  });

  it('routes design HTML scenarios and project editor separately from image media scenes', () => {
    const img = readWorkspacePage('?page=design&scene=text-to-image');
    expect(img.studio?.studio.id).toBe('design');
    expect(img.studio?.scene.id).toBe('text-to-image');
    expect(img.designScene).toBeUndefined();

    const proto = readWorkspacePage('?page=design&scene=prototype');
    expect(proto.designScene).toBe('prototype');
    expect(proto.studio).toBeNull();

    const editor = readWorkspacePage(`?page=design&scene=projects&designProject=${projectId}`);
    expect(editor.designScene).toBe('projects');
    expect(editor.designProject).toBe(projectId);
    expect(editor.studio).toBeNull();

    const href = workspacePageHref('http://localhost/?page=explore', { designScene: 'deck', designProject: projectId });
    expect(href).toBe(`/?page=design&scene=deck&designProject=${projectId}`);
  });
});

describe('DesignProjectEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
  });

  it('switches Preview/Code, lists comments and resolves an open annotation', async () => {
    let resolved = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith(`/projects/${projectId}`) && (!init?.method || init.method === 'GET')) {
        return Response.json({ project: mockProject });
      }
      if (url.includes('/versions')) {
        return Response.json({ versions: [{ id: 'v-1', label: 'v1', number: 1, createdAt: 1700000000000, source: 'create', summary: 'Initial', prompt: null, restoredFrom: null, files: [] }], currentVersionId: 'v-1', nextCursor: null });
      }
      if (url.includes('/comments/') && init?.method === 'PATCH') {
        resolved = true;
        return Response.json({ comment: { ...mockComment, status: 'resolved', commentRevision: 2 } });
      }
      if (url.includes('/comments')) {
        return Response.json({ comments: [mockComment], sourceRevision: revision });
      }
      if (url.includes('/files/')) {
        return Response.json({ path: 'index.html', content: '<!doctype html><html><body><h1>Hello</h1></body></html>', revision, size: 56, nextOffset: null });
      }
      if (url.includes('/editors')) {
        return Response.json({ editors: [{ id: 'cursor', label: 'Cursor', icon: 'code-s-slash-line', available: true }] });
      }
      if (url.includes('/state')) {
        return Response.json({ revision, versionId: 'v-1', openComments: resolved ? 0 : 1, updatedAt: 1700000001000 });
      }
      return Response.json({});
    });

    await act(async () => {
      root.render(
        <I18nProvider>
          <DesignProjectEditor projectId={projectId} onBack={() => {}} />
        </I18nProvider>,
      );
    });

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Project title"]')?.value).toBe('Test Prototype');

    // Switch to Code view
    const codeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Code'));
    expect(codeBtn).toBeTruthy();
    await act(async () => { codeBtn!.click(); });
    expect(container.textContent).toContain('<h1>Hello</h1>');

    // Switch sidebar to Comments and resolve the open comment
    const commentsTab = Array.from(container.querySelectorAll('[role="tablist"] button')).find(b => b.textContent?.includes('Comments'));
    expect(commentsTab).toBeTruthy();
    await act(async () => { commentsTab!.click(); });
    expect(container.textContent).toContain('Increase hero button contrast');

    const resolveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Resolve');
    expect(resolveBtn).toBeTruthy();
    await act(async () => { resolveBtn!.click(); });
    expect(resolved).toBe(true);
    expect(DesignApiError).toBeDefined();
  });

  it('renders line numbers and syntax token classes in CodeViewer', async () => {
    await act(async () => {
      root.render(<CodeViewer content={'<!-- hero -->\n<h1 class="title">Hello</h1>\nconst count = 42;'} />);
    });
    const lines = container.querySelectorAll('.om-design-code-line');
    expect(lines.length).toBe(3);
    expect(container.querySelector('.om-design-tok-comment')?.textContent).toBe('<!-- hero -->');
    expect(container.querySelector('.om-design-tok-tag')?.textContent).toBe('<h1');
    expect(container.querySelector('.om-design-tok-string')?.textContent).toBe('"title"');
    expect(container.querySelector('.om-design-tok-keyword')?.textContent).toBe('const');
    expect(container.querySelector('.om-design-tok-number')?.textContent).toBe('42');
  });

  it('lists design projects and opens a project from DesignProjectList', async () => {
    const opened: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/editors')) return Response.json({ editors: [{ id: 'vscode', label: 'VS Code', icon: 'code-s-slash-line', available: true }] });
      if (url.includes('/projects')) return Response.json({ projects: [mockProject] });
      return Response.json({});
    });
    await act(async () => {
      root.render(
        <I18nProvider>
          <DesignProjectList onOpen={id => opened.push(id)} />
        </I18nProvider>,
      );
    });
    expect(container.textContent).toContain('Test Prototype');
    expect(container.textContent).toContain('v1');
    const openBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Open');
    expect(openBtn).toBeTruthy();
    await act(async () => { openBtn!.click(); });
    expect(opened).toEqual([projectId]);
  });
});
