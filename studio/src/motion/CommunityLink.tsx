import { useI18n, type Locale } from '../i18n/I18n';
import { Tooltip } from '../components/ui/Tooltip';
import discordLogo from './community-discord.svg';
import feishuLogo from './community-feishu.svg';

export const COMMUNITY_URL = 'https://discord.gg/mHAjSMV6gz';
export const FEISHU_COMMUNITY_URL = 'https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=61fk3f18-8ec0-40e4-8b2c-13311f9b5825';

// Chinese users are directed to the Feishu group; other locales use Discord.
export function communityUrl(locale: Locale) {
  return locale === 'zh-CN' ? FEISHU_COMMUNITY_URL : COMMUNITY_URL;
}

export function CommunityLink() {
  const { t, locale } = useI18n();
  const label = t('Join the OpenDesign community');
  const url = communityUrl(locale);
  return <Tooltip label={label} side="bottom" lines={2}>
    <a className="motion-icon-button motion-community-link" href={url}
      target="_blank" rel="noopener noreferrer" aria-label={label}>
      <img src={locale === 'zh-CN' ? feishuLogo : discordLogo} width="16" height="16" alt="" />
    </a>
  </Tooltip>;
}
