import { splitCaptionWordRuns } from "./captionWordRuns";
// DOM helpers for CaptionOverlay — word box reading, transform I/O, wrapper management

export interface WordBox {
  segmentId: string;
  groupId: string;
  groupIndex: number;
  wordIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text ranges are selectable but must never be transformed as DOM elements. */
  editable: boolean;
}

/** A caption hit box must be refreshed when its geometry or word identity changes.
 * Subpixel jitter below half a CSS pixel is ignored, but a resized word or
 * a newly editable authored span must not leave stale overlay handles behind.
 */
export function sameWordBoxes(previous: readonly WordBox[], next: readonly WordBox[]): boolean {
  if (previous.length !== next.length) return false;
  return next.every((box, index) => {
    const before = previous[index];
    return before.segmentId === box.segmentId
      && before.groupId === box.groupId
      && before.groupIndex === box.groupIndex
      && before.wordIndex === box.wordIndex
      && before.editable === box.editable
      && Math.abs(before.x - box.x) < 0.5
      && Math.abs(before.y - box.y) < 0.5
      && Math.abs(before.width - box.width) < 0.5
      && Math.abs(before.height - box.height) < 0.5;
  });
}

interface CaptionHitModel {
  groupOrder: string[];
  groups: Map<string, { segmentIds: string[] }>;
  segments: Map<string, { text: string; wordId?: string }>;
}

function groupWords(model: CaptionHitModel, groupId: string): string[] | null {
  const group = model.groups.get(groupId);
  if (!group) return null;
  const words = group.segmentIds.map((id) => model.segments.get(id)?.text);
  if (words.some((word) => !word?.trim())) return null;
  return words as string[];
}

/**
 * Only one-to-one direct spans are transform targets. A styled span around a
 * whole sentence is not a word, even when it happens to be the first child.
 */
function directWordElements(
  groupEl: HTMLElement,
  words: readonly string[],
  expectedIds: readonly (string | undefined)[],
): HTMLElement[] | null {
  if (Array.from(groupEl.childNodes).some((node) =>
    node.nodeType === 3 && Boolean(node.textContent?.trim()))) return [];
  const children = Array.from(groupEl.children) as HTMLElement[];
  if (children.length !== words.length) return [];
  const candidates = children.map((child) =>
    child.dataset.captionWrapper === "true"
      ? child.querySelector<HTMLElement>(":scope > span")
      : child.tagName === "SPAN" ? child : null,
  );
  // If the model has authored identities, positional text equality is not enough:
  // repeated identical words could be reordered or recycled in the preview.
  // Refuse the entire hit mapping rather than selecting or transforming the
  // wrong saved word. Unidentified legacy spans keep their existing fallback.
  const named = expectedIds.filter((id): id is string => Boolean(id));
  if (new Set(named).size !== named.length) return null;
  // Current generated captions carry wordId as a DOM ID. Older authored
  // projects may have *no* IDs on their word spans: retain editing only when
  // text makes positional identity unambiguous. Never guess between identical
  // unlabelled words or accept partially missing generated IDs.
  const hasDomIds = candidates.some((el) => Boolean(el?.id));
  // A partially identified model cannot safely pair an unnamed sibling
  // with a named DOM word, especially when the visible words are identical.
  // A fully anonymous legacy model retains its positional fallback.
  if (hasDomIds && named.length > 0 && named.length !== expectedIds.length) return null;
  if (hasDomIds && candidates.some((el, index) => expectedIds[index] && el?.id !== expectedIds[index])) return null;
  if (!hasDomIds && named.length && new Set(words.map((word) => word.trim())).size !== words.length) return null;
  if (candidates.some((el, index) => !el || el.textContent?.trim() !== words[index].trim())) return [];
  return candidates as HTMLElement[];
}

/**
 * Read-only Range geometry for legacy text and styled markup. Timed words must
 * match the complete original logical Unicode text, including spacing. Browser
 * layout resolves BiDi and shaping; we neither reverse characters nor rewrite
 * a text node during measurement.
 */
function measureTextRuns(groupEl: HTMLElement, words: string[]): DOMRect[] {
  const doc = groupEl.ownerDocument;
  const walker = doc.createTreeWalker(groupEl, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest("script, style, [hidden]")) nodes.push(node as Text);
  }
  if (nodes.length === 0) return [];
  const text = nodes.map((node) => node.data).join("");
  const runs = splitCaptionWordRuns(text, words);
  if (!runs) return [];

  const boundaries = new Set<number>([0, text.length]);
  for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    boundaries.add(index);
    boundaries.add(index + segment.length);
  }

  const positions: Array<[number, number]> = [];
  let cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const nonspaceOffset = runs[i].search(/\S/u);
    if (nonspaceOffset < 0) return [];
    const start = cursor + nonspaceOffset;
    const end = start + words[i].length;
    if (!boundaries.has(start) || !boundaries.has(end)) return [];
    positions.push([start, end]);
    cursor += runs[i].length;
  }

  const locate = (offset: number, afterBoundary: boolean): [Text, number] => {
    let remaining = offset;
    for (const node of nodes) {
      if (remaining < node.length || (!afterBoundary && remaining === node.length)) {
        return [node, remaining];
      }
      remaining -= node.length;
    }
    const last = nodes[nodes.length - 1];
    return [last, last.length];
  };
  try {
    return positions.map(([start, end]) => {
      const [startNode, startOffset] = locate(start, true);
      const [endNode, endOffset] = locate(end, false);
      const range = doc.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      if (rects.length === 0) throw new Error("CAPTION_RANGE_NOT_LAID_OUT");
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return { left, top, width: right - left, height: bottom - top } as DOMRect;
    });
  } catch {
    // Non-layout test DOMs and hidden text return no hit targets, not fake ones.
    return [];
  }
}

/**
 * Generated captions carry their exact group ID so an empty/omitted group
 * cannot shift a later group's word hit targets onto the wrong DOM element.
 * Unlabelled legacy compositions retain positional lookup. If any IDs are
 * present, missing or duplicate IDs fail closed instead of guessing.
 */
function captionGroupLookup(doc: Document): (groupId: string, index: number) => HTMLElement | null {
  const groupEls = Array.from(doc.querySelectorAll<HTMLElement>(".caption-group"));
  const identified = new Map<string, HTMLElement | null>();
  let hasIdentifiers = false;
  for (const groupEl of groupEls) {
    if (!groupEl.hasAttribute("data-caption-group-id")) continue;
    hasIdentifiers = true;
    const id = groupEl.dataset.captionGroupId ?? "";
    identified.set(id, identified.has(id) ? null : groupEl);
  }
  return (groupId, index) =>
    hasIdentifiers ? identified.get(groupId) ?? null : groupEls[index] ?? null;
}

/** Overlay hit targets must respect the full preview visibility ancestry.
 * Styles on a parent are not reflected in getComputedStyle(child). In
 * particular, opacity is not inherited, while a descendant still has a
 * measurable DOMRect inside an opacity:0 container.
 */
function isCaptionHitVisible(groupEl: HTMLElement, win: Window): boolean {
  for (let el: HTMLElement | null = groupEl; el; el = el.parentElement) {
    if (el.hidden || el.hasAttribute("inert")) return false;
    const style = win.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    const opacity = parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.01) return false;
  }
  return true;
}

export function readWordBoxes(
  iframe: HTMLIFrameElement,
  model: CaptionHitModel,
  overlayEl: HTMLElement,
): WordBox[] {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return [];
  }
  if (!doc || !win) return [];

  const iframeDisplayRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const nativeW = parseFloat(iframe.style.width) || iframeDisplayRect.width;
  const cssScale = iframeDisplayRect.width / nativeW;
  const offsetX = iframeDisplayRect.left - overlayRect.left;
  const offsetY = iframeDisplayRect.top - overlayRect.top;

  const captionGroupAt = captionGroupLookup(doc);
  const boxes: WordBox[] = [];

  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const groupId = model.groupOrder[gi];
    const group = model.groups.get(groupId);
    if (!group) continue;
    const groupEl = captionGroupAt(groupId, gi);
    if (!groupEl) continue;
    // A group can have visible children in the DOM while an ancestor is
    // hidden/inert or a caption animation has faded its container out.
    // Do not expose invisible words as selectable/transformable overlay hits.
    if (!isCaptionHitVisible(groupEl, win)) continue;
    const words = groupWords(model, groupId);
    if (!words) continue;

    const expectedIds = group.segmentIds.map((id) => model.segments.get(id)?.wordId);
    const elements = directWordElements(groupEl, words, expectedIds);
    if (elements === null) continue; // Conflicting authored identity: never guess by text.
    const rects = elements.length
      ? elements.map((wordEl) => wordEl.getBoundingClientRect())
      : measureTextRuns(groupEl, words);
    if (rects.length !== group.segmentIds.length) continue;

    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const rect = rects[wi];
      boxes.push({
        segmentId: group.segmentIds[wi],
        groupId,
        groupIndex: gi,
        wordIndex: wi,
        editable: elements.length > 0,
        x: rect.left * cssScale + offsetX,
        y: rect.top * cssScale + offsetY,
        width: rect.width * cssScale,
        height: rect.height * cssScale,
      });
    }
  }
  return boxes;
}

/** Return only a verified one-to-one DOM word, never a sentence-wide wrapper. */
export function getWordEl(
  iframe: HTMLIFrameElement,
  groupIndex: number,
  wordIndex: number,
  model: CaptionHitModel,
): HTMLElement | null {
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;
  const groupId = model.groupOrder[groupIndex];
  const words = groupId === undefined ? null : groupWords(model, groupId);
  if (!words) return null;
  const groupEl = captionGroupLookup(doc)(groupId, groupIndex);
  if (!groupEl) return null;
  const group = model.groups.get(groupId);
  if (!group) return null;
  const expectedIds = group.segmentIds.map((id) => model.segments.get(id)?.wordId);
  return directWordElements(groupEl, words, expectedIds)?.[wordIndex] ?? null;
}

/**
 * Read GSAP's internal transform state for an element.
 * GSAP stores transforms in its own cache, not in el.style.transform.
 */
export function readGsapTransform(
  el: HTMLElement,
  iframeWin: Window,
): { x: number; y: number; scale: number; scaleY: number; rotation: number } {
  const gsap = (
    iframeWin as unknown as { gsap?: { getProperty?: (el: HTMLElement, prop: string) => number } }
  ).gsap;
  // "scale" alone loses imported non-uniform word geometry. Preserve the X
  // alias for existing pointer math, while keeping the independent Y axis.
  const finiteOr = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  if (gsap?.getProperty) {
    const scale = finiteOr(gsap.getProperty(el, "scaleX"), finiteOr(gsap.getProperty(el, "scale"), 1));
    return {
      x: finiteOr(gsap.getProperty(el, "x"), 0),
      y: finiteOr(gsap.getProperty(el, "y"), 0),
      scale,
      scaleY: finiteOr(gsap.getProperty(el, "scaleY"), scale),
      rotation: finiteOr(gsap.getProperty(el, "rotation"), 0),
    };
  }
  const t = el.style.transform || "";
  const scaleMatch = t.match(/scale\(\s*([^,\s)]+)\s*(?:,\s*([^)]+))?\)/);
  const rotMatch = t.match(/rotate\(([^)]+)deg\)/);
  const txyMatch = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
  const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
  return {
    x: txyMatch ? parseFloat(txyMatch[1]) : 0,
    y: txyMatch ? parseFloat(txyMatch[2]) : 0,
    scale,
    scaleY: scaleMatch?.[2] ? parseFloat(scaleMatch[2]) : scale,
    rotation: rotMatch ? parseFloat(rotMatch[1]) : 0,
  };
}

/**
 * Get or create an inline-block wrapper span around a word element.
 * Transforms are applied to the wrapper so the word's GSAP animations are preserved.
 */
export function getOrCreateWrapper(el: HTMLElement): HTMLElement {
  if (el.dataset.captionWrapper === "true") return el;
  const parent = el.parentElement;
  if (parent && parent.dataset.captionWrapper === "true") return parent;
  const doc = el.ownerDocument;
  const wrapper = doc.createElement("span");
  wrapper.style.display = "inline-block";
  wrapper.dataset.captionWrapper = "true";
  el.parentNode?.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  return wrapper;
}

/**
 * Write transform values to a wrapper span around the word element.
 */
export function writeTransform(
  el: HTMLElement,
  iframeWin: Window,
  x: number,
  y: number,
  scale: number,
  rotation: number,
  scaleY = scale,
) {
  const wrapper = getOrCreateWrapper(el);
  const gsap = (
    iframeWin as unknown as {
      gsap?: { set?: (el: HTMLElement, props: Record<string, number>) => void };
    }
  ).gsap;
  if (gsap?.set) {
    gsap.set(wrapper, { x, y, scaleX: scale, scaleY, rotation });
  } else {
    // Uniform callers retain the original single-value scale syntax.
    const cssScale = scaleY === scale
      ? scale.toFixed(3)
      : `${scale.toFixed(3)}, ${scaleY.toFixed(3)}`;
    wrapper.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${cssScale})`;
  }
}

// ---------------------------------------------------------------------------
// Iframe registry — lets non-component code (undo/redo in useAppHotkeys)
// reapply a restored model's transforms to the live preview.
// ---------------------------------------------------------------------------

let registeredIframe: React.RefObject<HTMLIFrameElement | null> | null = null;

export function registerCaptionIframe(ref: React.RefObject<HTMLIFrameElement | null>): () => void {
  registeredIframe = ref;
  return () => {
    if (registeredIframe === ref) registeredIframe = null;
  };
}

/**
 * True when the caption preview iframe is mounted AND visible. The caption
 * store's isEditMode stays true while the preview is merely hidden, so hotkeys must not
 * route ⌘Z to the caption stack unless the user can see the captions the undo would change.
 */
export function isCaptionPreviewVisible(): boolean {
  const iframe = registeredIframe?.current;
  return Boolean(iframe?.isConnected && iframe.offsetParent !== null);
}

/** Reapply every segment's transform from a (restored) model to the preview DOM. */
export function applyCaptionModelToIframe(model: {
  groupOrder: string[];
  groups: Map<string, { segmentIds: string[] }>;
  segments: Map<string, { text: string; style: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number } }>;
}): void {
  const iframe = registeredIframe?.current;
  if (!iframe) return;
  let win: Window | null = null;
  try {
    win = iframe.contentWindow;
  } catch {
    return;
  }
  if (!win) return;
  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const group = model.groups.get(model.groupOrder[gi]);
    if (!group) continue;
    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const seg = model.segments.get(group.segmentIds[wi]);
      if (!seg) continue;
      const wordEl = getWordEl(iframe, gi, wi, model);
      if (!wordEl) continue;
      const s = seg.style;
      // Undo/redo can visit every segment, including visually identical words
      // that were never edited. Do not wrap or otherwise mutate untouched
      // authored DOM for a neutral transform; an existing wrapper still needs
      // a neutral write to clear an earlier move/scale/rotation on undo.
      const neutral = (s.x ?? 0) === 0 && (s.y ?? 0) === 0
        && (s.scaleX ?? 1) === 1 && (s.scaleY ?? 1) === 1
        && (s.rotation ?? 0) === 0;
      const hasWrapper = wordEl.dataset.captionWrapper === "true"
        || wordEl.parentElement?.dataset.captionWrapper === "true";
      if (neutral && !hasWrapper) continue;
      writeTransform(wordEl, win, s.x ?? 0, s.y ?? 0, s.scaleX ?? 1, s.rotation ?? 0, s.scaleY ?? 1);
    }
  }
}

/** Include neutral values so merging into saved style clears earlier transforms. */
export function computeTransformStyle(el: HTMLElement, iframeWin: Window): Record<string, number> {
  const wrapper = getOrCreateWrapper(el);
  const { x, y, scale, scaleY, rotation } = readGsapTransform(wrapper, iframeWin);
  return { x, y, scaleX: scale, scaleY, rotation };
}
