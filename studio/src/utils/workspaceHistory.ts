export const WORKSPACE_LOCATION_CHANGED = 'motion:workspace-location';
const entryKey = 'openmotionHistoryIndex';

export function workspaceHistoryIndex(): number | null {
  const value = history.state?.[entryKey];
  return Number.isSafeInteger(value) ? value : null;
}

export function initializeWorkspaceHistory() {
  if (workspaceHistoryIndex() === null) history.replaceState({ ...history.state, [entryKey]: 0 }, '', location.href);
}

/** Keep history identity when the editor updates its hash or the shell resolves a project. */
export function writeWorkspaceHistory(target: string | URL, replace = false) {
  const url = new URL(target, location.href);
  if (url.origin !== location.origin) throw new Error('Workspace navigation must stay on this origin');
  initializeWorkspaceHistory();
  const index = workspaceHistoryIndex()!;
  if (url.href !== location.href) {
    if (replace) history.replaceState({ ...history.state, [entryKey]: index }, '', url);
    else history.pushState({ [entryKey]: index + 1 }, '', url);
  }
  window.dispatchEvent(new Event(WORKSPACE_LOCATION_CHANGED));
}
