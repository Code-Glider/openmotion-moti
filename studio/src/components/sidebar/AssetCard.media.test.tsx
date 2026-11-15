// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetCard } from "./AssetCard";
import { probeMediaUrl, type MediaProbeResult } from "../../player/lib/mediaProbe";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";

vi.mock("../../player/lib/mediaProbe", () => ({ probeMediaUrl: vi.fn() }));
vi.mock("../ui/VideoFrameThumbnail", () => ({ VideoFrameThumbnail: () => <div data-video-thumbnail /> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const props = { projectId: "p1", used: false, onCopy: vi.fn(), copyFeedback: null };
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useAssetPreviewStore.getState().clearPreviewAsset();
});
async function render(asset: string, duration?: number) {
  await act(async () => root.render(<AssetCard {...props} asset={asset} duration={duration} />));
}
function hover() {
  act(() => host.querySelector('[draggable="true"]')!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
}

it("uses an audio cover for an audio-only MP4 even with known duration, retaining preview activation", async () => {
  vi.mocked(probeMediaUrl).mockResolvedValue({ hasAudio: true, hasVideo: false, duration: 10 });
  await render("assets/voice.mp4", 10);
  hover();
  expect(host.querySelector("[data-audio-cover]")?.textContent).toBe("");
  expect(host.querySelector("[data-audio-cover]")?.getAttribute("aria-label")).toBe("Audio");
  expect(host.querySelector('[data-audio-cover] svg path')).not.toBeNull();
  expect(host.querySelector("[data-video-thumbnail]")).toBeNull();
  expect(host.querySelector("video")).toBeNull();
  expect(host.textContent).toContain("00:10");
  act(() => host.querySelector('[draggable="true"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(useAssetPreviewStore.getState().previewAsset).toBe("assets/voice.mp4");
});

it.each([true, false])("keeps a normal video's thumbnail and hover preview when hasAudio is %s", async hasAudio => {
  vi.mocked(probeMediaUrl).mockResolvedValue({ hasAudio, hasVideo: true, duration: 10 });
  await render("assets/video.mp4");
  hover();
  expect(host.querySelector("[data-audio-cover]")).toBeNull();
  expect(host.querySelector("[data-video-thumbnail]")).not.toBeNull();
  expect(host.querySelector("video")?.getAttribute("src")).toContain("video.mp4");
});

it("does not mislabel an unreadable video as audio", async () => {
  vi.mocked(probeMediaUrl).mockResolvedValue(null);
  await render("assets/unreadable.mp4");
  expect(host.querySelector("[data-audio-cover]")).toBeNull();
  expect(host.querySelector("[data-video-thumbnail]")).not.toBeNull();
});

it("ignores stale audio metadata after the card changes source", async () => {
  let resolve!: (value: MediaProbeResult) => void;
  vi.mocked(probeMediaUrl).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await render("assets/voice.mp4");
  await render("assets/photo.png");
  await act(async () => resolve({ hasAudio: true, hasVideo: false, duration: 10 }));
  expect(host.querySelector("[data-audio-cover]")).toBeNull();
  expect(host.querySelector("img")?.getAttribute("src")).toContain("photo.png");
});
