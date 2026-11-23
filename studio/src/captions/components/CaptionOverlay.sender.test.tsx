// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CaptionOverlay } from "./CaptionOverlay";
import { useCaptionStore } from "../store";
import { DEFAULT_ANIMATION_SET, DEFAULT_STYLE, DEFAULT_CONTAINER } from "../types";
import { applyCaptionModelToIframe, readGsapTransform, getOrCreateWrapper } from "./CaptionOverlayUtils";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("persists a return to the authored caption position through undo and redo", () => {
  const host = document.createElement("div");
  const preview = document.createElement("iframe");
  document.body.append(host, preview);
  preview.style.width = "640px";
  const root = createRoot(host);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const doc = preview.contentDocument!;
  const group = doc.createElement("div");
  group.className = "caption-group";
  group.dataset.captionGroup = "g";
  group.dir = "rtl";
  const word = doc.createElement("span");
  word.textContent = "שָׁלוֹם";
  word.style.transform = "rotate(7deg)";
  const authoredHTML = word.outerHTML;
  group.append(word);
  doc.body.append(group);
  const segment = {
    id: "s", wordId: "w0", text: word.textContent, start: 0.25, end: 1.5,
    groupIndex: 0, style: {}, animation: {},
  };
  useCaptionStore.getState().reset();
  useCaptionStore.getState().setModel({
    width: 640, height: 360, duration: 3,
    segments: new Map([["s", segment]]),
    groups: new Map([["g", {
      id: "g", segmentIds: ["s"], style: DEFAULT_STYLE,
      animation: DEFAULT_ANIMATION_SET, containerStyle: DEFAULT_CONTAINER,
    }]]),
    groupOrder: ["g"], defaultAnimation: DEFAULT_ANIMATION_SET,
  });
  useCaptionStore.getState().setEditMode(true);
  useCaptionStore.getState().selectSegment("s");
  const press = (key: string) => act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  try {
    act(() => root.render(<CaptionOverlay iframeRef={{ current: preview }} />));
    press("ArrowRight");
    expect(useCaptionStore.getState().model!.segments.get("s")!.style.x).toBe(1);
    now += 1000; // Separate intentional edits, rather than one coalesced nudge.
    press("ArrowLeft");
    expect(useCaptionStore.getState().model!.segments.get("s")!.style.x).toBe(0);
    for (const [operation, x] of [["undo", 1], ["redo", 0]] as const) {
      act(() => {
        const restored = useCaptionStore.getState()[operation]();
        expect(restored).not.toBeNull();
        applyCaptionModelToIframe(restored!);
      });
      expect(readGsapTransform(getOrCreateWrapper(word), preview.contentWindow!).x).toBe(x);
      expect(useCaptionStore.getState().model!.segments.get("s")).toMatchObject({
        ...segment, style: { x },
      });
      expect(word.outerHTML).toBe(authoredHTML);
      expect(group.textContent).toBe(segment.text);
      expect(group.querySelector("[data-caption-wrapper]")!.firstChild).toBe(word);
      expect(group.querySelectorAll("[data-caption-wrapper]")).toHaveLength(1);
    }
  } finally {
    act(() => root.unmount());
    useCaptionStore.getState().reset();
    host.remove();
    preview.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("only schedules caption layout for messages from its preview", () => {
  const host = document.createElement("div");
  const preview = document.createElement("iframe");
  const foreign = document.createElement("iframe");
  document.body.append(host, preview, foreign);
  const root = createRoot(host);
  // A model refresh may already have queued a frame on mount; drain that
  // initial request before checking which message origins schedule a new one.
  const callbacks: FrameRequestCallback[] = [];
  const schedule = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("requestAnimationFrame", schedule);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  useCaptionStore.getState().setEditMode(true);
  const send = (source: MessageEventSource | null) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source, data: { source: "hf-preview" } }));
    });
  try {
    act(() => root.render(<CaptionOverlay iframeRef={{ current: preview }} />));
    act(() => { for (const callback of callbacks.splice(0)) callback(0); });
    schedule.mockClear();
    send(foreign.contentWindow);
    send(null);
    expect(schedule).not.toHaveBeenCalled();
    send(preview.contentWindow);
    send(preview.contentWindow); // Coalesced while the previous frame remains pending.
    expect(schedule).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    useCaptionStore.getState().reset();
    host.remove();
    preview.remove();
    foreign.remove();
    vi.unstubAllGlobals();
  }
});

it("observes and accepts messages from the promoted iframe, not the old one", () => {
  const host = document.createElement("div");
  const a = document.createElement("iframe");
  const b = document.createElement("iframe");
  document.body.append(host, a, b);
  const ref = { current: a };
  const root = createRoot(host);
  const schedule = vi.fn(() => 1);
  const observed: Element[] = [];
  vi.stubGlobal("requestAnimationFrame", schedule);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
    },
  );
  useCaptionStore.getState().setEditMode(true);
  const send = (source: MessageEventSource | null) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source, data: { source: "hf-preview" } }));
    });
  try {
    act(() => usePreviewIframeStore.getState().setIframe(a));
    act(() => root.render(<CaptionOverlay iframeRef={ref} />));
    expect(observed).toContain(a);
    expect(observed).not.toContain(b);
    act(() => {
      ref.current = b;
      usePreviewIframeStore.getState().setIframe(b);
    });
    expect(observed).toContain(b);
    schedule.mockClear();
    send(a.contentWindow);
    expect(schedule).not.toHaveBeenCalled();
    send(b.contentWindow);
    expect(schedule).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    usePreviewIframeStore.setState({ iframe: null });
    useCaptionStore.getState().reset();
    host.remove();
    a.remove();
    b.remove();
    vi.unstubAllGlobals();
  }
});


it("begins observing its iframe when caption editing is enabled after mount", () => {
  const host = document.createElement("div");
  const preview = document.createElement("iframe");
  document.body.append(host, preview);
  const root = createRoot(host);
  // A model refresh may already have queued a frame on mount; drain that
  // initial request before checking which message origins schedule a new one.
  const callbacks: FrameRequestCallback[] = [];
  const schedule = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("requestAnimationFrame", schedule);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useCaptionStore.getState().setEditMode(false);
  try {
    act(() => root.render(<CaptionOverlay iframeRef={{ current: preview }} />));
    act(() => useCaptionStore.getState().setEditMode(true));
    act(() => { for (const callback of callbacks.splice(0)) callback(0); });
    schedule.mockClear();
    act(() => window.dispatchEvent(new MessageEvent("message", {
      source: preview.contentWindow, data: { source: "hf-preview" },
    })));
    expect(schedule).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    useCaptionStore.getState().reset();
    host.remove();
    preview.remove();
    vi.unstubAllGlobals();
  }
});

it("requests caption hit remeasurement on model changes without a player event", () => {
  const host = document.createElement("div");
  const preview = document.createElement("iframe");
  document.body.append(host, preview);
  const root = createRoot(host);
  const callbacks: FrameRequestCallback[] = [];
  const schedule = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("requestAnimationFrame", schedule);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useCaptionStore.getState().reset();
  useCaptionStore.getState().setEditMode(true);
  try {
    act(() => root.render(<CaptionOverlay iframeRef={{ current: preview }} />));
    act(() => { for (const callback of callbacks.splice(0)) callback(0); });
    schedule.mockClear();
    act(() => useCaptionStore.getState().setModel({
      width: 640, height: 360, duration: 3,
      segments: new Map(), groups: new Map(), groupOrder: [],
      defaultAnimation: DEFAULT_ANIMATION_SET,
    }));
    expect(schedule).toHaveBeenCalledOnce();
    act(() => { for (const callback of callbacks.splice(0)) callback(0); });
    schedule.mockClear();
    act(() => useCaptionStore.getState().setModel(null));
    expect(schedule).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    useCaptionStore.getState().reset();
    host.remove();
    preview.remove();
    vi.unstubAllGlobals();
  }
});


it("dispatches caption pointer move, scale and rotate handlers on one stable Hebrew word, with undo and Escape", () => {
  const host = document.createElement("div");
  const iframe = document.createElement("iframe");
  document.body.append(host, iframe);
  iframe.style.width = "640px";
  const doc = iframe.contentDocument!;
  const group = doc.createElement("div");
  group.className = "caption-group";
  group.dataset.captionGroupId = "g";
  group.style.opacity = "1";
  group.dir = "rtl";
  const words = ["w-he-a", "w-he-b"].map(id => {
    const span = doc.createElement("span");
    span.id = id;
    span.className = "word";
    span.textContent = "שָׁלוֹם";
    group.append(span);
    return span;
  });
  doc.body.append(group);
  const originalWords = words.map(word => word.outerHTML);
  const bounds = (x: number, y: number, width: number, height: number) => ({
    x, y, left: x, top: y, right: x + width, bottom: y + height,
    width, height, toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue(bounds(0, 0, 640, 360));
  vi.spyOn(words[0], "getBoundingClientRect").mockReturnValue(bounds(120, 90, 100, 35));
  vi.spyOn(words[1], "getBoundingClientRect").mockReturnValue(bounds(260, 90, 100, 35));
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let clock = 100_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const root = createRoot(host);
  useCaptionStore.getState().reset();
  useCaptionStore.getState().setModel({
    width: 640, height: 360, duration: 3,
    segments: new Map(words.map((word, index) => [
      "s" + index, {
        id: "s" + index, wordId: word.id, text: "שָׁלוֹם",
        start: index * 0.5, end: index * 0.5 + 0.5, groupIndex: 0,
        style: {}, animation: {},
      },
    ] as const)),
    groups: new Map([["g", {
      id: "g", segmentIds: ["s0", "s1"], style: DEFAULT_STYLE,
      animation: DEFAULT_ANIMATION_SET, containerStyle: DEFAULT_CONTAINER,
    }]]),
    groupOrder: ["g"], defaultAnimation: DEFAULT_ANIMATION_SET,
  });
  useCaptionStore.getState().setEditMode(true);
  const flushLayout = () => act(() => {
    for (const cb of callbacks.splice(0)) cb(0);
  });
  const pointer = (target: Element, type: string, x: number, y: number, pointerId = 13) => act(() => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    target.dispatchEvent(event);
  });
  const capture = (element: Element) =>
    Object.defineProperty(element, "setPointerCapture", { configurable: true, value: vi.fn() });
  const modelStyle = () => useCaptionStore.getState().model!.segments.get("s1")!.style;
  const actualStyle = () => readGsapTransform(getOrCreateWrapper(words[1]), iframe.contentWindow!);
  try {
    act(() => root.render(<CaptionOverlay iframeRef={{ current: iframe }} />));
    flushLayout();
    expect(host.querySelectorAll("[data-caption-segment-id]")).toHaveLength(2);
    const hit = host.querySelector<HTMLElement>('[data-caption-segment-id="s1"]')!;
    expect(hit).not.toBeNull();
    act(() => hit.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect([...useCaptionStore.getState().selectedSegmentIds]).toEqual(["s1"]);
    capture(hit);
    clock += 1000;
    pointer(hit, "pointerdown", 285, 105);
    // A second touch cannot steal the gesture, translate the Hebrew word or
    // end the first pointer's pending transaction.
    pointer(hit, "pointerdown", 285, 105, 29);
    pointer(hit, "pointermove", 400, 300, 29);
    pointer(hit, "pointerup", 400, 300, 29);
    pointer(hit, "lostpointercapture", 400, 300, 29);
    expect(actualStyle()).toEqual({ x: 0, y: 0, scale: 1, scaleY: 1, rotation: 0 });
    expect(modelStyle()).toEqual({});
    pointer(hit, "pointermove", 309, 117);
    pointer(hit, "pointerup", 309, 117);
    expect(modelStyle()).toMatchObject({ x: 24, y: 12, scaleX: 1, scaleY: 1, rotation: 0 });

    // Work through the visible corner/rotation handles, not a direct store write.
    const scaleHandle = [...hit.querySelectorAll<HTMLElement>("div")]
      .find(el => el.style.cursor === "nwse-resize")!;
    const rotateHandle = [...hit.querySelectorAll<HTMLElement>("div")]
      .find(el => el.style.cursor === "grab")!;
    expect(scaleHandle).toBeDefined();
    expect(rotateHandle).toBeDefined();
    capture(scaleHandle);
    capture(rotateHandle);
    clock += 1000;
    pointer(scaleHandle, "pointerdown", 360, 105);
    pointer(scaleHandle, "pointermove", 445, 105, 29);
    pointer(scaleHandle, "pointercancel", 445, 105, 29);
    expect(actualStyle().scale).toBe(1);
    pointer(scaleHandle, "pointermove", 385, 105);
    pointer(scaleHandle, "pointerup", 385, 105);
    expect(modelStyle()).toMatchObject({ x: 24, y: 12, scaleX: 1.5, scaleY: 1.5, rotation: 0 });
    clock += 1000;
    pointer(rotateHandle, "pointerdown", 330, 75);
    pointer(rotateHandle, "pointermove", 350, 75);
    pointer(rotateHandle, "pointerup", 350, 75);
    expect(modelStyle()).toMatchObject({ x: 24, y: 12, scaleX: 1.5, scaleY: 1.5, rotation: 9 });

    // The same logical word ID must survive full history replay. No transform
    // may leak onto its visually identical sibling or rewrite either text node.
    for (const expected of [
      { x: 24, y: 12, scale: 1.5, scaleY: 1.5, rotation: 0 },
      { x: 24, y: 12, scale: 1, scaleY: 1, rotation: 0 },
      { x: 0, y: 0, scale: 1, scaleY: 1, rotation: 0 },
    ]) {
      act(() => {
        const restored = useCaptionStore.getState().undo();
        expect(restored).not.toBeNull();
        applyCaptionModelToIframe(restored!);
      });
      expect(actualStyle()).toEqual(expected);
    }
    for (const expected of [
      { x: 24, y: 12, scale: 1, scaleY: 1, rotation: 0 },
      { x: 24, y: 12, scale: 1.5, scaleY: 1.5, rotation: 0 },
      { x: 24, y: 12, scale: 1.5, scaleY: 1.5, rotation: 9 },
    ]) {
      act(() => {
        const restored = useCaptionStore.getState().redo();
        expect(restored).not.toBeNull();
        applyCaptionModelToIframe(restored!);
      });
      expect(actualStyle()).toEqual(expected);
    }

    // Browser pointercancel must roll back the drag without a history entry;
    // the subsequent lostpointercapture must not recommit the cancelled edit.
    const historyLength = useCaptionStore.getState().past.length;
    pointer(hit, "pointerdown", 309, 117);
    pointer(hit, "pointermove", 340, 137);
    expect(actualStyle().x).toBe(55);
    pointer(hit, "pointercancel", 340, 137);
    pointer(hit, "lostpointercapture", 340, 137);
    expect(actualStyle()).toEqual({ x: 24, y: 12, scale: 1.5, scaleY: 1.5, rotation: 9 });
    expect(modelStyle()).toMatchObject({ x: 24, y: 12, scaleX: 1.5, scaleY: 1.5, rotation: 9 });
    expect(useCaptionStore.getState().past).toHaveLength(historyLength);

    // Esc during a new gesture restores the pre-drag transform and MUST NOT
    // create an undo entry; a late pointerup must not re-commit cancelled work.
    pointer(hit, "pointerdown", 309, 117);
    pointer(hit, "pointermove", 340, 137);
    expect(actualStyle().x).toBe(55);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    pointer(hit, "pointerup", 340, 137);
    expect(modelStyle()).toMatchObject({ x: 24, y: 12, scaleX: 1.5, scaleY: 1.5, rotation: 9 });
    expect(actualStyle()).toEqual({ x: 24, y: 12, scale: 1.5, scaleY: 1.5, rotation: 9 });
    expect(useCaptionStore.getState().past).toHaveLength(historyLength);
    expect(useCaptionStore.getState().model!.segments.get("s0")!.style).toEqual({});
    expect(words.map(word => word.outerHTML)).toEqual(originalWords);
    expect(group.textContent).toBe("שָׁלוֹםשָׁלוֹם");
    expect(group.querySelectorAll("[data-caption-wrapper]")).toHaveLength(1);
    expect(group.querySelector('[data-caption-wrapper] > #w-he-b')).toBe(words[1]);
    expect(words[0].parentElement).toBe(group);
  } finally {
    act(() => root.unmount());
    useCaptionStore.getState().reset();
    host.remove();
    iframe.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
