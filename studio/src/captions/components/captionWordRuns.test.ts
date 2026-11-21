// @vitest-environment jsdom
import { expect, it } from "vitest";
import { splitCaptionWordRuns } from "./captionWordRuns";
import { readWordBoxes, getWordEl, sameWordBoxes, readGsapTransform, getOrCreateWrapper, writeTransform, computeTransformStyle, registerCaptionIframe, applyCaptionModelToIframe, type WordBox } from "./CaptionOverlayUtils";

it("clears every saved transform when an authored word returns to neutral", () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  try {
    const word = iframe.contentDocument!.createElement("span");
    word.textContent = "السَّلَامُ";
    iframe.contentDocument!.body.append(word);
    const win = iframe.contentWindow!;
    writeTransform(word, win, 12, -8, 1.25, 30);
    const previous = computeTransformStyle(word, win);
    writeTransform(word, win, 0, 0, 1, 0);
    expect({ ...previous, ...computeTransformStyle(word, win) }).toEqual({
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    });
  } finally { iframe.remove(); }
});

it("retains exact Hebrew whitespace and logical word order", () => {
  const text = "  שלום\t  עולם!\n";
  const runs = splitCaptionWordRuns(text, ["שלום", "עולם!"]);
  expect(runs).toEqual(["  שלום\t  ", "עולם!\n"]);
  expect(runs?.join("")).toBe(text);
});

it("preserves Arabic combining marks and mixed-script punctuation", () => {
  const text = "السَّلَامُ  OpenMotion 2.0!";
  const runs = splitCaptionWordRuns(text, ["السَّلَامُ", "OpenMotion", "2.0!"]);
  expect(runs?.join("")).toBe(text);
  expect(runs?.map((run) => run.trim())).toEqual(["السَّلَامُ", "OpenMotion", "2.0!"]);
});

it("does not guess when timed tokens cannot match visible text", () => {
  expect(splitCaptionWordRuns("שלום עולם", ["שלום"])).toBeNull();
  expect(splitCaptionWordRuns("שלום עולם", ["עולם", "שלום"])).toBeNull();
  expect(splitCaptionWordRuns("שלום עולם", ["שלום", "different"])).toBeNull();
  expect(splitCaptionWordRuns("こんにちは世界", ["こんにちは", "世界"])).toBeNull();
  expect(splitCaptionWordRuns("בּית", ["ב", "ּית"])).toBeNull();
  expect(splitCaptionWordRuns("   ", [""])).toBeNull();
});

function captionFrame(text: string, expected: string[]) {
  const iframe = document.createElement("iframe");
  const overlay = document.createElement("div");
  document.body.append(iframe, overlay);
  const doc = iframe.contentDocument!;
  const group = doc.createElement("div");
  group.className = "caption-group";
  group.dir = "rtl";
  group.style.opacity = "1";
  group.textContent = text;
  doc.body.append(group);
  iframe.style.width = "640px";
  iframe.getBoundingClientRect = () => ({
    left: 20, top: 30, right: 660, bottom: 390, width: 640, height: 360,
    x: 20, y: 30, toJSON: () => ({}),
  } as DOMRect);
  const ids = expected.map((_, index) => "s" + index);
  const model = {
    groupOrder: ["group-0"],
    groups: new Map([["group-0", { segmentIds: ids }]]),
    segments: new Map(ids.map((id, index) => [id, { text: expected[index] }])),
  };
  return { iframe, overlay, group, model, doc, dispose: () => { iframe.remove(); overlay.remove(); } };
}

/** jsdom does not lay out text; mock only Range geometry, not Range boundaries. */
function withRangeGeometry(doc: Document, action: (observed: string[]) => void) {
  const proto = Object.getPrototypeOf(doc.createRange()) as object;
  const prior = Object.getOwnPropertyDescriptor(proto, "getClientRects");
  const observed: string[] = [];
  Object.defineProperty(proto, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      const text = this.toString();
      observed.push(text);
      return [{
        left: 12, top: 24, right: 12 + text.length * 10, bottom: 40,
        width: text.length * 10, height: 16,
      }];
    },
  });
  try { action(observed); } finally {
    if (prior) Object.defineProperty(proto, "getClientRects", prior);
    else Reflect.deleteProperty(proto, "getClientRects");
  }
}

it("measures Hebrew and Latin text twice without changing any authored node", () => {
  const text = "  שלום  World 2026!\n";
  const f = captionFrame(text, ["שלום", "World", "2026!"]);
  try {
    const originalHTML = f.group.innerHTML;
    const originalNode = f.group.firstChild;
    withRangeGeometry(f.doc, (observed) => {
      const boxes = readWordBoxes(f.iframe, f.model, f.overlay);
      expect(boxes.map((box) => box.segmentId)).toEqual(["s0", "s1", "s2"]);
      expect(boxes.every((box) => !box.editable)).toBe(true);
      expect(boxes[0]).toMatchObject({ x: 32, y: 54, width: 40, height: 16 });
      expect(getWordEl(f.iframe, 0, 1, f.model)).toBeNull();
      expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual(boxes);
      expect(observed).toEqual(["שלום", "World", "2026!", "שלום", "World", "2026!"]);
    });
    expect(f.group.innerHTML).toBe(originalHTML);
    expect(f.group.firstChild).toBe(originalNode);
    expect(f.group.children).toHaveLength(0);
    expect(f.group.textContent).toBe(text);
  } finally { f.dispose(); }
});

it("measures mixed nested markup without destroying the styled span", () => {
  const f = captionFrame("שלום עולם!", ["שלום", "עולם!"]);
  try {
    f.group.innerHTML = '<span style="font-weight:700">שלום <b>עולם</b>!</span>';
    const child = f.group.firstChild, markup = f.group.innerHTML;
    withRangeGeometry(f.doc, (observed) => {
      const boxes = readWordBoxes(f.iframe, f.model, f.overlay);
      expect(boxes).toHaveLength(2);
      expect(boxes.every((box) => !box.editable)).toBe(true);
      expect(observed).toEqual(["שלום", "עולם!"]);
    });
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBeNull();
    expect(f.group.firstChild).toBe(child);
    expect(f.group.innerHTML).toBe(markup);
  } finally { f.dispose(); }
});

it("keeps one-to-one authored word spans transformable and in the same order", () => {
  const f = captionFrame("שלום World", ["שלום", "World"]);
  try {
    f.group.innerHTML = '<span class="word">שלום</span><span class="word">World</span>';
    const authored = [...f.group.children];
    const boxes = readWordBoxes(f.iframe, f.model, f.overlay);
    expect(boxes.map((box) => box.editable)).toEqual([true, true]);
    expect(getWordEl(f.iframe, 0, 1, f.model)).toBe(authored[1]);
    expect([...f.group.children]).toEqual(authored);
  } finally { f.dispose(); }
});

it("rejects mismatched segment text instead of corrupting or transforming markup", () => {
  const f = captionFrame("שלום עולם", ["שלום", "wrong"]);
  try {
    const markup = f.group.innerHTML;
    expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual([]);
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBeNull();
    expect(f.group.innerHTML).toBe(markup);
    expect(f.group.childNodes).toHaveLength(1);
  } finally { f.dispose(); }
});


it("refreshes boxes for resizing, word reordering and newly editable spans", () => {
  const original: WordBox = {
    segmentId: "hebrew", groupId: "group", groupIndex: 0, wordIndex: 0,
    x: 20, y: 30, width: 65, height: 24, editable: false,
  };
  const sibling: WordBox = { ...original, segmentId: "latin", wordIndex: 1, x: 100 };
  expect(sameWordBoxes([original, sibling], [{ ...original, x: 20.2, width: 65.2 }, sibling])).toBe(true);
  expect(sameWordBoxes([original, sibling], [sibling, original])).toBe(false);
  expect(sameWordBoxes([original, sibling], [original])).toBe(false);
  for (const change of [
    { width: 78 }, { height: 31 }, { x: 24 }, { y: 34 },
    { editable: true }, { segmentId: "arabic" }, { groupId: "other" },
    { groupIndex: 1 }, { wordIndex: 1 },
  ]) {
    expect(sameWordBoxes([original], [{ ...original, ...change }])).toBe(false);
  }
});

it("maps rendered caption groups by stable ID when an earlier group was omitted", () => {
  const f = captionFrame("שלום World", ["שלום", "World"]);
  try {
    f.group.dataset.captionGroupId = "group-0";
    f.group.innerHTML = '<span class="word">שלום</span><span class="word">World</span>';
    // The generator skips empty groups, so groupOrder and DOM indexes differ.
    f.model.groupOrder.unshift("omitted-empty-group");
    f.model.groups.set("omitted-empty-group", { segmentIds: [] });
    const boxes = readWordBoxes(f.iframe, f.model, f.overlay);
    expect(boxes.map((box) => box.segmentId)).toEqual(["s0", "s1"]);
    expect(boxes.map((box) => box.groupIndex)).toEqual([1, 1]);
    expect(boxes.every((box) => box.editable)).toBe(true);
    expect(getWordEl(f.iframe, 1, 1, f.model)).toBe(f.group.children[1]);
    expect(getWordEl(f.iframe, 0, 0, f.model)).toBeNull();

    // A second element with the same identity is ambiguous, not editable.
    const duplicate = f.group.cloneNode(true) as HTMLElement;
    f.doc.body.append(duplicate);
    expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual([]);
    expect(getWordEl(f.iframe, 1, 0, f.model)).toBeNull();
    duplicate.remove();
  } finally { f.dispose(); }
});


it("retains independent Hebrew word scales through move, rotate, reset and replay", () => {
  const frame = captionFrame("שָׁלוֹם", ["שָׁלוֹם"]);
  const word = frame.doc.createElement("span");
  word.textContent = "שָׁלוֹם";
  frame.group.replaceChildren(word);
  const win = frame.iframe.contentWindow!;
  const unregister = registerCaptionIframe({ current: frame.iframe });
  const model = (scaleX: number, scaleY: number) => ({
    groupOrder: ["group-0"],
    groups: new Map([["group-0", { segmentIds: ["s0"] }]]),
    segments: new Map([["s0", { text: "שָׁלוֹם", style: { x: 18, y: -11, rotation: 12, scaleX, scaleY } }]]),
  });
  try {
    applyCaptionModelToIframe(model(1.25, 0.9));
    expect(computeTransformStyle(word, win)).toEqual({
      x: 18, y: -11, rotation: 12, scaleX: 1.25, scaleY: 0.9,
    });
    const before = readGsapTransform(getOrCreateWrapper(word), win);
    writeTransform(word, win, before.x + 5, before.y - 3, before.scale, before.rotation + 8, before.scaleY);
    expect(computeTransformStyle(word, win)).toEqual({
      x: 23, y: -14, rotation: 20, scaleX: 1.25, scaleY: 0.9,
    });
    applyCaptionModelToIframe(model(1, 1));
    expect(computeTransformStyle(word, win)).toMatchObject({ scaleX: 1, scaleY: 1 });
    applyCaptionModelToIframe(model(1.25, 0.9));
    expect(computeTransformStyle(word, win)).toMatchObject({ scaleX: 1.25, scaleY: 0.9 });
    expect(frame.group.textContent).toBe("שָׁלוֹם");
    expect(frame.group.querySelector("span > span")).toBe(word);
  } finally {
    unregister();
    frame.dispose();
  }
});

it("reads and writes GSAP scaleX and scaleY without flattening Arabic word geometry", () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  try {
    const win = iframe.contentWindow!;
    const word = iframe.contentDocument!.createElement("span");
    word.textContent = "السَّلَامُ";
    iframe.contentDocument!.body.append(word);
    const props: Record<string, number> = { x: 7, y: -4, scale: 1.25, scaleX: 1.25, scaleY: 0.75, rotation: 15 };
    Reflect.set(win, "gsap", {
      getProperty: (_: HTMLElement, name: string) => props[name] ?? Number.NaN,
      set: (_: HTMLElement, values: Record<string, number>) => Object.assign(props, values),
    });
    const wrapper = getOrCreateWrapper(word);
    expect(readGsapTransform(wrapper, win)).toMatchObject({ scale: 1.25, scaleY: 0.75 });
    writeTransform(word, win, 17, -4, 1.25, 15, 0.75);
    expect(props).toMatchObject({ x: 17, y: -4, scaleX: 1.25, scaleY: 0.75, rotation: 15 });
    expect(computeTransformStyle(word, win)).toEqual({
      x: 17, y: -4, scaleX: 1.25, scaleY: 0.75, rotation: 15,
    });
  } finally { iframe.remove(); }
});
