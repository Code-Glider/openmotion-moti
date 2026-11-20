import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../../packages/design-system/react/RemixIcons';
import { designScenarios, type DesignScenarioId } from '../../../../shared/design-project';
import { useI18n } from '../../i18n/I18n';
import '../design.css';

export type DesignTabId = DesignScenarioId | 'projects';

export function DesignSceneTabs({
  activeTab,
  onSelectDesignScene,
}: {
  activeTab: DesignTabId | null;
  onSelectDesignScene: (scene: DesignTabId) => void;
}) {
  const { t } = useI18n();

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
    </span>
  );
}
