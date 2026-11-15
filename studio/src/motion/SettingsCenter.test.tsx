// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import readme from '../../../README.md?raw';
import { I18nProvider } from '../i18n/I18n';
import { SettingsCenter } from './SettingsCenter';

it('offers both README community invitations in Help without leaving Studio', () => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale="zh-CN">
      <SettingsCenter section="help" onSection={() => {}} openConnections={() => {}} />
    </I18nProvider>,
  );
  const page = new DOMParser().parseFromString(html, 'text/html');
  const section = page.querySelector('section[aria-labelledby="om-community-heading"]');
  expect(section?.querySelector('h2')?.textContent).toBe('社群');
  const links = Array.from(section!.querySelectorAll('a'));
  expect(links.map(link => link.textContent)).toEqual(['Discord', '飞书群']);
  for (const [index, label] of ['Discord', 'Feishu'].entries()) {
    expect(readme).toContain(`[${label}](${links[index].href})`);
    expect(links[index].target).toBe('_blank');
    expect(links[index].relList.contains('noopener')).toBe(true);
  }
});
