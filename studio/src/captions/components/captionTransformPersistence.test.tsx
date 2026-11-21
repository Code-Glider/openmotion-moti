// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useCaptionSync } from "../hooks/useCaptionSync";
import { CaptionPropertyPanel } from "./CaptionPropertyPanel";
import { useCaptionStore } from "../store";
import { DEFAULT_ANIMATION_SET, DEFAULT_STYLE, DEFAULT_CONTAINER } from "../types";
import type { CaptionStyle } from "../types";

const { fetchMock, commits } = vi.hoisted(() => ({
  fetchMock: vi.fn(), commits: new Map<string, (value: number) => void>(),
}));
vi.mock("../../utils/studioApiFetch", () => ({ studioApiFetch: fetchMock }));
vi.mock("../../utils/studioFileVersion", () => ({ studioWriteHeaders: () => ({}) }));
vi.mock("../../i18n/I18n", () => ({ useI18n: () => ({ t: (value: string) => value }) }));
vi.mock("./shared", () => ({
  Section: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Row: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NumberField: ({ ariaLabel, onCommit }: { ariaLabel: string; onCommit: (value: number) => void }) => {
    commits.set(ariaLabel, onCommit);
    return null;
  },
}));
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function model(styles: Partial<CaptionStyle>[]) {
  return {
    width: 640, height: 360, duration: 3,
    segments: new Map(styles.map((style, i) => [`s${i}`, {
      id: `s${i}`, wordId: `w${i}`, text: `word${i}`, start: i, end: i + 1,
      groupIndex: 0, style, animation: {},
    }])),
    groups: new Map([["g", { id: "g", segmentIds: styles.map((_, i) => `s${i}`),
      style: DEFAULT_STYLE, animation: DEFAULT_ANIMATION_SET, containerStyle: DEFAULT_CONTAINER }]]),
    groupOrder: ["g"], defaultAnimation: DEFAULT_ANIMATION_SET,
  };
}
afterEach(() => { useCaptionStore.getState().reset(); fetchMock.mockReset(); commits.clear(); });

it("round-trips independent, zero, neutral and absent axes, with stable IDs and index fallback", async () => {
  const styles = [{ scaleX: 0, scaleY: 2 }, { scaleX: 1 }, { scaleY: 0 }, { scaleX: 1, scaleY: 1 }];
  useCaptionStore.getState().setModel(model(styles));
  useCaptionStore.getState().setSourceFilePath("captions.json");
  let sync!: ReturnType<typeof useCaptionSync>;
  function Harness() { sync = useCaptionSync("test"); return null; }
  const host = document.createElement("div");
  const root = createRoot(host);
  fetchMock.mockResolvedValue({ ok: true });
  try {
    act(() => root.render(<Harness />));
    await act(async () => sync.save());
    const saved = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(saved).toEqual([
      { wordIndex: 0, wordId: "w0", scaleX: 0, scaleY: 2 },
      { wordIndex: 1, wordId: "w1", scaleX: 1 },
      { wordIndex: 2, wordId: "w2", scaleY: 0 },
      { wordIndex: 3, wordId: "w3", scale: 1, scaleX: 1, scaleY: 1 },
    ]);
    // Deliberately stale indexes must not win over stable word IDs.
    saved[0].wordIndex = 3;
    delete saved[2].wordId;
    useCaptionStore.getState().setModel(model([{}, {}, {}, {}]));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: JSON.stringify(saved) }) });
    await act(async () => sync.loadOverrides());
    expect([...useCaptionStore.getState().model!.segments.values()].map(s => s.style)).toEqual(styles);
    // Old scalar data remains uniform; explicit axes override only their axis.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: JSON.stringify([
      { wordIndex: 0, scale: 0 }, { wordIndex: 1, scale: 2, scaleY: 0 },
      { wordIndex: 2, wordId: "missing", scale: 3, scaleX: 1 },
    ]) }) });
    await act(async () => sync.loadOverrides());
    expect([...useCaptionStore.getState().model!.segments.values()].map(s => s.style)).toEqual([
      { scaleX: 0, scaleY: 0 }, { scaleX: 2, scaleY: 0 },
      { scaleX: 1, scaleY: 3 }, { scaleX: 1, scaleY: 1 },
    ]);
  } finally { act(() => root.unmount()); }
});

it.each([[0, 2], [2, 0], [1.2, 0.7]])("position edits preserve live scales %s/%s and rotation", (scaleX, scaleY) => {
  useCaptionStore.getState().setModel(model([{}]));
  useCaptionStore.getState().selectSegment("s0");
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div class="caption-group"><span data-caption-wrapper="true"><span>word0</span></span></div>';
  const live: Record<string, number> = { x: 7, y: 8, scaleX, scaleY, rotation: 23 };
  const set = vi.fn((_el, props) => Object.assign(live, props));
  Reflect.set(iframe.contentWindow!, "gsap", { set, getProperty: (_el: HTMLElement, key: string) => live[key] });
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<CaptionPropertyPanel iframeRef={{ current: iframe }} />));
    act(() => commits.get("X position")!(0));
    expect(set.mock.lastCall?.[1]).toEqual({ x: 0, y: 8, scaleX, scaleY, rotation: 23 });
    act(() => commits.get("Y position")!(0));
    expect(set.mock.lastCall?.[1]).toEqual({ x: 0, y: 0, scaleX, scaleY, rotation: 23 });
    act(() => commits.get("Rotation")!(0));
    expect(set.mock.lastCall?.[1]).toEqual({ x: 0, y: 0, scaleX, scaleY, rotation: 0 });
    act(() => commits.get("Scale")!(1));
    expect(set.mock.lastCall?.[1]).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(doc.querySelectorAll('[data-caption-wrapper]')).toHaveLength(1);
    expect(doc.body.textContent).toBe("word0");
  } finally { act(() => root.unmount()); iframe.remove(); }
});

it("preserves independent CSS transforms when GSAP is unavailable", () => {
  useCaptionStore.getState().setModel(model([{}]));
  useCaptionStore.getState().selectSegment("s0");
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div class="caption-group"><span data-caption-wrapper="true" style="transform: translate(7px, 8px) rotate(23deg) scale(0, 2)"><span>word0</span></span></div>';
  const wrapper = doc.querySelector<HTMLElement>('[data-caption-wrapper]')!;
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<CaptionPropertyPanel iframeRef={{ current: iframe }} />));
    act(() => commits.get("X position")!(0));
    expect(wrapper.style.transform).toBe("translate(0.0px, 8.0px) rotate(23.0deg) scale(0.000, 2.000)");
    act(() => commits.get("Y position")!(0));
    expect(wrapper.style.transform).toBe("translate(0.0px, 0.0px) rotate(23.0deg) scale(0.000, 2.000)");
    act(() => commits.get("Rotation")!(0));
    expect(wrapper.style.transform).toBe("translate(0.0px, 0.0px) rotate(0.0deg) scale(0.000, 2.000)");
    act(() => commits.get("Scale")!(1));
    expect(wrapper.style.transform).toBe("translate(0.0px, 0.0px) rotate(0.0deg) scale(1.000)");
    expect(doc.querySelectorAll('[data-caption-wrapper]')).toHaveLength(1);
    expect(wrapper.firstElementChild?.outerHTML).toBe("<span>word0</span>");
  } finally { act(() => root.unmount()); iframe.remove(); }
});

it("transforms only a verified word when authored groups are reordered", () => {
  const captions = model([{}]);
  captions.groupOrder.unshift("omitted");
  captions.groups.set("omitted", { ...captions.groups.get("g")!, id: "omitted", segmentIds: [] });
  useCaptionStore.getState().setModel(captions);
  useCaptionStore.getState().selectSegment("s0");
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    '<div class="caption-group" data-caption-group-id="g"><span>word0</span></div>' +
    '<div class="caption-group" data-caption-group-id="other"><span>word0</span></div>';
  const [target, other] = doc.querySelectorAll<HTMLElement>(".caption-group");
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<CaptionPropertyPanel iframeRef={{ current: iframe }} />));
    act(() => commits.get("X position")!(7));
    expect(target.querySelector<HTMLElement>("[data-caption-wrapper]")?.style.transform)
      .toBe("translate(7.0px, 0.0px) rotate(0.0deg) scale(1.000)");
    expect(other.innerHTML).toBe("<span>word0</span>");
  } finally { act(() => root.unmount()); iframe.remove(); }
});

it("does not wrap a span when its caption text does not match the model", () => {
  useCaptionStore.getState().setModel(model([{}]));
  useCaptionStore.getState().selectSegment("s0");
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div class="caption-group"><span>another word</span></div>';
  const before = doc.body.innerHTML;
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<CaptionPropertyPanel iframeRef={{ current: iframe }} />));
    act(() => commits.get("X position")!(7));
    expect(doc.body.innerHTML).toBe(before);
    // The inspector still edits the selected logical model segment.
    expect(useCaptionStore.getState().model!.segments.get("s0")!.style.x).toBe(7);
  } finally { act(() => root.unmount()); iframe.remove(); }
});

it("does not transform reordered repeated words with conflicting authored IDs on #24", () => {
  const captions = model([{}, {}]);
  for (const segment of captions.segments.values()) segment.text = "same";
  useCaptionStore.getState().setModel(captions);
  useCaptionStore.getState().selectSegment("s0");
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div class="caption-group"><span id="w1">same</span><span id="w0">same</span></div>';
  const before = doc.body.innerHTML;
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<CaptionPropertyPanel iframeRef={{ current: iframe }} />));
    act(() => commits.get("X position")!(7));
    expect(doc.body.innerHTML).toBe(before);
    expect(useCaptionStore.getState().model!.segments.get("s0")!.style.x).toBe(7);
    expect(useCaptionStore.getState().model!.segments.get("s1")!.style.x).toBeUndefined();
  } finally { act(() => root.unmount()); iframe.remove(); }
});
