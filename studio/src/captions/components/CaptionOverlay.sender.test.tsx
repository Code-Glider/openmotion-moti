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
