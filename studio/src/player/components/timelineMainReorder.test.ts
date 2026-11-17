import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { computeDragPreview } from "./timelineClipDragPreview";
import { commitDraggedClipMove, type TimelineMoveEdit } from "./timelineClipDragCommit";
import { planMainTrackReorder } from "./timelineMainReorder";
import { resolveMultiDragPreview } from "./timelineProviderStateBuilders";
import { multiDragPassengerOffsetPx } from "./timelineMultiDragPreview";
import { savedClipEdges } from "../store/timelineElement";
import { RULER_H, TRACKS_TOP_PAD, TRACK_H } from "./timelineLayout";

const clip = (id: string, start: number, duration = 5): TimelineElement => ({
  id, key: id, domId: id, tag: "video", track: 0, start, duration, sourceFile: "index.html",
});
const preview = (elements: TimelineElement[], aim: number) => {
  const element = elements.find(e => e.id === "ease")!;
  const y = RULER_H + TRACKS_TOP_PAD + TRACK_H / 2;
  return computeDragPreview({
    element, pointerId: 1, originClientX: 1000, originClientY: y,
    originScrollLeft: 0, originScrollTop: 0, pointerClientX: 1000, pointerClientY: y,
    pointerOffsetX: 20, pointerOffsetY: 20, previewStart: element.start,
    previewTrack: 0, insertRow: null, snapTime: null, snapType: null, started: true,
  }, 1000 + (aim - element.start) * 40, y, {
    scroll: null, pps: 40, duration: 30, trackOrder: [0, 1], elements,
    selectedKeys: new Set(), buildSnapTargets: () => [], rippleEditEnabled: true,
  });
};

describe("magnetic main-track reorder", () => {
  it("inserts the final clip between occupied clips and saves every shifted neighbor in one batch", () => {
    const elements = [clip("a", 0), clip("b", 5), clip("c", 10), clip("ease", 15)];
    const drag = preview(elements, 5);
    expect(drag).toMatchObject({ previewTrack: 0, previewStart: 5, insertRow: null });
    const onMoveElements = vi.fn();
    commitDraggedClipMove(drag, {
      elements, trackOrder: [0, 1], updateElement: vi.fn(), onMoveElements,
    });
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    expect(onMoveElements.mock.calls[0][0].map((e: TimelineMoveEdit) => [e.element.id, e.updates.start]))
      .toEqual([["ease", 5], ["b", 10], ["c", 15]]);
  });
  it("can move the first clip forward through an occupied lane", () => {
    const elements = [clip("ease", 0), clip("a", 5), clip("b", 10), clip("c", 15)];
    expect(preview(elements, 14)).toMatchObject({ previewStart: 10, previewTrack: 0, insertRow: null });
  });
});

const plan = (elements: TimelineElement[], aim = 5, linkage = false) => planMainTrackReorder(
  elements, elements.find(el => el.id === "ease")!, aim, new Set(["ease"]), linkage,
);

it("projects neighbors in the opposite direction from the grabbed clip", () => {
  const elements = [clip("a", 0), clip("b", 5), clip("c", 10), clip("ease", 15)];
  const drag = preview(elements, 5);
  const projection = resolveMultiDragPreview(drag, new Set(), elements)!;
  expect(multiDragPassengerOffsetPx("b", 40, projection)).toBe(200);
  expect(multiDragPassengerOffsetPx("c", 40, projection)).toBe(200);
  expect(multiDragPassengerOffsetPx("a", 40, projection)).toBe(0);
});

it("refuses the complete reorder when a locked neighbor would have to move", () => {
  const elements = [clip("a", 0), { ...clip("b", 5), timelineLocked: true }, clip("ease", 10)];
  expect(plan(elements)).toMatchObject({ start: 10, changes: [] });
});

it("carries overlays of each shifted host by that host's delta, leaving audio and locked overlays alone", () => {
  const title = { ...clip("title", 6, 1), track: -1 };
  const locked = { ...clip("locked", 6, 1), track: -1, timelineLocked: true };
  const audio = { ...clip("music", 0, 15), tag: "audio", track: 1 };
  const elements = [clip("a", 0), clip("b", 5), clip("ease", 10), title, locked, audio];
  expect(plan(elements, 5, true)?.changes.map(({ element, start }) => [element.id, start]))
    .toEqual([["ease", 5], ["b", 10], ["title", 11]]);
  expect(plan(elements)?.changes.map(({ element }) => element.id)).toEqual(["ease", "b"]);
});

it("keeps a manually selected group on the existing rigid-move path", () => {
  const elements = [clip("a", 0), clip("b", 5), clip("ease", 10)];
  expect(planMainTrackReorder(elements, elements[2], 0, new Set(["ease", "b"]), false)).toBeNull();
});

it("rolls every shifted clip back together when the atomic save fails", async () => {
  const elements = [clip("a", 0), clip("b", 5), clip("ease", 10)];
  const updateElement = vi.fn();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    commitDraggedClipMove(preview(elements, 5), {
      elements, trackOrder: [0, 1], updateElement,
      onMoveElements: () => Promise.reject(new Error("save rejected")),
    });
    await Promise.resolve(); await Promise.resolve();
    expect(updateElement).toHaveBeenCalledWith("ease", expect.objectContaining({ start: 10 }));
    expect(updateElement).toHaveBeenCalledWith("b", expect.objectContaining({ start: 5 }));
  } finally { error.mockRestore(); }
});

it("keeps fractional authored durations on one lane after centisecond persistence", () => {
  const elements = [clip("a", 0, 4.6666666667), clip("b", 4.6666666667, 3.1),
    clip("c", 7.7666666667, 2.9666666666), clip("reel", 10.7333333333, 8.5333333334),
    clip("ease", 19.2666666667, 4.3666666667)];
  const result = plan(elements, 10.8)!;
  const changes = new Map(result.changes.map(change => [change.element.id, change.start]));
  const saved = elements.map(element => ({ ...element,
    start: changes.has(element.id) ? savedClipEdges(element, changes.get(element.id)!).start : element.start,
  })).sort((a, b) => a.start - b.start);
  expect(changes.has("a")).toBe(false);
  expect(changes.has("b")).toBe(false);
  expect(changes.has("c")).toBe(false);
  for (let i = 1; i < saved.length; i++)
    expect(saved[i].start + 1e-6).toBeGreaterThanOrEqual(saved[i-1].start + saved[i-1].duration);
  expect(result.start).toBe(saved.find(element => element.id === "ease")!.start);
});

it("moves linked audio with a shifted neighbor and the grabbed clip in the same plan", () => {
  const b = { ...clip("b", 5), link: "b-link" };
  const ease = { ...clip("ease", 10), link: "ease-link" };
  const audioB = { ...clip("audio-b", 5), tag: "audio", track: 1, link: "b-link" };
  const audioEase = { ...clip("audio-ease", 10), tag: "audio", track: 1, link: "ease-link" };
  const elements = [clip("a", 0), b, ease, audioB, audioEase];
  const result = planMainTrackReorder(elements, ease, 5, new Set(["ease", "audio-ease"]), false)!;
  expect(result?.changes.map(change => [change.element.id, change.start])).toEqual([
    ["ease", 5], ["b", 10], ["audio-ease", 5], ["audio-b", 10],
  ]);
});

it("refuses a reorder if a shifted host has a locked linked audio partner", () => {
  const b = { ...clip("b", 5), link: "b-link" };
  const audio = { ...clip("audio-b", 5), tag: "audio", track: 1, link: "b-link", timelineLocked: true };
  expect(plan([clip("a", 0), b, clip("ease", 10), audio])).toMatchObject({ start: 10, changes: [] });
});

it("leaves media partners alone when linked selection is disabled", () => {
  const b = { ...clip("b", 5), link: "b-link" };
  const audio = { ...clip("audio-b", 5), tag: "audio", track: 1, link: "b-link" };
  const elements = [clip("a", 0), b, clip("ease", 10), audio];
  expect(planMainTrackReorder(elements, elements[2], 5, new Set(["ease"]), false, undefined, false)
    ?.changes.map(change => change.element.id)).toEqual(["ease", "b"]);
});

it("does not carry a same-named media link from another source composition", () => {
  const b = { ...clip("b", 5), link: "shared-name" };
  const audio = { ...clip("audio-b", 5), tag: "audio", track: 1, link: "shared-name", sourceFile: "other.html" };
  expect(plan([clip("a", 0), b, clip("ease", 10), audio])?.changes.map(change => change.element.id))
    .toEqual(["ease", "b"]);
});

it("saves the shifted neighbor's audio in the same atomic transaction", () => {
  const b = { ...clip("b", 5), link: "b-link" };
  const audio = { ...clip("audio-b", 5), tag: "audio", track: 1, link: "b-link" };
  const elements = [clip("a", 0), b, clip("ease", 10), audio];
  const drag = preview(elements, 5);
  const onMoveElements = vi.fn();
  commitDraggedClipMove(drag, { elements, trackOrder: [0, 1], updateElement: vi.fn(), onMoveElements });
  expect(onMoveElements).toHaveBeenCalledTimes(1);
  expect(onMoveElements.mock.calls[0][0].map((edit: TimelineMoveEdit) => [edit.element.id, edit.updates.start]))
    .toEqual([["ease", 5], ["b", 10], ["audio-b", 10]]);
});


it("refuses a companion floor crossing before saved timing can clamp away its sync offset", () => {
  const ease = clip("ease", 0);
  const a = { ...clip("a", 5), link: "a-link" };
  const audio = { ...clip("audio-a", 3), tag: "audio", track: 1, link: "a-link" };
  expect(planMainTrackReorder([ease, a, clip("b", 10), clip("c", 15), audio], ease, 14,
    new Set(["ease"]), false)).toMatchObject({ start: 0, changes: [] });
});


it("preserves authored transition overlaps by refusing the complete reorder", () => {
  const a = { ...clip("a", 0, 6), transitionLabel: "crossfade" };
  const b = { ...clip("b", 5), transitionLabel: "crossfade" };
  const ease = clip("ease", 10);
  const elements = [a, b, ease];
  const drag = preview(elements, 0);
  expect(drag).toMatchObject({ previewStart: 10, mainTrackReorder: { changes: [] } });
  const onMoveElements = vi.fn();
  commitDraggedClipMove(drag, { elements, trackOrder: [0, 1], updateElement: vi.fn(), onMoveElements });
  expect(onMoveElements).not.toHaveBeenCalled();
  expect(b.start - a.start).toBe(5);
});
