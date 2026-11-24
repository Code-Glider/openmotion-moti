// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCaptionModel } from "./parser";
import { managedCaptionScriptTag, rewriteManagedCaptionSource } from "./nativeSource";
import { generateCaptionHtml } from "./generator";

const words = [
  { id: "he-1", text: "שָׁלוֹם", start: 0.1, end: 0.6 },
  { id: "ar-1", text: "السَّلَامُ", start: 0.65, end: 1.1 },
  { id: "latin-1", text: "ABC-123", start: 1.15, end: 1.9 },
];

function makeModel() {
  return buildCaptionModel(words, { width: 640, height: 360, duration: 2, wordsPerGroup: 3 });
}

async function fixture(model = makeModel()) {
  const tag = await managedCaptionScriptTag(model);
  const css = generateCaptionHtml(model).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  return '<!doctype html><html lang="en"><head><style>' + css + '</style>' +
    '<style id="user-design">.brand{color:#5eef8a}</style></head><body>' +
    '<div id="captions-container" data-composition-id="captions" data-width="640" data-height="360" data-duration="2"></div>' +
    tag + '<script id="user-script">window.userAnimation=1;</script></body></html>';
}

describe("managed generated native caption source", () => {
  it("persists authored RTL word transforms without rewriting the remaining project", async () => {
    const model = makeModel();
    const baseline = await fixture(model);
    model.segments.get("segment-0")!.style = { x: 24, y: -12, rotation: 8, scaleX: 1.4, scaleY: 0.8 };
    const updated = await rewriteManagedCaptionSource(baseline, model);
    expect(updated.status).toBe("updated");
    expect(updated.content).toContain('translate(24px, -12px) rotate(8deg) scale(1.4, 0.8)');
    expect(updated.content).toContain('data-caption-wrapper');
    expect(updated.content).toContain("שָׁלוֹם");
    expect(updated.content).toContain("السَّلَامُ");
    expect(updated.content).toContain("ABC-123");
    expect(updated.content).toContain('<style id="user-design">.brand{color:#5eef8a}</style>');
    expect(updated.content).toContain('<script id="user-script">window.userAnimation=1;</script>');
    expect(updated.content.slice(0, baseline.indexOf('<script data-openmotion-caption-source=')))
      .toBe(baseline.slice(0, baseline.indexOf('<script data-openmotion-caption-source=')));
    expect(updated.content.slice(updated.content.indexOf('<script id="user-script">')))
      .toBe(baseline.slice(baseline.indexOf('<script id="user-script">')));
    expect(await rewriteManagedCaptionSource(updated.content, model))
      .toEqual({ status: "unchanged", content: updated.content });
  });

  it("undo and redo are reversible, with exact word identity and no stale transform", async () => {
    const model = makeModel();
    const original = await fixture(model);
    const segment = model.segments.get("segment-0")!;
    segment.style = { x: 22, y: -9, scaleX: 1.2, scaleY: 0.75, rotation: 11 };
    const moved = await rewriteManagedCaptionSource(original, model);
    expect(moved.status).toBe("updated");
    segment.style = {};
    const undone = await rewriteManagedCaptionSource(moved.content, model);
    expect(undone.status).toBe("updated");
    expect(undone.content).toBe(original);
    segment.style = { x: 22, y: -9, scaleX: 1.2, scaleY: 0.75, rotation: 11 };
    const redone = await rewriteManagedCaptionSource(undone.content, model);
    expect(redone.content).toBe(moved.content);
  });

  it("does not convert unsupported legacy source and refuses stale source corruption", async () => {
    const model = makeModel();
    expect(await rewriteManagedCaptionSource(
      '<html><script>const TRANSCRIPT = [];</script></html>', model))
      .toEqual({ status: "unsupported", content: '<html><script>const TRANSCRIPT = [];</script></html>' });
    const src = await fixture();
    const tampered = src.replace('window.userAnimation=1', 'window.userAnimation=2');
    // An unrelated user-owned script survives, and does not invalidate the
    // managed script fingerprint.
    expect((await rewriteManagedCaptionSource(tampered, model)).content).toBe(tampered);
    const modifiedManagedScript = src.replace("const TRANSCRIPT", "let TRANSCRIPT");
    await expect(rewriteManagedCaptionSource(modifiedManagedScript, model))
      .rejects.toThrow("MANAGED_CAPTION_SOURCE_CHANGED_EXTERNALLY");
    await expect(rewriteManagedCaptionSource(src + src, model))
      .rejects.toThrow("MANAGED_CAPTION_SOURCE_MARKER_INVALID");
  });

  it("refuses changed Unicode, word IDs, timings and group identities", async () => {
    const source = await fixture();
    for (const change of [
      (model: ReturnType<typeof makeModel>) => { model.segments.get("segment-0")!.text = "שלום"; },
      (model: ReturnType<typeof makeModel>) => { model.segments.get("segment-1")!.wordId = "other"; },
      (model: ReturnType<typeof makeModel>) => { model.segments.get("segment-2")!.end = 1.8; },
      (model: ReturnType<typeof makeModel>) => { model.groupOrder = ["other-group"]; },
    ]) {
      const model = makeModel();
      change(model);
      await expect(rewriteManagedCaptionSource(source, model)).rejects.toThrow(/MANAGED_CAPTION_/);
    }
  });

  it("rejects invalid or duplicate IDs and impossible transforms without touching source", async () => {
    const source = await fixture();
    const repeated = makeModel();
    repeated.segments.get("segment-2")!.wordId = "he-1";
    await expect(rewriteManagedCaptionSource(source, repeated)).rejects.toThrow(/MANAGED_CAPTION_/);
    const invalid = makeModel();
    invalid.segments.get("segment-0")!.style = { x: Infinity };
    await expect(rewriteManagedCaptionSource(source, invalid)).rejects.toThrow("INVALID_CAPTION_WORD_TRANSFORM_X");
    const wrongDimensions = makeModel();
    wrongDimensions.width = 720;
    await expect(rewriteManagedCaptionSource(source, wrongDimensions)).rejects.toThrow("MANAGED_CAPTION_COMPOSITION_IDENTITY_CHANGED");
  });

  it("keeps script-breaking Unicode and markup-like strings inert", async () => {
    const model = buildCaptionModel([
      { id: "he<>", text: "שָׁלוֹם </ScRiPt><img onerror=alert(1)>", start: 0, end: 1 },
    ], { width: 640, height: 360, duration: 2 });
    const tag = await managedCaptionScriptTag(model);
    expect(tag).not.toContain("</ScRiPt>");
    expect(tag).not.toContain("<img");
    const source = '<div data-composition-id="captions" data-width="640" data-height="360" data-duration="2"></div>' + tag;
    expect((await rewriteManagedCaptionSource(source, model)).status).toBe("unchanged");
  });
});
