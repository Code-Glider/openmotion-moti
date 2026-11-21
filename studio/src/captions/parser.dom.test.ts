// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { generateCaptionHtml } from "./generator";
import { parseCaptionComposition, type TranscriptWord } from "./parser";

const transcript = "We asked what you needed. Forty-seven percent".split(" ").map((text, i) => ({
  id: `word-${i}`,
  text,
  start: i * 0.5,
  end: i * 0.5 + 0.4,
}));
const source = `const TRANSCRIPT = ${JSON.stringify(transcript)};`;

function createCaptionDocument(
  groupSizes: number[],
  groupClass = "caption-group",
  wordClass = "word",
) {
  const doc = document.implementation.createHTMLDocument();
  let offset = 0;
  for (const size of groupSizes) {
    const group = doc.createElement("div");
    group.className = groupClass;
    for (const word of transcript.slice(offset, offset + size)) {
      const span = doc.createElement("span");
      span.className = wordClass;
      span.textContent = word.text;
      group.appendChild(span);
    }
    doc.body.appendChild(group);
    offset += size;
  }
  return doc;
}

function importCaptions(doc: Document, captionSource = source) {
  const model = parseCaptionComposition(doc, window, captionSource, 1920, 1080, 4);
  expect(model).not.toBeNull();
  if (!model) throw new Error("Expected a caption model");
  const groups = model.groupOrder.map((id) =>
    model.groups.get(id)?.segmentIds.map((segmentId) => model.segments.get(segmentId)?.text),
  );
  return { model, groups };
}

describe("parseCaptionComposition grouping", () => {
  it.each([{ sizes: [5, 2] }, { sizes: [2, 4, 1] }])(
    "preserves authored group sizes $sizes",
    ({ sizes }) => {
      const { model, groups } = importCaptions(createCaptionDocument(sizes));
      expect(groups.map((group) => group?.length)).toEqual(sizes);
      expect(groups.flat()).toEqual(transcript.map((word) => word.text));
      expect(
        [...model.segments.values()].map(({ wordId, text, start, end }) => ({
          id: wordId,
          text,
          start,
          end,
        })),
      ).toEqual(transcript);
      for (const group of model.groups.values()) {
        expect(group.segmentIds.map((id) => model.segments.get(id)?.groupIndex)).toEqual(
          group.segmentIds.map((_, index) => index),
        );
      }
    },
  );

  it.each(["caption-line", "caption-block"])(
    "supports %s with caption-word spans",
    (groupClass) => {
      const { groups } = importCaptions(
        createCaptionDocument([2, 4, 1], groupClass, "caption-word"),
      );
      expect(groups.map((group) => group?.length)).toEqual([2, 4, 1]);
    },
  );

  it("does not count nested caption lines as additional groups", () => {
    const doc = createCaptionDocument([2, 4, 1]);
    for (const group of doc.querySelectorAll(".caption-group")) {
      const line = doc.createElement("div");
      line.className = "caption-line";
      line.append(...group.childNodes);
      group.appendChild(line);
    }
    expect(importCaptions(doc).groups.map((group) => group?.length)).toEqual([2, 4, 1]);
  });

  it.each([
    { name: "absent", sizes: [] },
    { name: "incomplete", sizes: [2, 1] },
    { name: "empty", sizes: [0, 0] },
  ])("uses default grouping without losing words when DOM groups are $name", ({ sizes }) => {
    const { groups } = importCaptions(createCaptionDocument(sizes));
    expect(groups).toEqual([
      transcript.slice(0, 5).map((word) => word.text),
      transcript.slice(5).map((word) => word.text),
    ]);
  });

  it("keeps authored boundaries when generated captions are imported again", () => {
    const original = importCaptions(createCaptionDocument([2, 4, 1]));
    const html = generateCaptionHtml(original.model);
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = html;
    const template = doc.querySelector("template");
    if (!template) throw new Error("Expected generated caption template");
    doc.body.replaceChildren(template.content.cloneNode(true));
    const script = doc.querySelector("script")?.textContent;
    if (!script) throw new Error("Expected generated caption script");
    // Execute only our generator's output to create its real group and word elements.
    new Function("document", "window", "gsap", script)(
      doc,
      {},
      {
        timeline: () => ({ to() {} }),
      },
    );
    expect(importCaptions(doc, html).groups).toEqual([
      transcript.slice(0, 2).map((word) => word.text),
      transcript.slice(2, 6).map((word) => word.text),
      transcript.slice(6).map((word) => word.text),
    ]);
  });
});

describe("authored caption word transform baselines", () => {
  const words = [
    { id: "he-target", text: "שָׁלוֹם", start: 0, end: 0.5 },
    { id: "ar-control", text: "السَّلَامُ", start: 0.5, end: 1 },
  ];
  const transform = "translate(0px, -11px) rotate(12deg) scale(1.25, 0)";
  const markup = (style = "transform:" + transform) =>
    `<div class="caption-group" dir="rtl"><span data-caption-wrapper="true" style="${style}"><span class="word" id="he-target" lang="he">שָׁלוֹם</span></span> <span class="word" id="ar-control" lang="ar">السَّلَامُ</span></div>`;
  const sourceFor = (html: string, records: TranscriptWord[] = words) =>
    `<template id="captions-template">${html}</template><script>const TRANSCRIPT = ${JSON.stringify(records)};</script>`;
  function result(authored = markup(), live = authored, records: TranscriptWord[] = words, beforeParse?: (doc: Document) => void) {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = live;
    beforeParse?.(doc);
    const { model } = importCaptions(doc, sourceFor(authored, records));
    return [...model.segments.values()];
  }

  it("hydrates only the matched word, preserving anisotropy, zero, text, and timing", () => {
    const [target, other] = result();
    expect(target).toMatchObject({ wordId: words[0].id, text: words[0].text, start: 0, end: 0.5,
      style: { x: 0, y: -11, rotation: 12, scaleX: 1.25, scaleY: 0 } });
    expect(other).toMatchObject({ wordId: words[1].id, text: words[1].text, start: 0.5, end: 1 });
    expect(other.style).toEqual({});
  });

  it.each([
    ["missing authored wrapper", markup().replace('data-caption-wrapper="true"', ""), markup()],
    ["missing live ID", markup(), markup().replace('id="he-target"', "")],
    ["wrong word identity", markup(), markup().replace("שָׁלוֹם", "שָׁלוֹם!")],
    ["duplicate authored ID", markup() + '<i id="he-target"></i>', markup()],
    ["duplicate authored ID inside a nested template", markup() + '<template><template><i id="he-target"></i></template></template>', markup()],
    ["duplicate live ID", markup(), markup() + '<i id="he-target"></i>'],
    ["modified live transform", markup(), markup().replace("1.25", "1.5")],
    ["matrix", markup("transform:matrix(1,0,0,1,0,0)"), markup("transform:matrix(1,0,0,1,0,0)")],
    ["animated inline wrapper", markup("transform:" + transform + ";animation-name:pulse"), markup("transform:" + transform + ";animation-name:pulse")],
    ["dynamic-only markup", `<script>const fake = ${JSON.stringify(markup())};</script>`, markup()],
    ["wrapper sibling", markup().replace("</span></span>", "</span><span>extra</span></span>"), markup()],
  ])("retains the old parser path for %s", (_label, authored, live) => {
    expect(result(authored, live)[0].style).toEqual({});
  });

  it("does not infer identity from a synthesized ID or duplicate transcript IDs", () => {
    const withFallbackId = markup().replace('id="he-target"', 'id="w0"');
    const { text, start, end } = words[0];
    const [fallback] = result(withFallbackId, withFallbackId, [{ text, start, end }, words[1]]);
    expect(fallback.wordId).toBe("w0");
    expect(fallback.style).toEqual({});
    expect(result(markup(), markup(), [words[0], { ...words[1], id: words[0].id }])[0].style).toEqual({});
  });

  it("ignores a wrapper with a running animation or transition", () => {
    const [target] = result(markup(), markup(), words, (doc) => {
      const wrapper = doc.querySelector<HTMLElement>("[data-caption-wrapper]")!;
      Object.defineProperty(wrapper, "getAnimations", { value: () => [{}] });
    });
    expect(target.style).toEqual({});
  });
});
