import type { TimelineElement } from "../store/playerStore";
import { canMoveTimelineElement } from "./timelineAuthoredMoveTarget";
import { deriveTimelineTransitionSeams } from "./timelineTransitionSeams";
import { mainVisualTrack } from "./timelineLinkage";
import { linkedMembersOf } from "./audioClipLink";
import { classifyZone } from "./timelineZones";
import { createTimelineClipIndex, queryTimelineClipIndex } from "../lib/timelineClipIndex";
import { getTimelineElementIndexes } from "../lib/timelineElementIndexes";
import { clampToHostStart, savedClipEdges } from "../store/timelineElement";

export interface MainTrackReorder {
  slot: number;
  start: number;
  changes: readonly { element: TimelineElement; start: number }[];
}

const keyOf = (el: TimelineElement) => el.key ?? el.id;
const sources = new WeakMap<readonly TimelineElement[], ReturnType<typeof prepareSource>>();

/** Gesture-stable ownership is indexed once, not rediscovered for every shifted
 * host on every pointer frame. The shared interval index preserves half-open edges. */
function prepareSource(elements: readonly TimelineElement[]) {
  const main = mainVisualTrack(elements);
  const lane = elements.filter(el => el.track === main).sort((a, b) => a.start - b.start);
  const index = createTimelineClipIndex([[0, lane]]);
  const overlays = new Map<string, TimelineElement[]>();
  const links = new Map<string, TimelineElement[]>();
  for (const el of elements) {
    if (el.link) {
      const group = links.get(el.link) ?? [];
      group.push(el); links.set(el.link, group);
    }
    if (el.track === main || el.timelineLocked || classifyZone(el) !== "visual") continue;
    for (const host of queryTimelineClipIndex(index, 0, { start: el.start, end: el.start + 1e-6 })) {
      if (host.sourceFile !== el.sourceFile || el.start < host.start || el.start >= host.start + host.duration) continue;
      const owned = overlays.get(keyOf(host)) ?? [];
      owned.push(el); overlays.set(keyOf(host), owned);
    }
  }
  return { main, lane, overlays, links, hasTransitions: deriveTimelineTransitionSeams(lane).length > 0 };
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
  linkedSelection = true,
): MainTrackReorder | null {
  let source = sources.get(elements);
  if (!source) { source = prepareSource(elements); sources.set(elements, source); }
  const { main, lane, overlays, links } = source;
  const key = keyOf(grabbed);
  const byKey = getTimelineElementIndexes(elements).byKey;
  if (grabbed.track !== main || !byKey.has(key)) return null;
  const partnersOf = (host: TimelineElement) => linkedMembersOf(host, links.get(host.link ?? "") ?? [host], linkedSelection);
  const linked = new Set([key, ...(linkage ? overlays.get(key) ?? [] : []).map(keyOf), ...partnersOf(grabbed).map(keyOf)]);
  // A manually selected formation keeps its existing rigid group semantics.
  if ([...moving].some(member => !linked.has(member) || (member !== key && byKey.get(member)?.track === main))) return null;
  const peers = lane.filter(el => keyOf(el) !== key);
  let slot = peers.findIndex(el => aimedStart < el.start + el.duration / 2);
  if (slot < 0) slot = peers.length;
  if (previous && previous.slot !== slot) {
    const boundary = slot > previous.slot ? peers[slot - 1] : peers[slot];
    if (boundary && Math.abs(aimedStart - boundary.start - boundary.duration / 2) < previous.margin)
      slot = previous.slot;
  }
  if (slot === lane.findIndex(el => keyOf(el) === key)) return null;
  // Compaction cannot preserve authored transition overlaps. Refuse the whole
  // reorder rather than silently deleting a seam or separating its pair.
  if (source.hasTransitions) return { slot, start: grabbed.start, changes: [] };
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
  const planned = new Set(changes.map(change => keyOf(change.element)));
  const mainChanges = [...changes];
  for (const host of mainChanges) {
    const companions = [...(linkage ? overlays.get(keyOf(host.element)) ?? [] : []), ...partnersOf(host.element)];
    for (const element of companions) {
      const memberKey = keyOf(element);
      const delta = host.start - host.element.start;
      const target = element.start + delta;
      if (target < clampToHostStart(element, 0) - 1e-6)
        return { slot, start: grabbed.start, changes: [] };
      const start = savedClipEdges(element, target).start;
      if (element.track === main) {
        if (linkedSelection && partnersOf(host.element).some(partner => keyOf(partner) === memberKey) &&
            Math.abs((starts.get(memberKey) ?? element.start) - start) > 1e-6)
          return { slot, start: grabbed.start, changes: [] };
        continue;
      }
      if (planned.has(memberKey)) continue;
      if (!canMoveTimelineElement(element) || start < clampToHostStart(element, 0))
        return { slot, start: grabbed.start, changes: [] };
      changes.push({ element, start }); planned.add(memberKey);
    }
  }
  return { slot, start: starts.get(key)!, changes };
}
