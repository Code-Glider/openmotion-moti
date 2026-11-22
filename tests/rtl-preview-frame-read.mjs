// Studio re-mounts its real player iframe after native project-history edits.
// Puppeteer may throw synchronously in its detached-frame decorator, before
// a promise exists for .catch(). Ignore only disposed/navigating contexts;
// the caller must still prove the exact expected Unicode within its deadline.
const TRANSIENT_FRAME_ERROR = /Attempted to use detached Frame|Execution context was destroyed|Cannot find context with specified id|Cannot find execution context/i;

export async function readLiveFrameText(frame, selector) {
  if (frame.detached) return null;
  try {
    return await frame.evaluate(
      selector => document.querySelector(selector)?.textContent ?? null,
      selector,
    );
  } catch (error) {
    if (frame.detached || TRANSIENT_FRAME_ERROR.test(String(error))) return null;
    throw error;
  }
}
