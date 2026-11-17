// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioRow } from "./AudioRow";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";
import { usePlayerStore } from "../../player/store/playerStore";

vi.mock("./AudioAssetWaveform", () => ({ AudioAssetWaveform: () => <span /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class PreviewAudio {
  static instances: PreviewAudio[] = [];
  src = "";
  currentTime = 0;
  duration = 24;
  ended = false;
  paused = true;
  preload = "";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor() { PreviewAudio.instances.push(this); }
}
let root: Root;
let host: HTMLDivElement;
const props = { projectId: "p1", asset: "assets/voice.wav", used: false, onCopy: vi.fn(), copyFeedback: null };
const button = () => host.querySelector<HTMLButtonElement>('button[aria-label*="preview of"]')!;
const render = (node = <AudioRow {...props} />) => act(() => root.render(node));
const toggle = async () => { await act(async () => { button().click(); }); };

beforeEach(() => {
  PreviewAudio.instances = [];
  vi.stubGlobal("Audio", PreviewAudio);
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // The old row required a Web Audio graph even for native audition.
  vi.stubGlobal("AudioContext", class {
    state = "running";
    destination = {};
    createAnalyser = () => ({ connect: vi.fn(), frequencyBinCount: 128, getByteFrequencyData: vi.fn() });
    createMediaElementSource = () => ({ connect: vi.fn() });
    close = vi.fn();
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => { useAssetPreviewStore.getState().clearPreviewAsset(); usePlayerStore.getState().reset(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("audio asset audition", () => {
  it("resumes a paused source instead of restarting it", async () => {
    render();
    await toggle();
    const audio = PreviewAudio.instances[0];
    audio.currentTime = 7;
    await toggle();
    expect(audio.paused).toBe(true);
    await toggle();
    expect(audio.currentTime).toBe(7);
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });

  it("stops a row before opening the full asset preview", async () => {
    render();
    await toggle();
    act(() => useAssetPreviewStore.getState().setPreviewAsset(props.asset, props.projectId));
    expect(PreviewAudio.instances[0].paused).toBe(true);
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("resets the previous asset when switching auditions, including a paused one", async () => {
    render(<><AudioRow {...props} /><AudioRow {...props} asset="assets/music.mp3" /></>);
    const buttons = host.querySelectorAll<HTMLButtonElement>('button[aria-label*="preview of"]');
    await act(async () => buttons[0].click());
    const first = PreviewAudio.instances[0];
    first.currentTime = 7;
    await act(async () => buttons[0].click());
    await act(async () => buttons[1].click());
    expect(first.currentTime).toBe(0);
    expect(first.paused).toBe(true);
    expect(PreviewAudio.instances[1].paused).toBe(false);
    expect(usePlayerStore.getState().playbackRequest?.playing).toBe(false);
  });

  it("does not revive a pending play after a later audition or a project switch", async () => {
    render();
    let resolvePlay!: () => void;
    PreviewAudio.instances[0].play.mockImplementationOnce(() => new Promise<void>(resolve => { resolvePlay = resolve; }));
    await toggle();
    expect(button().getAttribute("aria-busy")).toBe("true");
    render(<AudioRow {...props} projectId="p2" />);
    await act(async () => resolvePlay());
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(PreviewAudio.instances[0].paused).toBe(true);
    expect(PreviewAudio.instances[0].load).toHaveBeenCalled();
    expect(PreviewAudio.instances[1].src).toContain("/p2/");
  });

  it("reports play failure with a Toast outside the list", async () => {
    render();
    PreviewAudio.instances[0].play.mockRejectedValueOnce(new Error("decode failed"));
    await toggle();
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Preview");
  });

  it("probes duration, shows elapsed time and restarts after natural completion", async () => {
    render();
    const audio = PreviewAudio.instances[0];
    act(() => audio.onloadedmetadata?.());
    expect(host.querySelector('.motion-audio-time')?.textContent).toBe("00:24");
    await toggle();
    act(() => { audio.currentTime = 7; audio.ontimeupdate?.(); });
    expect(host.querySelector('.motion-audio-time')?.textContent).toBe("00:07 / 00:24");
    act(() => audio.onended?.());
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(audio.currentTime).toBe(0);
    await toggle();
    expect(audio.paused).toBe(false);
  });

  it("isolates audition pointer events from the row preview action", async () => {
    render();
    act(() => {
      button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 }));
      button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 5, clientY: 5 }));
    });
    await toggle();
    expect(useAssetPreviewStore.getState().previewAsset).toBeNull();
  });
});
