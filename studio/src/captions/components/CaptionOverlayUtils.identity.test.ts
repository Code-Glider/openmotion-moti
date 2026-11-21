// @vitest-environment jsdom
import { expect, it } from "vitest";
import { getWordEl, readWordBoxes } from "./CaptionOverlayUtils";

function authoredFrame(words: Array<{ segmentId: string; wordId?: string; text: string }>) {
  const iframe = document.createElement("iframe");
  const overlay = document.createElement("div");
  document.body.append(iframe, overlay);
  iframe.style.width = "640px";
  iframe.getBoundingClientRect = () => ({
    left: 20, top: 30, right: 660, bottom: 390, width: 640, height: 360,
    x: 20, y: 30, toJSON: () => ({}),
  } as DOMRect);
  const doc = iframe.contentDocument!;
  const group = doc.createElement("div");
  group.className = "caption-group";
  group.dataset.captionGroupId = "g";
  group.style.opacity = "1";
  doc.body.append(group);
  const model = {
    groupOrder: ["g"],
    groups: new Map([["g", { segmentIds: words.map((word) => word.segmentId) }]]),
    segments: new Map(words.map((word) => [
      word.segmentId, { text: word.text, wordId: word.wordId },
    ] as const)),
  };
  return {
    iframe, overlay, group, model,
    dispose: () => { iframe.remove(); overlay.remove(); },
  };
}

it("refuses reordered identical Hebrew words rather than editing the wrong stable identity", () => {
  const f = authoredFrame([
    { segmentId: "s1", wordId: "word-a", text: "שָׁלוֹם" },
    { segmentId: "s2", wordId: "word-b", text: "שָׁלוֹם" },
  ]);
  try {
    f.group.innerHTML = '<span id="word-b" class="word">שָׁלוֹם</span> <span id="word-a" class="word">שָׁלוֹם</span>';
    const nodes = [...f.group.childNodes];
    const html = f.group.innerHTML;
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBeNull();
    expect(getWordEl(f.iframe, 0, 1, f.model)).toBeNull();
    expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual([]);
    expect([...f.group.childNodes]).toEqual(nodes);
    expect(f.group.innerHTML).toBe(html);

    f.group.innerHTML = '<span id="word-a" class="word">שָׁלוֹם</span> <span id="word-b" class="word">שָׁלוֹם</span>';
    const boxes = readWordBoxes(f.iframe, f.model, f.overlay);
    expect(boxes.map((box) => [box.segmentId, box.editable])).toEqual([
      ["s1", true], ["s2", true],
    ]);
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBe(f.group.children[0]);
    expect(getWordEl(f.iframe, 0, 1, f.model)).toBe(f.group.children[1]);
  } finally { f.dispose(); }
});

it("rejects a missing or duplicated authored Arabic word ID without guessing timed-word targets", () => {
  const f = authoredFrame([
    { segmentId: "s1", wordId: "arabic-1", text: "السَّلَامُ" },
    { segmentId: "s2", wordId: "arabic-2", text: "السَّلَامُ" },
  ]);
  try {
    f.group.innerHTML = '<span class="word">السَّلَامُ</span> <span id="arabic-2" class="word">السَّلَامُ</span>';
    expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual([]);
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBeNull();

    f.group.innerHTML = '<span id="arabic-1" class="word">السَّلَامُ</span> <span id="arabic-2" class="word">السَّلَامُ</span>';
    f.model.segments.get("s2")!.wordId = "arabic-1";
    expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual([]);
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBeNull();
  } finally { f.dispose(); }
});

it("retains the positional legacy fallback when there are no authored identities", () => {
  const f = authoredFrame([
    { segmentId: "legacy-1", text: "שלום" },
    { segmentId: "legacy-2", text: "World" },
  ]);
  try {
    f.group.innerHTML = '<span class="word">שלום</span> <span class="word">World</span>';
    expect(readWordBoxes(f.iframe, f.model, f.overlay).map((box) => box.editable))
      .toEqual([true, true]);
    expect(getWordEl(f.iframe, 0, 1, f.model)).toBe(f.group.children[1]);
  } finally { f.dispose(); }
});


it("preserves a single legacy authored word without a DOM ID, including undo target lookup", () => {
  const f = authoredFrame([
    { segmentId: "legacy-0", wordId: "w0", text: "שָׁלוֹם" },
  ]);
  try {
    f.group.innerHTML = '<span class="word" style="transform:rotate(7deg)">שָׁלוֹם</span>';
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBe(f.group.children[0]);
    expect(readWordBoxes(f.iframe, f.model, f.overlay).map((box) => box.editable))
      .toEqual([true]);
  } finally { f.dispose(); }
});

it("keeps unique-IDless legacy captions editable but refuses repeated ambiguous unlabelled words", () => {
  const f = authoredFrame([
    { segmentId: "s1", wordId: "w1", text: "שלום" },
    { segmentId: "s2", wordId: "w2", text: "OpenMotion" },
  ]);
  try {
    f.group.innerHTML = '<span class="word">שלום</span> <span class="word">OpenMotion</span>';
    expect(readWordBoxes(f.iframe, f.model, f.overlay).map((box) => box.editable))
      .toEqual([true, true]);
    expect(getWordEl(f.iframe, 0, 1, f.model)).toBe(f.group.children[1]);

    // Text-only identity is no longer enough once two words are identical.
    f.model.segments.get("s2")!.text = "שלום";
    f.group.innerHTML = '<span class="word">שלום</span> <span class="word">שלום</span>';
    expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual([]);
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBeNull();
  } finally { f.dispose(); }
});
