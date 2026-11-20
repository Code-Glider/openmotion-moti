// DOM helpers for CaptionOverlay — word box reading, transform I/O, wrapper management

export interface WordBox {
  segmentId: string;
  groupId: string;
  groupIndex: number;
  wordIndex: number;
  /** Plain-text ranges can be selected but not transformed as independent words. */
  editable: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}


/**
 * Map authored tokens to logical UTF-16 ranges. Chromium owns the visual BiDi
 * ordering and glyph shaping; this code never reverses or reconstructs text.
 * Refuse ambiguous text or a token boundary inside a grapheme cluster.
 */
export function mapCaptionTokenRanges(text: string, tokens: readonly string[]): Array<{ start: number; end: number }> | null {
  const boundaries = new Set([0, text.length]);
  for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    boundaries.add(index);
    boundaries.add(index + segment.length);
  }
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const token of tokens) {
    if (!token?.trim()) return null;
    const start = text.indexOf(token, cursor);
    if (start < 0 || text.slice(cursor, start).trim() || !boundaries.has(start) || !boundaries.has(start + token.length)) return null;
    const end = start + token.length;
    ranges.push({ start, end });
    cursor = end;
  }
  return text.slice(cursor).trim() ? null : ranges;
}

function groupWordElements(groupEl: HTMLElement): HTMLElement[] {
  const words: HTMLElement[] = [];
  for (const child of groupEl.children) {
    const element = child as HTMLElement;
    if (element.dataset.captionWrapper === "true") {
      const inner = element.querySelector<HTMLElement>(":scope > span");
      if (inner) words.push(inner);
    } else if (element.tagName === "SPAN") {
      words.push(element);
    }
  }
  return words;
}

type CaptionRect = Pick<DOMRect, "left" | "top" | "width" | "height">;

/** Read Range geometry without modifying author text or creating spans. */
function measurePlainGroup(groupEl: HTMLElement, tokens: string[]): CaptionRect[] {
  const doc = groupEl.ownerDocument;
  const walker = doc.createTreeWalker(groupEl, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const text = nodes.map(node => node.data).join("");
  const ranges = mapCaptionTokenRanges(text, tokens);
  if (!ranges || nodes.length === 0 || text !== groupEl.textContent) return [];
  const at = (offset: number): { node: Text; offset: number } | null => {
    for (const node of nodes) {
      if (offset <= node.length) return { node, offset };
      offset -= node.length;
    }
    return null;
  };
  const boxes: CaptionRect[] = [];
  for (const { start, end } of ranges) {
    const from = at(start), to = at(end);
    if (!from || !to) return [];
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const rects = typeof range.getClientRects === "function"
      ? Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0) : [];
    if (rects.length === 0) return [];
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    boxes.push({ left, top, width: right - left, height: bottom - top });
  }
  return boxes;
}

export function readWordBoxes(
  iframe: HTMLIFrameElement,
  model: {
    groupOrder: string[];
    groups: Map<string, { segmentIds: string[] }>;
    segments?: Map<string, { text: string }>;
  },
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

  const groupEls = doc.querySelectorAll<HTMLElement>(".caption-group");
  const boxes: WordBox[] = [];

  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const groupId = model.groupOrder[gi];
    const group = model.groups.get(groupId);
    if (!group) continue;
    const groupEl = groupEls[gi] as HTMLElement | undefined;
    if (!groupEl) continue;
    const computed = win.getComputedStyle(groupEl);
    if (parseFloat(computed.opacity) <= 0.01 || computed.visibility === "hidden") continue;
    const resolvedWordEls = groupWordElements(groupEl);
    const tokens = group.segmentIds.map(id => model.segments?.get(id)?.text);
    const plainRects = resolvedWordEls.length === 0 && tokens.every(
      (token): token is string => typeof token === "string",
    ) ? measurePlainGroup(groupEl, tokens as string[]) : [];
    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const segId = group.segmentIds[wi];
      const wordEl = resolvedWordEls[wi];
      const rect = wordEl?.getBoundingClientRect() ?? plainRects[wi];
      if (!rect) continue;
      boxes.push({
        segmentId: segId,
        groupId,
        groupIndex: gi,
        wordIndex: wi,
        editable: Boolean(wordEl),
        x: rect.left * cssScale + offsetX,
        y: rect.top * cssScale + offsetY,
        width: rect.width * cssScale,
        height: rect.height * cssScale,
      });
    }
  }
  return boxes;
}

export function getWordEl(
  iframe: HTMLIFrameElement,
  groupIndex: number,
  wordIndex: number,
): HTMLElement | null {
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;
  const groupEl = doc.querySelectorAll<HTMLElement>(".caption-group")[groupIndex];
  if (!groupEl) return null;
  return groupWordElements(groupEl)[wordIndex] ?? null;
}

/**
 * Read GSAP's internal transform state for an element.
 * GSAP stores transforms in its own cache, not in el.style.transform.
 */
export function readGsapTransform(
  el: HTMLElement,
  iframeWin: Window,
): { x: number; y: number; scale: number; rotation: number } {
  const gsap = (
    iframeWin as unknown as { gsap?: { getProperty?: (el: HTMLElement, prop: string) => number } }
  ).gsap;
  if (gsap && gsap.getProperty) {
    return {
      x: gsap.getProperty(el, "x") || 0,
      y: gsap.getProperty(el, "y") || 0,
      scale: gsap.getProperty(el, "scale") || 1,
      rotation: gsap.getProperty(el, "rotation") || 0,
    };
  }
  const t = el.style.transform || "";
  const scaleMatch = t.match(/scale\(([^)]+)\)/);
  const rotMatch = t.match(/rotate\(([^)]+)deg\)/);
  const txyMatch = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
  return {
    x: txyMatch ? parseFloat(txyMatch[1]) : 0,
    y: txyMatch ? parseFloat(txyMatch[2]) : 0,
    scale: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
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
) {
  const wrapper = getOrCreateWrapper(el);
  const gsap = (
    iframeWin as unknown as {
      gsap?: { set?: (el: HTMLElement, props: Record<string, number>) => void };
    }
  ).gsap;
  if (gsap && gsap.set) {
    gsap.set(wrapper, { x, y, scale, rotation });
  } else {
    wrapper.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
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
  segments: Map<string, { style: { x?: number; y?: number; scaleX?: number; rotation?: number } }>;
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
      const wordEl = getWordEl(iframe, gi, wi);
      if (!wordEl) continue;
      const s = seg.style;
      writeTransform(wordEl, win, s.x ?? 0, s.y ?? 0, s.scaleX ?? 1, s.rotation ?? 0);
    }
  }
}

/** Compute style deltas from the current wrapper transform — used by syncToStore in the overlay. */
export function computeTransformStyle(el: HTMLElement, iframeWin: Window): Record<string, number> {
  const wrapper = getOrCreateWrapper(el);
  const { x, y, scale, rotation } = readGsapTransform(wrapper, iframeWin);
  const style: Record<string, number> = {};
  if (Math.abs(x) > 0.5) style.x = x;
  if (Math.abs(y) > 0.5) style.y = y;
  if (Math.abs(scale - 1) > 0.001) {
    style.scaleX = scale;
    style.scaleY = scale;
  }
  if (Math.abs(rotation) > 0.1) style.rotation = rotation;
  return style;
}
