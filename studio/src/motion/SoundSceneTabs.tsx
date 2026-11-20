import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { SOUND_TABS, type SoundTabId } from './soundTabs';

export function SoundSceneTabs({
  activeTab,
  onSelectTab,
}: {
  activeTab: SoundTabId;
  onSelectTab: (tabId: SoundTabId) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="om-sound-tabs-strip">
      {SOUND_TABS.map(tab => {
        const active = tab.id === activeTab;
        return (
          <Button
            key={tab.id}
            type="button"
            variant="plain"
            className="om-nav-item om-sound-tab"
            data-sound-tab={tab.id}
            data-status={tab.status}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (!active) onSelectTab(tab.id);
            }}
          >
            <RemixIcon name={tab.icon} size={14} className="om-sound-tab-icon" />
            <span>{t(tab.label)}</span>
            {tab.status === 'soon' && (
              <span className="om-sound-soon-tag">{t('Soon')}</span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
