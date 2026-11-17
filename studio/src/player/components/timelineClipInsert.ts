import type { TimelineElement } from "../store/playerStore";
import { sameSourceFile } from "./timelineAuthoredTrack";
import { canMoveTimelineElement } from "./timelineAuthoredMoveTarget";
import { resolveGroupMovers, groupMoveFloor } from "./timelineMultiDragPreview";
import { heldAudioShiftRange, linkedMembersOf } from "./audioClipLink";
import { isLinkedSelectionOn } from "../../utils/linkedClipPreferences";
import { timelineSpansOverlap } from "./timelineTimeBounds";
import { classifyZone } from "./timelineZones";
import { toAuthoredStart, savedClipEdges } from "../store/timelineElement";

const keyOf = (element: TimelineElement) => element.key ?? element.id;
const savedStart = (el: TimelineElement, time: number) => savedClipEdges(el, time).start;
const after = (el: TimelineElement, time: number) =>
  time + (Math.ceil(toAuthoredStart(el, time) * 100 - 1e-6) / 100 - toAuthoredStart(el, time));

/** Insert between neighbours without requiring an empty clip-sized gap. */
export function previewClipInsert(
  elements: TimelineElement[], grabbed: TimelineElement, moving: ReadonlySet<string>,
  track: number, rawStart: number, pointerTime: number,
  linkedSelection = true,
): { start: number; insertion: ReadonlyMap<string, number> } | null {
  const lane = elements.filter(el => el.track === track && !moving.has(keyOf(el)))
    .sort((a, b) => a.start - b.start);
  if (lane.length < 2 || lane.some(el => !sameSourceFile(el, grabbed) || classifyZone(el) !== classifyZone(grabbed) ||
    el.expandedHostKey !== grabbed.expandedHostKey || el.timelineLocked)) return null;
  if (!lane.some(el => timelineSpansOverlap(rawStart, rawStart + grabbed.duration, el.start, el.start + el.duration))) return null;
  const rightIndex = lane.findIndex((right, index) => index > 0 &&
    pointerTime >= lane[index - 1].start + lane[index - 1].duration / 2 &&
    pointerTime <= right.start + right.duration / 2);
  if (rightIndex < 1 || lane.some((el, index) => index > 0 &&
    timelineSpansOverlap(lane[index - 1].start, lane[index - 1].start + lane[index - 1].duration, el.start, el.start + el.duration))) return null;
  const movers = elements.filter(el => moving.has(keyOf(el)));
  const block = movers.filter(el => el === grabbed || el.track === track);
  const blockStart = Math.min(grabbed.start, ...block.map(el => el.start));
  const blockEnd = Math.max(grabbed.start + grabbed.duration, ...block.map(el => el.start + el.duration));
  const leftEnd = lane[rightIndex - 1].start + lane[rightIndex - 1].duration;
  if (lane[rightIndex].start - leftEnd >= blockEnd - blockStart - 0.001) return null;
  const boundary = after(grabbed, leftEnd);
  const delta = boundary - blockStart;
  const shift = heldAudioShiftRange(movers, elements, moving);
  const start = savedStart(grabbed, grabbed.start + delta);
  if (start < groupMoveFloor(grabbed, movers) || delta < shift.min || delta > shift.max) return null;
  const insertion = new Map(movers.map(el => [keyOf(el), savedStart(el, el.start + delta)]));
  let end = Math.max(start + grabbed.duration, ...block.map(el => savedStart(el, el.start + delta) + el.duration));
  const following = lane.slice(rightIndex);
  // Resolve linkage once, rather than rescanning the whole timeline for every pushed clip.
  const passengers = resolveGroupMovers(elements, new Set(following.map(keyOf)), keyOf(following[0])) ?? following;
  const byHost = new Map(following.map(el => [keyOf(el), [el]]));
  const links = new Map<string, TimelineElement[]>();
  for (const el of elements) {
    if (!el.link) continue;
    const members = links.get(el.link) ?? [];
    members.push(el); links.set(el.link, members);
  }
  for (const el of passengers) {
    if (byHost.has(keyOf(el))) continue;
    let low = 0, high = following.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (following[mid].start <= el.start) low = mid + 1;
      else high = mid;
    }
    const host = following[low - 1];
    if (host && el.start < host.start + host.duration) byHost.get(keyOf(host))!.push(el);
  }
  for (const peer of following) {
    const next = Math.max(peer.start, after(peer, end));
    const push = next - peer.start;
    if (push > 0.001) {
      const passengers = [...new Set([...byHost.get(keyOf(peer))!,
        ...linkedMembersOf(peer, links.get(peer.link ?? "") ?? [peer], linkedSelection && isLinkedSelectionOn())])];
      const keys = new Set(passengers.map(keyOf));
      const bounds = heldAudioShiftRange(passengers, elements, keys);
      if (push > bounds.max || passengers.some(el => !canMoveTimelineElement(el) ||
        (el !== peer && el.track === track) || el.start + push < groupMoveFloor(el, [el]))) return null;
      for (const el of passengers) {
        const key = keyOf(el);
        if (moving.has(key)) return null;
        insertion.set(key, savedStart(el, el.start + push));
      }
    }
    end = next + peer.duration;
  }
  return { start, insertion };
}
