// Studio re-mounts its real player iframe after native project-history edits.
// Puppeteer may throw synchronously in its detached-frame decorator, before
// a promise exists for .catch(). Ignore only disposed/navigating contexts;
// the caller must still prove the exact expected Unicode within its deadline.
const TRANSIENT_FRAME_ERROR = /Attempted to use detached Frame|Execution context was destroyed|Cannot find context with specified id|Cannot find execution context|Execution context is not available in detached frame or worker/i;

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


// Sample all authored rows in a single document evaluation. Never assemble a
// passing receipt from individual rows of different player iframe generations.
export async function readLiveFrameTexts(frame, selectors) {
  if (frame.detached) return null;
  try {
    const result = await frame.evaluate(
      selectors => Object.fromEntries(selectors.map(selector =>
        [selector, document.querySelector(selector)?.textContent ?? null])),
      selectors,
    );
    return frame.detached ? null : result;
  } catch (error) {
    if (frame.detached || TRANSIENT_FRAME_ERROR.test(String(error))) return null;
    throw error;
  }
}

export async function waitForLiveFrameTexts(page, expected, {
  timeoutMs = 20_000, pollMs = 200, label = 'Studio preview',
} = {}) {
  const selectors = Object.keys(expected);
  if (!selectors.length) throw new Error('Expected at least one authored preview row');
  const deadline = Date.now() + timeoutMs;
  let last = null;
  do {
    for (const frame of page.frames()) {
      const actual = await readLiveFrameTexts(frame, selectors);
      if (!actual || !selectors.some(selector => actual[selector] !== null)) continue;
      last = actual;
      if (selectors.every(selector => actual[selector] === expected[selector])) return actual;
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  } while (Date.now() < deadline);
  throw new Error(label + ' did not reach exact authored Unicode in one live player: expected '
    + JSON.stringify(expected) + '; last snapshot ' + JSON.stringify(last));
}
