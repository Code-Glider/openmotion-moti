import test from "node:test";
import assert from "node:assert/strict";
import { registerOpenMotionTemplateCards } from "../integrations/dsh/plugin/src/templateRecommendationCards.ts";

test("template recommendation cards are optional and preserve explicit selection semantics", async () => {
  const effects: Array<() => unknown> = [];
  const registered: any[] = [];
  const providers: any[] = [];
  const ctx = {
    effect: (run: () => unknown) => { effects.push(run); return () => {}; },
    skills: { registerProvider: (provider: unknown) => { providers.push(provider); return () => {}; } },
    actionCards: { register: (kind: unknown) => { registered.push(kind); return () => {}; }, record: () => {} },
  };
  registerOpenMotionTemplateCards(ctx);
  effects.forEach((run) => run());
  assert.equal(providers.length, 1);
  assert.equal(registered.length, 1);
  const kind = registered[0];
  const follows: unknown[] = [];
  const decisions: unknown[] = [];
  const agent = { followup: (message: unknown) => follows.push(message) };
  const actionCards = ctx.actionCards;
  kind.act(agent, {
    callId: "call-1",
    details: { templates: [{ id: "template-1", title: "Product Promo", editable: true }] },
  }, "use", { templateId: "template-1" });
  assert.equal(follows.length, 1);
  assert.match((follows[0] as any).content[0].text, /template-1/);
  assert.equal((follows[0] as any).source.kind, "user");
  assert.equal(kind.action, "openmotion_template_recommendation");
  assert.deepEqual(decisions, []);
  // A host without actionCards must remain a no-op; the existing MCP bridge is untouched.
  assert.doesNotThrow(() => registerOpenMotionTemplateCards({ effect: () => {}, skills: undefined, actionCards: undefined }));
  void actionCards;
});
