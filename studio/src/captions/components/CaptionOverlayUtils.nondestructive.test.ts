// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getWordEl, mapCaptionTokenRanges, readWordBoxes } from "./CaptionOverlayUtils";

describe("non-destructive caption geometry", () => {
  it("maps logical Hebrew, Arabic and Latin ranges with original spacing", () => {
    expect(mapCaptionTokenRanges("שלום  OpenMotion 2.0!", ["שלום", "OpenMotion", "2.0!"]))
      .toEqual([{ start: 0, end: 4 }, { start: 6, end: 16 }, { start: 17, end: 21 }]);
    expect(mapCaptionTokenRanges("السَّلَامُ 2026", ["السَّلَامُ", "2026"]))
      .toEqual([{ start: 0, end: 10 }, { start: 11, end: 15 }]);
  });

  it("rejects mismatched punctuation and boundaries inside combining sequences", () => {
    expect(mapCaptionTokenRanges("שלום, עולם", ["שלום", "עולם"])).toBeNull();
    expect(mapCaptionTokenRanges("בּית", ["ב", "ּית"])).toBeNull();
    expect(mapCaptionTokenRanges("שלום", ["שלום", ""])).toBeNull();
    expect(mapCaptionTokenRanges("שלום", ["עולם"])).toBeNull();
  });

  it("reads actual range rectangles without splitting or replacing the text node", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = '<div class="caption-group" dir="rtl" style="opacity:1">שלום  OpenMotion 2.0!</div>';
    const group = doc.querySelector<HTMLElement>(".caption-group")!;
    const oldHTML = group.innerHTML, oldNode = group.firstChild;
    iframe.style.width = "640px";
    iframe.getBoundingClientRect = () => ({
      left: 20, top: 30, right: 660, bottom: 390, width: 640, height: 360,
      x: 20, y: 30, toJSON: () => ({}),
    } as DOMRect);
    const overlay = document.createElement("div");
    const r = doc.createRange(), proto = Object.getPrototypeOf(r) as object;
    const oldDescriptor = Object.getOwnPropertyDescriptor(proto, "getClientRects");
    Object.defineProperty(proto, "getClientRects", {
      configurable: true,
      value: () => [{ left: 12, top: 24, right: 62, bottom: 40, width: 50, height: 16 }],
    });
    try {
      const words = ["שלום", "OpenMotion", "2.0!"];
      const model = {
        groupOrder: ["one"],
        groups: new Map([["one", { segmentIds: ["a", "b", "c"] }]]),
        segments: new Map(words.map((word, i) => [["a", "b", "c"][i], { text: word }] as const)),
      };
      const boxes = readWordBoxes(iframe, model, overlay);
      expect(boxes.map(b => b.segmentId)).toEqual(["a", "b", "c"]);
      expect(boxes.every(b => !b.editable)).toBe(true);
      expect(boxes[0]).toMatchObject({ x: 32, y: 54, width: 50, height: 16 });
      expect(group.innerHTML).toBe(oldHTML);
      expect(group.firstChild).toBe(oldNode);
      expect(group.children.length).toBe(0);
      expect(getWordEl(iframe, 0, 0)).toBeNull();
    } finally {
      if (oldDescriptor) Object.defineProperty(proto, "getClientRects", oldDescriptor);
      else Reflect.deleteProperty(proto, "getClientRects");
      iframe.remove();
    }
  });

  it("keeps authored word spans individually transformable and untouched", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = '<div class="caption-group" style="opacity:1"><span>שלום</span><span>OpenMotion</span></div>';
    const group = doc.querySelector<HTMLElement>(".caption-group")!;
    const originalChildren = [...group.children];
    iframe.style.width = "640px";
    iframe.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const model = {
      groupOrder: ["one"],
      groups: new Map([["one", { segmentIds: ["a", "b"] }]]),
      segments: new Map([["a", { text: "שלום" }], ["b", { text: "OpenMotion" }]]),
    };
    const boxes = readWordBoxes(iframe, model, document.createElement("div"));
    expect(boxes.map(b => b.editable)).toEqual([true, true]);
    expect([...group.children]).toEqual(originalChildren);
    expect(getWordEl(iframe, 0, 1)).toBe(originalChildren[1]);
    iframe.remove();
  });
});
