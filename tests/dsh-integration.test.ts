import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { integrationConfig, integrationPatch, studioOrigin } from '../integrations/dsh/config.ts';

test('DSH launch configuration isolates state and quotes machine-specific values', () => {
  const root = path.resolve('checkout with spaces');
  const config = integrationConfig(root, { OPENMOTION_DSH_HOME: path.resolve('host state'), OPENMOTION_DSH_PORT: '3088', MOTION_DATA_DIR: path.resolve('existing data') });
  assert.equal(config.port, 3088);
  assert.equal(config.data, path.resolve('existing data'));
  assert.equal(config.dshHome, path.join(config.home, 'dsh'));
  const executable = '/node path/with "quotes"/node';
  const patch = integrationPatch(config, executable, { MOTION_TEMPLATE_SOURCE: 'hosted' });
  const scalar = (key: string) => JSON.parse(patch.match(new RegExp(`^ +${key}: (.*)$`, 'm'))![1]);
  assert.equal(scalar('root'), root);
  assert.equal(scalar('dataDirectory'), config.data);
  assert.equal(scalar('node'), executable);
  assert.equal(scalar('templateSource'), 'hosted');
  assert.ok(!patch.includes('providers:'));
  for (const port of ['0', '65536', 'abc', '1.5']) assert.throws(() => integrationConfig(root, { OPENMOTION_DSH_PORT: port }));
});

test('DSH rejects remote, credential-bearing and non-origin Studio addresses', () => {
  assert.equal(studioOrigin('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173');
  for (const url of ['https://example.com', 'http://example.com', 'file:///tmp/studio', 'http://user:secret@localhost:4173', 'http://localhost/path', 'http://localhost/?token=secret']) assert.throws(() => studioOrigin(url));
});

test('packaged DSH host shares MCP data and bounds its read-only proxy', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'openmotion-dsh-test-'));
  const requests: string[] = [];
  const upstream = createServer((req, res) => {
    requests.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url!.startsWith('/api/projects') ? { projects: [{ id: 'example' }] } : { items: [], total: 0 }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const routes = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  const host = createServer((req, res) => {
    const route = routes.get(req.url!.split('?')[0]) || routes.get('/openmotion-dsh/data');
    if (route) void route(req, res); else { res.writeHead(404); res.end(); }
  });
  try {
    await writeFile(path.join(temporary, 'server.ts'), `console.log(JSON.stringify({previewUrl:${JSON.stringify(origin)}}));`);
    const module = path.join(temporary, 'plugin.js');
    await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}');
    // Only the native MCP bridge is replaced. Exercise the actual compiled host,
    // subprocess receipt, HTTP routes and network requests without model calls.
    await build({
      entryPoints: [fileURLToPath(new URL('../integrations/dsh/plugin/src/index.ts', import.meta.url))],
      outfile: module, bundle: true, format: 'esm', platform: 'node',
      plugins: [{ name: 'mcp-fixture', setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-mcp-client$/ }, () => ({ path: 'bridge', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function apply(ctx, config) { ctx.bridge = config; }', loader: 'js' }));
      } }],
    });
    await copyFile(new URL('../integrations/dsh/plugin/src/style.css', import.meta.url), path.join(temporary, 'style.css'));
    const ctx = {
      bridge: null as any,
      effect: (register: () => unknown) => register(),
      webServer: { register: (route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
      tools: { definitions: () => [{ name: 'mcp__openmotion__openmotion_get_project' }, { name: 'unrelated' }] },
    };
    const plugin = await import(pathToFileURL(module).href);
    const data = path.join(temporary, 'data');
    await plugin.apply(ctx, { root: temporary, dataDirectory: data, templateSource: 'hosted' });
    assert.equal(ctx.bridge.env.MOTION_DATA_DIR, data);
    assert.equal(ctx.bridge.env.MOTION_TEMPLATE_SOURCE, 'hosted');
    assert.equal(ctx.bridge.cwd, temporary);
    assert.equal(ctx.bridge.command, process.execPath);
    assert.deepEqual(ctx.bridge.args, ['--experimental-strip-types', path.join(temporary, 'mcp.ts')]);
    assert.equal(ctx.bridge.failOnStartupError, true);
    await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(host.address() as { port: number }).port}/openmotion-dsh`;
    const status = await (await fetch(base + '/status')).json();
    assert.equal(status.studioUrl, origin);
    assert.deepEqual(status.tools, ['mcp__openmotion__openmotion_get_project']);
    assert.ok((await (await fetch(base + '/style.css')).text()).includes('.omd-studio-seat'));
    assert.deepEqual(await (await fetch(base + '/data/api/projects')).json(), { projects: [{ id: 'example' }] });
    assert.equal((await fetch(base + '/data/api/template-catalog?limit=6')).status, 200);
    for (const [endpoint, method] of [['/api/projects', 'POST'], ['/api/projects/example', 'GET'], ['/api/assets', 'GET'], ['/api/projects/../settings', 'GET']]) {
      assert.equal((await fetch(base + '/data' + endpoint, { method })).status, 404);
    }
    assert.deepEqual(requests, ['/api/projects', '/api/template-catalog?limit=6']);
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    assert.equal((await fetch(base + '/data/api/projects')).status, 503);
  } finally {
    host.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => host.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
    await rm(temporary, { recursive: true, force: true });
  }
});
