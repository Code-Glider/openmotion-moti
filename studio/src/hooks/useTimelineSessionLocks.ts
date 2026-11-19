import { useEffect, useRef } from 'react';
import type { TimelineElement } from '../player/store/timelineElement';
import type { TimelineEditCallbacks } from '../player/components/timelineCallbacks';
import { findTimelineElementInIframe } from './timelineEditingHelpers';

type Input = {
  projectId: string | null;
  activeCompPath: string | null;
  elements: readonly TimelineElement[];
  iframe: HTMLIFrameElement | null;
  ready: boolean;
  save: NonNullable<TimelineEditCallbacks['onSetElementsAttributeQuiet']>;
};

/** Locks protect one editing session; a new Studio page releases the previous session's locks.
 * Use the ordinary queued, conflict-checked source save so captions and public operations
 * observe the same unlocked state. Preview reloads inside this page keep newly applied locks.
 */
export function useTimelineSessionLocks({ projectId, activeCompPath, elements, iframe, ready, save }: Input) {
  const initialized = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || !projectId || !iframe || !elements.length) return;
    const key = JSON.stringify([projectId, activeCompPath || 'index.html']);
    if (initialized.current.has(key)) return;
    const resolved = elements.map(element => ({ element,
      node: findTimelineElementInIframe(iframe, element, activeCompPath) }));
    // Wait for the actual composition document, rather than consuming the first empty iframe.
    if (!resolved.some(item => item.node)) return;
    initialized.current.add(key);
    const locked = resolved.filter(({ element, node }) => element.timelineLocked || node?.hasAttribute('data-timeline-locked'));
    if (!locked.length) return;
    // The save path reports failures and only patches DOM/store after a successful write.
    void save(locked.map(({ element }) => ({ element, value: null })), 'data-timeline-locked', 'Release previous session track locks');
  }, [projectId, activeCompPath, elements, iframe, ready, save]);
}
