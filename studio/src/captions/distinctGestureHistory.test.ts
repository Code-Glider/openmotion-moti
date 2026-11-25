// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { buildCaptionModel } from "./parser";
import { useCaptionStore } from "./store";

afterEach(() => {
  useCaptionStore.getState().reset();
  vi.restoreAllMocks();
});

it("keeps independent fast pointer gestures reversible while preserving nudge coalescing", () => {
  vi.spyOn(Date, "now").mockReturnValue(10_000);
  const model = buildCaptionModel([
    { id: "word-he", text: "שָׁלוֹם", start: 0, end: 1 },
  ], { width: 640, height: 360, duration: 2 });
  const segmentId = model.groups.get(model.groupOrder[0])!.segmentIds[0];
  const store = useCaptionStore.getState();
  store.reset();
  store.setModel(model);

  const edit = (x: number, distinctHistory = false) =>
    useCaptionStore.getState().updateSegmentStyle(segmentId, { x }, { distinctHistory });
  const history = () => useCaptionStore.getState().past.length;
  const x = () => useCaptionStore.getState().model!.segments.get(segmentId)!.style.x;

  // Keyboard arrows within the same 800ms window intentionally coalesce.
  edit(1);
  edit(2);
  expect(history()).toBe(1);
  expect(x()).toBe(2);

  // Each completed pointer gesture stands on its own even at identical time.
  edit(3, true);
  edit(4, true);
  expect(history()).toBe(3);
  expect(x()).toBe(4);

  // A subsequent keyboard action must not be swallowed by the last drag.
  edit(5);
  edit(6);
  expect(history()).toBe(4);
  expect(x()).toBe(6);

  for (const expected of [4, 3, 2, undefined]) {
    expect(useCaptionStore.getState().undo()).not.toBeNull();
    expect(x()).toBe(expected);
  }
  expect(useCaptionStore.getState().undo()).toBeNull();
  for (const expected of [2, 3, 4, 6]) {
    expect(useCaptionStore.getState().redo()).not.toBeNull();
    expect(x()).toBe(expected);
  }
});
