// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { trackedRoot, cleanupMounted } from '../components/ui/mountHost.testHelpers';
import { useTimelineSessionLocks } from './useTimelineSessionLocks';
import type { TimelineElement } from '../player/store/timelineElement';

const clip: TimelineElement = { id: 'cue', domId: 'cue', tag: 'div', start: 0, duration: 1, track: 0 };
afterEach(() => { cleanupMounted(); document.body.innerHTML = ''; });
function mountHost(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host);
  const root = trackedRoot(host); act(() => root.render(element)); return { root };
}
function setup() {
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML = '<div id="cue" data-timeline-locked>Keep captions</div>';
  const state = { projectId: 'p1', activeCompPath: 'index.html', elements: [clip], iframe, ready: true,
    save: vi.fn(async () => ({ status: 'saved' as const })) };
  function Probe() { useTimelineSessionLocks(state); return null; }
  return { state, Probe };
}
it('releases saved caption locks once per page even when discovery starts unlocked', async () => {
  const { state, Probe } = setup();
  const host = mountHost(<Probe />); await act(async () => {});
  expect(state.save).toHaveBeenCalledExactlyOnceWith([{ element: clip, value: null }], 'data-timeline-locked', 'Release previous session track locks');
  state.elements = [{ ...clip, timelineLocked: true }];
  await act(async () => host.root.render(<Probe />));
  expect(state.save).toHaveBeenCalledTimes(1);
});
it('waits for an editable ready document and releases again only in a new page', async () => {
  const { state, Probe } = setup(); state.ready = false;
  const host = mountHost(<Probe />); await act(async () => {});
  expect(state.save).not.toHaveBeenCalled();
  state.ready = true; await act(async () => host.root.render(<Probe />));
  expect(state.save).toHaveBeenCalledTimes(1);
  cleanupMounted(); mountHost(<Probe />); await act(async () => {});
  expect(state.save).toHaveBeenCalledTimes(2);
});
it('keeps a fresh page without saved locks read-only until the user locks a track', async () => {
  const { state, Probe } = setup(); state.iframe.contentDocument!.getElementById('cue')!.removeAttribute('data-timeline-locked');
  const host = mountHost(<Probe />); await act(async () => {});
  state.elements = [{ ...clip, timelineLocked: true }];
  state.iframe.contentDocument!.getElementById('cue')!.setAttribute('data-timeline-locked', '');
  await act(async () => host.root.render(<Probe />));
  expect(state.save).not.toHaveBeenCalled();
});
