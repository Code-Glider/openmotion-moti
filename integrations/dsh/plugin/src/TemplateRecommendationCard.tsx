import React, { useEffect, useRef, useState } from "react";
import { translations, resolveLanguage } from "../../../../mcp-ui/template-recommendations/i18n.ts";
import { createInlineFeedback } from "../../../../packages/design-system/inline-feedback.ts";
import type { RecommendationDetails } from "./templateRecommendationAction.ts";
import { useHostTheme } from "./theme.ts";
import { studioAssetUrl } from "./studio.ts";

type Props = {
  proposal: { callId?: string; details: RecommendationDetails };
  decision?: { phase?: string };
  summary?: React.ReactNode;
  act: (verb: string, payload: { templateId: string }) => Promise<unknown>;
};

export function TemplateRecommendationCard({ proposal, decision, summary, act }: Props) {
  const theme = useHostTheme();
  const details = proposal.details;
  const language = resolveLanguage(details.language || "en");
  const { ui, welcome } = translations[language];
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLElement>(null);
  const feedback = useRef<ReturnType<typeof createInlineFeedback> | undefined>(undefined);
  useEffect(() => {
    feedback.current = createInlineFeedback(root.current!);
    return () => feedback.current?.destroy();
  }, []);
  async function choose(verb: string, templateId: string) {
    setPending(true);
    try {
      const result = await act(verb, { templateId }) as { status?: string } | undefined;
      if (!result || result.status === "refused" || result.status === "unconfirmed") feedback.current?.show(ui.notSent);
    } catch { feedback.current?.show(ui.notSent); }
    finally { setPending(false); }
  }
  return (
    <section ref={root} className="omd-recommendation-card" data-motion-ui data-theme={theme} data-phase={decision?.phase || "open"} aria-label={ui.listLabel}>
      {details.onboarding ? <header className="omd-recommendation-welcome">
        {details.libraryOpened && <strong>{welcome.heading}</strong>}
        <p>{welcome.introduction}</p>
        <p>{welcome.discovery}</p>
        <strong>{welcome.recommendations}</strong>
      </header> : summary}
      <div className="omd-recommendation-list">
        {details.templates.map(template => (
          <article className="omd-recommendation-item" key={template.id} data-template-id={template.id}>
            {template.previewUrl ? <video controls preload="none" playsInline poster={studioAssetUrl(template.posterUrl)} src={studioAssetUrl(template.previewUrl)} aria-label={template.title} />
              : template.posterUrl ? <img src={studioAssetUrl(template.posterUrl)} alt="" loading="lazy" /> : <div className="omd-recommendation-placeholder" />}
            <div className="omd-recommendation-copy">
              <strong>{template.title}</strong>
              {template.duration != null && <span>{Math.round(template.duration)}s</span>}
              {template.description && <p>{template.description}</p>}
            </div>
            <div className="omd-recommendation-actions">
              <button type="button" className="ui-button ui-button--ghost ui-button--sm" disabled={pending} onClick={() => void choose("preview", template.id)}>{ui.preview}</button>
              <button type="button" className="ui-button ui-button--primary ui-button--sm" disabled={pending} onClick={() => void choose("use", template.id)}>{ui.clone}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
