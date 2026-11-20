// @vitest-environment jsdom
import { expect, it } from "vitest";
import { splitCaptionWordRuns } from "./captionWordRuns";
import { readWordBoxes, getWordEl } from "./CaptionOverlayUtils";

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
  expect(runs?.map((r) => r.trim())).toEqual(["السَّلَامُ", "OpenMotion", "2.0!"]);
});

it("does not guess when timed tokens cannot match visible text", () => {
  expect(splitCaptionWordRuns("שלום עולם", ["שלום"])).toBeNull();
  expect(splitCaptionWordRuns("שלום עולם", ["עולם", "שלום"])).toBeNull();
  expect(splitCaptionWordRuns("שלום עולם", ["שלום", "different"])).toBeNull();
  expect(splitCaptionWordRuns("こんにちは世界", ["こんにちは", "世界"])).toBeNull();
  expect(splitCaptionWordRuns("   ", [""])).toBeNull();
});

function captionFrame(text: string, expected: string[]) {
  const iframe = document.createElement("iframe");
  const overlay = document.createElement("div");
  document.body.append(iframe, overlay);
  const doc = iframe.contentDocument!;
  const group = doc.createElement("div");
  group.className = "caption-group";
  group.textContent = text;
  doc.body.append(group);
  const ids = expected.map((_, i) => "s" + i);
  const model = {
    groupOrder: ["group-0"],
    groups: new Map([["group-0", { segmentIds: ids }]]),
    segments: new Map(ids.map((id, i) => [id, { text: expected[i] }])),
  };
  return { iframe, overlay, group, model, dispose: () => { iframe.remove(); overlay.remove(); } };
}

it("legacy caption overlay preserves content on repeated word measurement", () => {
  const text = "  שלום  World 2026!\n";
  const f = captionFrame(text, ["שלום", "World", "2026!"]);
  try {
    const boxes = readWordBoxes(f.iframe, f.model, f.overlay);
    expect(boxes.map((b) => b.segmentId)).toEqual(["s0", "s1", "s2"]);
    expect(f.group.textContent).toBe(text);
    expect(f.group.children).toHaveLength(3);
    expect(getWordEl(f.iframe, 0, 1)?.textContent).toBe("World ");
    readWordBoxes(f.iframe, f.model, f.overlay);
    expect(f.group.textContent).toBe(text);
    expect(f.group.children).toHaveLength(3);
  } finally { f.dispose(); }
});

it("mismatched legacy captions keep their original DOM untouched", () => {
  const f = captionFrame("שלום עולם", ["שלום", "wrong"]);
  try {
    const html = f.group.innerHTML;
    expect(readWordBoxes(f.iframe, f.model, f.overlay)).toEqual([]);
    expect(f.group.innerHTML).toBe(html);
    expect(f.group.childNodes).toHaveLength(1);
  } finally { f.dispose(); }
});
