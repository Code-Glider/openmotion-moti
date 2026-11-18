import { z } from "zod";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { OPENMOTION_TEMPLATE_ACTION } from "./templateRecommendationAction.ts";

const templateSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  posterUrl: z.string().url().optional(),
  previewUrl: z.string().url().optional(),
  duration: z.number().finite().nonnegative().optional(),
  editable: z.boolean().optional(),
});
const detailsSchema = z.object({ templates: z.array(templateSchema).min(1).max(6) });
const selectionSchema = z.object({ templateId: z.string().min(1).max(200) });

const skill = {
  name: "openmotion-template-recommendations",
  description: "Show interactive OpenMotion template recommendation cards when the user asks for template ideas. Load this before recommending templates; choosing a card does not create a project until the user explicitly confirms.",
  provider: "openmotion-dsh",
  source: "bundled",
  rank: 20,
  invocation: { modelInvocable: true, userInvocable: false },
};

export function registerOpenMotionTemplateCards(ctx: any): void {
  const skills = ctx.skills;
  if (skills?.registerProvider) {
    ctx.effect(() => skills.registerProvider(() => ({
      name: skill.provider,
      list: () => Promise.resolve([skill]),
      get: () => Promise.resolve({
        ...skill,
        content: [
          "When the user asks for OpenMotion template recommendations, load this skill first.",
          "Use openmotion_list_templates and openmotion_get_template to inspect candidate templates.",
          `Then call propose_action with action=${OPENMOTION_TEMPLATE_ACTION}, a concise title and brief, and details.templates containing one to six candidates. Include each candidate's exact id, title, description, posterUrl, previewUrl, duration and whether it is editable when available. Do not call openmotion_create_project for a recommendation alone.`,
          "After the user chooses a card, continue with the selected template ID and ask for confirmation before creating an editable project.",
        ].join("\\n\\n"),
      }),
    })), "openmotion-dsh: template recommendation skill");
  }

  const actionCards = ctx.actionCards;
  if (!actionCards?.register) return;
  ctx.effect(() => actionCards.register({
    action: OPENMOTION_TEMPLATE_ACTION,
    skill: skill.name,
    details: detailsSchema,
    invitation: "Invite the user to preview a card or choose a template. Do not say that a project has already been created.",
    verbs: { preview: {}, use: {} },
    openPhases: ["failed", "unconfirmed"],
    statusGuidance: "An OpenMotion template card is a recommendation only. Preview opens the selected template; use records the user's selection so the next turn can ask for confirmation. Neither action creates or overwrites a project.",
    act: async (agent: any, proposal: any, verb: string, payload: unknown) => {
      const details = detailsSchema.parse(proposal.details);
      const selection = selectionSchema.parse(payload);
      const template = details.templates.find((item) => item.id === selection.templateId);
      if (!template) return { status: "refused", reason: "template-unavailable" };
      const actionText = verb === "preview" ? "Open the template library preview" : "The user selected this template";
      agent.followup(createUserMessage({
        content: [{ type: "text", text: `${actionText}: ${template.title} (templateId=${template.id}). Preserve the user's choice. ${verb === "use" ? "Ask for confirmation before creating an editable project from it." : "Do not create a project just to preview it."}` }],
        source: { kind: "user" },
      }));
      const decision = {
        callId: proposal.callId,
        action: OPENMOTION_TEMPLATE_ACTION,
        phase: verb === "preview" ? "preview-requested" : "selected",
        data: { templateId: template.id },
      };
      actionCards.record(agent, decision);
      return { status: "settled", decision };
    },
  }), "openmotion-dsh: template recommendation cards");
}
