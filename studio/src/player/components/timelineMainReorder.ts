import type { TimelineElement } from "../store/playerStore";
import { canMoveTimelineElement } from "./timelineAuthoredMoveTarget";
import { linkedOverlayKeys, mainVisualTrack } from "./timelineLinkage";
import { clampToHostStart, savedClipEdges } from "../store/timelineElement";

export interface MainTrackReorder {
  slot: number;
  start: number;
  changes: readonly { element: TimelineElement; start: number }[];
}

/** Insert a main clip between its peers, rather than looking for an empty gap.
 * The frozen source snapshot owns both the live projection and the atomic save. */
export function planMainTrackReorder(
  elements: readonly TimelineElement[],
  grabbed: TimelineElement,
  aimedStart: number,
  moving: ReadonlySet<string>,
  linkage: boolean,
  previous?: { slot: number; margin: number },
): MainTrackReorder | null {
  const keyOf = (el: TimelineElement) => el.key ?? el.id;
  const key = keyOf(grabbed);
  const main = mainVisualTrack(elements);
  if (grabbed.track !== main || !elements.some(el => keyOf(el) === key)) return null;
  const linked = linkedOverlayKeys(elements, key, null, linkage);
  // A manually selected formation keeps its existing rigid group semantics.
  if ([...moving].some(member => !linked.has(member))) return null;
  const lane = elements.filter(el => el.track === main).sort((a, b) => a.start - b.start);
  const peers = lane.filter(el => keyOf(el) !== key);
  let slot = peers.findIndex(el => aimedStart < el.start + el.duration / 2);
  if (slot < 0) slot = peers.length;
  if (previous && previous.slot !== slot) {
    const boundary = slot > previous.slot ? peers[slot - 1] : peers[slot];
    if (boundary && Math.abs(aimedStart - boundary.start - boundary.duration / 2) < previous.margin)
      slot = previous.slot;
  }
  if (slot === lane.findIndex(el => keyOf(el) === key)) return null;
  const ordered = [...peers.slice(0, slot), grabbed, ...peers.slice(slot)];
  const starts = new Map<string, number>();
  let cursor = Math.max(0, ...lane.map(el => clampToHostStart(el, 0)));
  for (const el of ordered) {
    // Unchanged fractional edges must keep their exact authored start. Moves
    // save to centiseconds: round forward when rounding down would overlap a
    // neighbor, otherwise discovery spills that clip into a second lane.
    let start = Math.abs(cursor - el.start) < 1e-6 ? el.start : savedClipEdges(el, cursor).start;
    if (start < cursor - 1e-6) start = savedClipEdges(el, cursor + 0.01).start;
    starts.set(keyOf(el), start);
    cursor = start + el.duration;
  }
  // Keep the grabbed clip first in the transaction; its peers retain lane order.
  const changes = [grabbed, ...peers].flatMap(element => {
    const start = starts.get(keyOf(element))!;
    return Math.abs(start - element.start) > 1e-6 ? [{ element, start }] : [];
  });
  if (changes.some(change => !canMoveTimelineElement(change.element)))
    return { slot, start: grabbed.start, changes: [] };
  if (linkage) {
    const mainChanges = [...changes];
    for (const host of mainChanges) {
      const overlays = linkedOverlayKeys(elements, keyOf(host.element), null, true);
      for (const element of elements) {
        if (element.track === main || !overlays.has(keyOf(element))) continue;
        if (changes.some(change => keyOf(change.element) === keyOf(element))) continue;
        const start = savedClipEdges(element, element.start + host.start - host.element.start).start;
        if (!canMoveTimelineElement(element) || start < clampToHostStart(element, 0))
          return { slot, start: grabbed.start, changes: [] };
        changes.push({ element, start });
      }
    }
  }
  return { slot, start: starts.get(key)!, changes };
}
