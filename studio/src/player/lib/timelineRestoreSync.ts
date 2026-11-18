import { normalizeToZones } from "../components/timelineZones";
import { usePlayerStore } from "../store/playerStore";
import { getTimelineElementIdentity, parseTimelineFromDOM, readTimelineDurationFromDocument } from "./timelineDOM";

const TIMING_FIELDS = ["start", "duration", "playbackStart", "playbackStartAttr", "playbackRate", "parentCompositionStart", "authoredStartIsMasterTime"] as const;

/** A soft restore already changed the preview DOM. Update existing clips through
 * the normal DOM parser now instead of waiting for the runtime's next manifest.
 * Structural restores still reload and discover their complete element set. */
export function syncRestoredTimelineFromPreview(doc: Document | null | undefined): void {
  if (!doc) return;
  const duration = readTimelineDurationFromDocument(doc) || usePlayerStore.getState().duration;
  const parsed = new Map(parseTimelineFromDOM(doc, duration).map(element => [getTimelineElementIdentity(element), element]));
  usePlayerStore.setState(state => {
    let changed = false;
    const elements = state.elements.map(element => {
      const restored = parsed.get(getTimelineElementIdentity(element));
      if (!restored) return element;
      const authoredTrack = restored.authoredTrack ?? restored.track;
      if (TIMING_FIELDS.every(key => element[key] === restored[key]) && (element.authoredTrack ?? element.track) === authoredTrack) return element;
      changed = true;
      return { ...element, ...Object.fromEntries(TIMING_FIELDS.map(key => [key, restored[key]])), authoredTrack };
    });
    return {
      ...(changed ? { elements: normalizeToZones(elements.map(element => ({ ...element, track: element.authoredTrack ?? element.track }))) } : {}),
      ...(duration > 0 && duration !== state.duration && { duration }),
    };
  });
}
