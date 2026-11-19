import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../../packages/design-system/react/RemixIcons';
import {
  designScenarios, linkedDesignScenarios,
  type DesignScenarioId,
} from '../../../../shared/design-project';
import { findMediaStudio, type CreativeStudio } from '../../../../shared/studio-catalog';
import { motionStudio } from '../../motion/creativeStudios';
import { useI18n } from '../../i18n/I18n';
import '../design.css';

export type DesignTabId = DesignScenarioId | 'projects';

export function DesignSceneTabs({
  activeTab,
  onSelectDesignScene,
  onChooseStudio,
  onSelectImageScene,
}: {
  activeTab: DesignTabId | null;
  onSelectDesignScene: (scene: DesignTabId) => void;
  onChooseStudio: (studio: CreativeStudio) => void;
  onSelectImageScene?: (sceneId: 'text-to-image' | 'image-edit') => void;
}) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  const openLinked = (target: typeof linkedDesignScenarios[number]['studio']) => {
    setMoreOpen(false);
    if (target === 'motion') onChooseStudio(motionStudio);
    else if (target === 'cinema') {
      const s = findMediaStudio('cinema');
      if (s) onChooseStudio(s);
    } else if (target === 'sound') {
      const s = findMediaStudio('sound');
      if (s) onChooseStudio(s);
    } else if (target === 'design-image') {
      if (onSelectImageScene) onSelectImageScene('text-to-image');
      else {
        const s = findMediaStudio('design');
        if (s) onChooseStudio(s);
      }
    }
  };

  return (
    <span className="om-design-scene-tabs">
      <Button
        type="button"
        size="sm"
        variant={activeTab === 'projects' ? 'secondary' : 'ghost'}
        icon={<RemixIcon name="folder-open-line" size={14} />}
        aria-current={activeTab === 'projects' ? 'page' : undefined}
        onClick={() => onSelectDesignScene('projects')}
      >
        {t('Projects')}
      </Button>
      {designScenarios.map(scenario => (
        <Button
          key={scenario.id}
          type="button"
          size="sm"
          variant={activeTab === scenario.id ? 'secondary' : 'ghost'}
          icon={<RemixIcon name={scenario.icon} size={14} />}
          aria-current={activeTab === scenario.id ? 'page' : undefined}
          onClick={() => onSelectDesignScene(scenario.id)}
        >
          {t(scenario.label)}
        </Button>
      ))}
      <Popover.Root modal={false} open={moreOpen} onOpenChange={setMoreOpen}>
        <Popover.Trigger render={
          <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="arrow-down-s-line" size={14} />}>
            {t('More')}
          </Button>
        } />
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-150">
            <Popover.Popup className="om-design-popover" style={{ minWidth: 220 }}>
              <span className="om-design-muted" style={{ padding: '2px 6px' }}>{t('Other OpenMotion studios')}</span>
              {linkedDesignScenarios.map(item => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={<RemixIcon name={item.icon} size={14} />}
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => openLinked(item.studio)}
                >
                  {t(item.label)}
                </Button>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
