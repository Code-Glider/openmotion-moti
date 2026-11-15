// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import readme from '../../../README.md?raw';
import chineseReadme from '../../../README.zh-CN.md?raw';
import { I18nProvider } from '../i18n/I18n';
import { SettingsCenter } from './SettingsCenter';

it.each([
  { locale: 'zh-CN', heading: '社群', label: '飞书群 (README)', path: '/blob/main/README.zh-CN.md', anchor: '社区', document: chineseReadme, invite: '飞书群' },
  { locale: 'en', heading: 'Community', label: 'Feishu group (README)', path: '', anchor: 'community', document: readme, invite: 'Feishu' },
] as const)('offers both community resources from Help in $locale', ({ locale, heading, label, path, anchor, document, invite }) => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <SettingsCenter section="help" onSection={() => {}} openConnections={() => {}} />
    </I18nProvider>,
  );
  const page = new DOMParser().parseFromString(html, 'text/html');
  const section = page.querySelector('section[aria-labelledby="om-community-heading"]');
  expect(section?.querySelector('h2')?.textContent).toBe(heading);
  const links = Array.from(section!.querySelectorAll('a'));
  expect(links.map(link => link.textContent)).toEqual(['Discord', label]);
  expect(readme).toContain(`[Discord](${links[0].href})`);
  expect(links[1].getAttribute('href')).toBe(`https://github.com/nexu-io/openmotion${path}#${anchor}`);
  expect(document.split(`<a id="${anchor}"></a>`)[1]).toContain(`[${invite}](`);
  for (const link of links) {
    expect(link.target).toBe('_blank');
    expect(link.relList.contains('noopener')).toBe(true);
  }
});
