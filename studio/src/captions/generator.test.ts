// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { generateCaptionHtml } from "./generator";
import { buildCaptionModel, TranscriptWord } from "./parser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_TRANSCRIPT: TranscriptWord[] = [
  { text: "We", start: 0.1, end: 0.3 },
  { text: "asked", start: 0.4, end: 0.6 },
  { text: "what", start: 0.7, end: 0.9 },
  { text: "you", start: 1.0, end: 1.2 },
  { text: "needed.", start: 1.3, end: 1.8 },
  { text: "Forty-seven", start: 1.9, end: 2.3 },
  { text: "percent", start: 2.4, end: 2.7 },
];

function buildTestModel(wordsPerGroup = 5) {
  return buildCaptionModel(SAMPLE_TRANSCRIPT, {
    width: 1920,
    height: 1080,
    duration: 16,
    wordsPerGroup,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateCaptionHtml", () => {
  it("emits exact caption group IDs for script-safe RTL hit-target lookup", () => {
    const model = buildTestModel();
    const originalId = model.groupOrder[0];
    const group = model.groups.get(originalId)!;
    model.groups.delete(originalId);
    const rtlId = "קבוצה-א";
    model.groupOrder[0] = rtlId;
    model.groups.set(rtlId, group);
    const html = generateCaptionHtml(model);
    expect(html).toContain('.dataset.captionGroupId = "קבוצה-א";');
    expect(html).toContain('.dataset.captionGroupId = "group-1";');
  });

  it("keeps script-closing text and word IDs as data when HTML is parsed", () => {
    const text = '</ScRiPt><img src=x onerror="alert(1)"><!-- <script> & end';
    const id = '</script><svg onload="alert(2)">';
    const model = buildCaptionModel([{ text, id, start: 0, end: 1 }], {
      width: 1920,
      height: 1080,
      duration: 2,
      wordsPerGroup: 5,
    });
    const window = new Window();
    const template = window.document.createElement("template");
    template.innerHTML = generateCaptionHtml(model);
    const nested = template.content.querySelector("template");
    expect(nested).not.toBeNull();
    const content = nested!.content;
    expect(content.querySelector("img, svg")).toBeNull();
    const scripts = content.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    const script = scripts[0].textContent;
    const transcript = script.match(/const TRANSCRIPT = ([\s\S]*?);/);
    expect(transcript).not.toBeNull();
    expect(JSON.parse(transcript![1])).toEqual([{ text, id, start: 0, end: 1 }]);
    const wordText = script.match(/\.textContent = (.*);/);
    const wordId = script.match(/\.id = (.*);/);
    expect(JSON.parse(wordText![1])).toBe(text);
    expect(JSON.parse(wordId![1])).toBe(id);
    window.close();
  });

  describe("HTML structure", () => {
    it("wraps output in a <template id='captions-template'>", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain('<template id="captions-template">');
      expect(html).toContain("</template>");
    });

    it("includes correct data-composition-id, data-width, data-height, data-duration attributes", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain('data-composition-id="captions"');
      expect(html).toContain('data-width="1920"');
      expect(html).toContain('data-height="1080"');
      expect(html).toContain('data-duration="16"');
    });

    it("includes the captions-container div", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain('<div id="captions-container"></div>');
    });

    it("includes a <style> block", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("<style>");
      expect(html).toContain("</style>");
    });

    it("includes a <script> block", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("<script>");
      expect(html).toContain("</script>");
    });
  });

  describe("CSS generation", () => {
    it("includes composition base styles with correct dimensions", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain('data-composition-id="captions"');
      expect(html).toContain("width: 1920px");
      expect(html).toContain("height: 1080px");
    });

    it("includes .caption-group base styles with opacity: 0", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain(".caption-group");
      expect(html).toContain("opacity: 0");
    });

    it("includes .word base styles with display: inline-block", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain(".word");
      expect(html).toContain("display: inline-block");
    });

    it("includes per-group CSS class with font styles from DEFAULT_STYLE", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      // DEFAULT_STYLE has fontFamily: "sans-serif" and fontSize: 48
      expect(html).toContain("font-family: sans-serif");
      expect(html).toContain("font-size: 48px");
    });

    it("includes per-group CSS class for each group", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      // Two groups: group-0 and group-1
      expect(html).toContain("group-0");
      expect(html).toContain("group-1");
    });
  });

  describe("TRANSCRIPT array", () => {
    it("includes a TRANSCRIPT array in the script block", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("const TRANSCRIPT =");
    });

    it("includes all word texts from the transcript", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain('"We"');
      expect(html).toContain('"asked"');
      expect(html).toContain('"what"');
      expect(html).toContain('"you"');
      expect(html).toContain('"needed."');
      expect(html).toContain('"Forty-seven"');
      expect(html).toContain('"percent"');
    });

    it("includes start and end timing for words", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain('"start": 0.1');
      expect(html).toContain('"end": 0.3');
      expect(html).toContain('"start": 1.9');
      expect(html).toContain('"end": 2.7');
    });

    it("includes stable word ids in the transcript and generated word spans", () => {
      const transcript: TranscriptWord[] = [
        { id: "word-a", text: "Hello", start: 0, end: 0.4 },
        { id: "word-b", text: "world", start: 0.5, end: 1 },
      ];
      const model = buildCaptionModel(transcript, {
        width: 1920,
        height: 1080,
        duration: 2,
      });

      const html = generateCaptionHtml(model);

      expect(html).toContain('"id": "word-a"');
      expect(html).toContain('"id": "word-b"');
      expect(html).toContain('w_segment_0.id = "word-a";');
      expect(html).toContain('w_segment_1.id = "word-b";');
    });

    it("TRANSCRIPT contains all 7 words from the sample", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      // Count occurrences of "start" property in the TRANSCRIPT JSON
      const transcriptSection = html.slice(
        html.indexOf("const TRANSCRIPT ="),
        html.indexOf("const TRANSCRIPT =") + 1000,
      );
      const startCount = (transcriptSection.match(/"start":/g) ?? []).length;
      expect(startCount).toBe(7);
    });
  });

  describe("GSAP timeline", () => {
    it("registers the timeline via window.__timelines", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain('window.__timelines["captions"]');
    });

    it("creates a gsap.timeline() call", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("gsap.timeline(");
    });

    it("includes entrance tween with opacity: 1 for each group", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("opacity: 1");
    });

    it("includes exit tween with opacity: 0 for each group", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("opacity: 0");
    });

    it("uses group start time as position for entrance tween", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      // First group starts at 0.1 (first word start)
      expect(html).toContain(", 0.1)");
    });

    it("creates caption-group div elements with class='clip'", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("caption-group clip");
    });

    it("creates word span elements with class='word clip'", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("word clip");
    });

    it("sets data-start and data-end on group elements", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("dataset.start");
      expect(html).toContain("dataset.end");
    });

    it("wraps everything in an IIFE", () => {
      const model = buildTestModel();
      const html = generateCaptionHtml(model);
      expect(html).toContain("(function ()");
      expect(html).toContain("})();");
    });
  });

  describe("positioning", () => {
    it("centers groups without explicit x/y using transform: translateX(-50%)", () => {
      const model = buildTestModel();
      // DEFAULT_STYLE has x: 0 and y: 0
      const html = generateCaptionHtml(model);
      expect(html).toContain("translateX(-50%)");
    });

    it("uses absolute left/top when group style has explicit x/y", () => {
      const model = buildTestModel();
      // Override the first group's style to have explicit position
      const firstGroupId = model.groupOrder[0];
      const firstGroup = model.groups.get(firstGroupId);
      if (firstGroup) {
        firstGroup.style = { ...firstGroup.style, x: 200, y: 300 };
      }
      const html = generateCaptionHtml(model);
      expect(html).toContain("200px");
      expect(html).toContain("300px");
    });
  });

  describe("edge cases", () => {
    it("handles an empty model (no segments or groups) without throwing", () => {
      const model = buildCaptionModel([], {
        width: 1280,
        height: 720,
        duration: 5,
      });
      expect(() => generateCaptionHtml(model)).not.toThrow();
    });

    it("empty model still produces valid template wrapper", () => {
      const model = buildCaptionModel([], {
        width: 1280,
        height: 720,
        duration: 5,
      });
      const html = generateCaptionHtml(model);
      expect(html).toContain('<template id="captions-template">');
      expect(html).toContain('data-composition-id="captions"');
    });

    it("handles custom dimensions correctly", () => {
      const model = buildCaptionModel(SAMPLE_TRANSCRIPT, {
        width: 1280,
        height: 720,
        duration: 30,
      });
      const html = generateCaptionHtml(model);
      expect(html).toContain('data-width="1280"');
      expect(html).toContain('data-height="720"');
      expect(html).toContain('data-duration="30"');
      expect(html).toContain("width: 1280px");
      expect(html).toContain("height: 720px");
    });

    it("words with special characters are escaped in JS output", () => {
      const transcript: TranscriptWord[] = [{ text: "it's", start: 0.0, end: 0.5 }];
      const model = buildCaptionModel(transcript, {
        width: 1920,
        height: 1080,
        duration: 5,
      });
      expect(() => generateCaptionHtml(model)).not.toThrow();
    });
  });
});


describe("caption identifier collision safety", () => {
  it("renders distinct Hebrew/Arabic group and word IDs even when both sanitize to identical JS/CSS tokens", () => {
    const transcript: TranscriptWord[] = [
      { text: "שלום", start: 0, end: 0.24 },
      { text: "ABC-123", start: 0.25, end: 0.49 },
      { text: "السَّلَامُ", start: 0.5, end: 0.74 },
      { text: "2026", start: 0.75, end: 1 },
    ];
    const model = buildCaptionModel(transcript, { width: 640, height: 360, duration: 2, wordsPerGroup: 2 });
    const oldIds = Array.from(model.segments.keys());
    const replacementIds = ["c-א", "c-ع", "c-ב", "c-ب"];
    const oldGroups = model.groupOrder.map(id => model.groups.get(id)!);
    expect(oldGroups).toHaveLength(2);
    model.segments = new Map(oldIds.map((id, index) => [
      replacementIds[index],
      { ...model.segments.get(id)!, id: replacementIds[index] },
    ]));
    model.groupOrder = ["g-אב", "g-عر"];
    model.groups = new Map(oldGroups.map((group, index) => [
      model.groupOrder[index],
      {
        ...group,
        id: model.groupOrder[index],
        segmentIds: group.segmentIds.map(id => replacementIds[oldIds.indexOf(id)]),
        style: { ...group.style, color: index ? "#0000ff" : "#ff0000" },
      },
    ]));

    // g-אב and g-عر both produce the same fallback class "g---".
    // All four segment IDs likewise collapse to one local variable stem.
    const html = generateCaptionHtml(model);
    const win = new Window();
    try {
      const source = win.document.createElement("div");
      source.innerHTML = html;
      const inner = source.querySelector("template")?.content;
      expect(inner).toBeDefined();
      const script = inner!.querySelector("script")?.textContent ?? "";
      const css = inner!.querySelector("style")?.textContent ?? "";
      expect(() => new Function("window", "document", "gsap", script)).not.toThrow();
      expect(css).toContain('.caption-group.g---[data-caption-style-index="0"]');
      expect(css).toContain('.caption-group.g---[data-caption-style-index="1"]');
      expect(css).toContain("#ff0000");
      expect(css).toContain("#0000ff");
      win.document.body.innerHTML = '<div id="captions-container"></div>';
      const fakeGsap = { timeline: () => ({ to() { return this; } }) };
      new Function("window", "document", "gsap", script)(win, win.document, fakeGsap);
      const groups = [...win.document.querySelectorAll<HTMLElement>(".caption-group")];
      expect(groups.map(group => group.dataset.captionGroupId)).toEqual(model.groupOrder);
      expect(groups.map(group => group.dataset.captionStyleIndex)).toEqual(["0", "1"]);
      expect(groups.map(group => [...group.querySelectorAll<HTMLElement>(".word")].map(el => el.textContent)))
        .toEqual([["שלום", "ABC-123"], ["السَّلَامُ", "2026"]]);
      expect(win.document.querySelectorAll(".word")).toHaveLength(4);
      expect((win as Window & { __timelines?: Record<string, unknown> }).__timelines?.captions).toBeDefined();
    } finally {
      win.close();
    }
  });

  it("keeps Unicode group IDs with line breaks as data, not executable script comments", () => {
    const model = buildCaptionModel([{ text: "مرحبا", start: 0, end: 1 }], {
      width: 640, height: 360, duration: 2,
    });
    const original = model.groupOrder[0];
    const group = model.groups.get(original)!;
    const dangerous = "קבוצה\nwindow.__executed = true";
    model.groups.delete(original);
    model.groupOrder[0] = dangerous;
    model.groups.set(dangerous, { ...group, id: dangerous });
    const win = new Window();
    try {
      const source = win.document.createElement("div");
      source.innerHTML = generateCaptionHtml(model);
      const code = source.querySelector("template")!.content.querySelector("script")!.textContent!;
      win.document.body.innerHTML = '<div id="captions-container"></div>';
      expect(() => new Function("window", "document", "gsap", code)).not.toThrow();
      new Function("window", "document", "gsap", code)(
        win, win.document, { timeline: () => ({ to() { return this; } }) },
      );
      expect(win.document.querySelector<HTMLElement>(".caption-group")?.dataset.captionGroupId).toBe(dangerous);
      expect((win as Window & { __executed?: boolean }).__executed).toBeUndefined();
      expect(win.document.querySelector(".word")?.textContent).toBe("مرحبا");
    } finally {
      win.close();
    }
  });
});


describe("native authored word transform persistence", () => {
  function modelWithWordTransforms() {
    const model = buildCaptionModel([
      { id: "word-he", text: "שָׁלוֹם", start: 0.1, end: 0.45 },
      { id: "word-ar", text: "السَّلَامُ", start: 0.55, end: 0.95 },
    ], { width: 640, height: 360, duration: 2, wordsPerGroup: 2 });
    const group = model.groups.get(model.groupOrder[0])!;
    const first = model.segments.get(group.segmentIds[0])!;
    first.style = { x: 18, y: -11, rotation: 12, scaleX: 1.25, scaleY: 0.9 };
    return model;
  }

  function runGeneratedCaptionHtml(model: ReturnType<typeof modelWithWordTransforms>) {
    const win = new Window();
    const wrapper = win.document.createElement("template");
    wrapper.innerHTML = generateCaptionHtml(model);
    const template = wrapper.content.querySelector("template");
    const script = template?.content.querySelector("script")?.textContent;
    expect(script).toBeTruthy();
    win.document.body.innerHTML = '<div id="captions-container"></div>';
    const fakeGsap = { timeline: () => ({ to() { return this; } }) };
    new Function("window", "document", "gsap", script!)(win, win.document, fakeGsap);
    return { win, group: win.document.querySelector<HTMLElement>(".caption-group")! };
  }

  it("replays exact Hebrew translation, non-uniform scale and rotation without rewriting text or timing", () => {
    const model = modelWithWordTransforms();
    const { win, group } = runGeneratedCaptionHtml(model);
    try {
      expect(group.dataset.captionGroupId).toBe(model.groupOrder[0]);
      expect(group.children).toHaveLength(2);
      const transformed = group.children[0] as HTMLElement;
      const word = transformed.querySelector<HTMLElement>(".word")!;
      expect(transformed.dataset.captionWrapper).toBe("true");
      expect(transformed.style.display).toBe("inline-block");
      expect(transformed.style.transform).toBe("translate(18px, -11px) rotate(12deg) scale(1.25, 0.9)");
      expect(word.textContent).toBe("שָׁלוֹם");
      expect(word.id).toBe("word-he");
      expect(word.dataset.start).toBe("0.1");
      expect(word.dataset.end).toBe("0.45");
      // The untouched Arabic caption is still a direct authored word span.
      const neutral = group.children[1] as HTMLElement;
      expect(neutral.classList.contains("word")).toBe(true);
      expect(neutral.dataset.captionWrapper).toBeUndefined();
      expect(neutral.id).toBe("word-ar");
      expect(neutral.textContent).toBe("السَّلَامُ");
      expect(neutral.dataset.start).toBe("0.55");
      expect(neutral.dataset.end).toBe("0.95");
      expect(group.textContent).toBe("שָׁלוֹםالسَّلَامُ");
    } finally { win.close(); }
  });

  it("omits the wrapper after a reset to neutral while preserving the stable word ID", () => {
    const model = modelWithWordTransforms();
    const segment = model.segments.get(model.groups.get(model.groupOrder[0])!.segmentIds[0])!;
    segment.style = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    const { win, group } = runGeneratedCaptionHtml(model);
    try {
      expect(group.querySelector("[data-caption-wrapper]")).toBeNull();
      const firstWord = group.children[0] as HTMLElement;
      expect(firstWord.id).toBe("word-he");
      expect(firstWord.textContent).toBe("שָׁלוֹם");
    } finally { win.close(); }
  });

  it("rejects non-finite transform state rather than serializing invalid project output", () => {
    const model = modelWithWordTransforms();
    const segment = model.segments.get(model.groups.get(model.groupOrder[0])!.segmentIds[0])!;
    for (const [field, value] of [
      ["x", Infinity], ["y", -Infinity], ["rotation", Number.NaN],
      ["scaleX", Infinity], ["scaleY", Number.NaN],
    ] as const) {
      segment.style = { [field]: value };
      expect(() => generateCaptionHtml(model)).toThrow("INVALID_CAPTION_WORD_TRANSFORM_" + field.toUpperCase());
    }
  });
});
