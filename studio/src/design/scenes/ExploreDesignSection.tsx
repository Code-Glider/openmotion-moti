import { useEffect, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../../packages/design-system/react/RemixIcons';
import { designScenarios, type DesignScenarioId, type DesignTemplateSummary } from '../../../../shared/design-project';
import { useI18n } from '../../i18n/I18n';
import { designClient } from '../designClient';
import type { DesignTabId } from './DesignSceneTabs';
import '../design.css';

/**
 * Design Studio HTML scenarios and starter template shelf embedded in Explore.
 * Clicking any scenario opens that tab in Design Studio; clicking a template remixes or previews it.
 */
export function ExploreDesignSection({
  onSelectDesignScene,
  onOpenProject,
}: {
  onSelectDesignScene: (scene: DesignTabId) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<DesignTemplateSummary[]>([]);

  useEffect(() => {
    let active = true;
    designClient.listTemplates({ limit: 8 }).then(res => {
      if (active && Array.isArray(res?.items)) setTemplates(res.items);
    }).catch(() => { /* optional in offline/mocked tests */ });
    return () => { active = false; };
  }, []);

  const remix = async (tpl: DesignTemplateSummary) => {
    try {
      const { project } = await designClient.createProject({ scenario: tpl.scenario as DesignScenarioId, templateId: tpl.id });
      onOpenProject(project.id);
    } catch {
      onSelectDesignScene(tpl.scenario);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }} data-design-explore-section="">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span className="om-design-muted">{t('HTML design scenarios · built with your MCP Agent')}</span>
        <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="folder-open-line" size={14} />} onClick={() => onSelectDesignScene('projects')}>
          {t('All design projects')}
        </Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {designScenarios.map(scenario => (
          <Button
            key={scenario.id}
            type="button"
            variant="secondary"
            size="md"
            data-design-scenario={scenario.id}
            icon={<RemixIcon name={scenario.icon} size={16} />}
            style={{ justifyContent: 'flex-start', height: 'auto', padding: '10px 12px', textAlign: 'left' }}
            onClick={() => onSelectDesignScene(scenario.id)}
          >
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, whiteSpace: 'normal' }}>
              <strong>{t(scenario.label)}</strong>
              <span className="om-design-muted" style={{ fontSize: 12 }}>{t(scenario.hint)}</span>
            </span>
          </Button>
        ))}
      </div>

      {templates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="om-design-muted">{t('Design templates')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {templates.slice(0, 6).map(tpl => (
              <article key={tpl.id} className="om-design-card" data-design-template={tpl.id}>
                <div className="om-design-card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.title}</strong>
                    <span className="om-design-badge">{tpl.scenario}</span>
                  </div>
                  <p className="om-design-muted" style={{ margin: 0, fontSize: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {tpl.description}
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                    <Button type="button" size="sm" variant="primary" onClick={() => onSelectDesignScene(tpl.scenario)}>{t('Try')}</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void remix(tpl)}>{t('Remix')}</Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
