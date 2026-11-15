import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPrompt, setupGuideUrl, templatePrompt, type IntegrationInfo } from '../shared/integration.ts';

const info: IntegrationInfo = {
  name: 'OpenMotion', version: '1.0.0', templateSource: 'repository',
  previewUrl: 'http://127.0.0.1:49937', dataDirectory: '/private/project-data', tools: [],
  transport: { type: 'stdio', command: '/private/node', args: ['/private/mcp.ts'], cwd: '/private', env: { MOTION_DATA_DIR: '/private/project-data' } },
};

test('setup works before local discovery and never copies machine-local details', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    for (const host of ['codex', 'claude', 'deepseek', 'mcp'] as const) {
      for (const discovery of [null, info]) {
        const prompt = setupPrompt(discovery, host, locale);
        assert.match(prompt, /https:\/\/github.com\/nexu-io\/openmotion#quick-start/);
        assert.ok(prompt.includes(setupGuideUrl(discovery)));
        assert.match(prompt, /openmotion_get_project/);
        assert.doesNotMatch(prompt, /127\.0\.0\.1|localhost|\/connect\/guide|\/private|49937/);
      }
    }
  }
  const prompt = setupPrompt(null, 'codex', 'en');
  assert.match(prompt, /Reuse its workspace/);
  assert.match(prompt, /Install only if missing/);
  assert.match(prompt, /service is stopped/);
  assert.match(prompt, /Configuration alone does not prove connection/);
  assert.match(prompt, /Wait for my creative brief/);
});

test('public setup retains repository and published catalog environments', () => {
  assert.equal(setupGuideUrl(null), 'https://github.com/nexu-io/openmotion/blob/main/install.md');
  assert.equal(setupGuideUrl(info), setupGuideUrl(null));
  const published: IntegrationInfo = { ...info, templateSource: 'cms' };
  assert.equal(setupGuideUrl(published), 'https://releases.open-design.ai/open-motion/install.md');
  assert.equal(setupGuideUrl({ ...published, templateEnvironment: 'dev' }), 'https://releases.open-design.ai/open-motion/dev/install.md');
  assert.equal(setupGuideUrl({ ...published, transport: { ...info.transport, env: { ...info.transport.env, MOTION_TEMPLATE_ENV: 'dev' } } }), 'https://releases.open-design.ai/open-motion/dev/install.md');
  assert.equal(setupGuideUrl({ ...info, templateEnvironment: 'dev' }), setupGuideUrl(null));
  assert.match(setupPrompt(null, 'chatgpt', 'en'), /requires a public HTTPS MCP service/);
});

test('template prompt reuses the shared published install guide', () => {
  const template = { id: 'prism-a', title: 'Prism A' };
  for (const published of [
    { ...info, templateSource: 'cms' } as IntegrationInfo,
    { ...info, templateSource: 'cms', templateEnvironment: 'dev' } as IntegrationInfo,
    { ...info, templateSource: 'cms', transport: { ...info.transport, env: { ...info.transport.env, MOTION_TEMPLATE_ENV: 'dev' } } } as IntegrationInfo,
  ]) {
    for (const locale of ['en', 'zh-CN']) {
      assert.ok(templatePrompt(published, 'codex', template, locale).includes(setupGuideUrl(published)));
    }
  }
});
