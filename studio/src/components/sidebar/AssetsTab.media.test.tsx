// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetsTab } from "./AssetsTab";
import { probeMediaUrl, type MediaProbeResult } from "../../player/lib/mediaProbe";
import { usePlayerStore } from "../../player/store/playerStore";

vi.mock("../../utils/studioApiFetch", () => ({ studioApiFetch: vi.fn(async () => ({ ok: false })) }));
vi.mock("../../player/lib/mediaProbe", () => ({ probeMediaUrl: vi.fn() }));
vi.mock("./AudioRow", () => ({ AudioRow: ({ asset }: { asset: string }) => <div data-audio-row>{asset}</div> }));
vi.mock("./AssetCard", () => ({
  AssetCard: ({ asset }: { asset: string }) => <div data-video-card>{asset}</div>,
  FontRow: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
const audio = { hasAudio: true, hasVideo: false, duration: 10 };
const video = { hasAudio: true, hasVideo: true, duration: 10 };

beforeEach(() => {
  vi.mocked(probeMediaUrl).mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  usePlayerStore.getState().reset();
});
async function render(assets: string[], projectId = "test") {
  await act(async () => root.render(<AssetsTab projectId={projectId} assets={assets} />));
}
const chip = (label: string) => Array.from(host.querySelectorAll("button")).find(button => button.textContent?.trim() === label)!;

it("groups audio-only MP4 with native audio rows and keeps both type filters accurate", async () => {
  vi.mocked(probeMediaUrl).mockImplementation(async url => url.endsWith("voice.mp4") ? audio : video);
  await render(["assets/voice.mp4", "assets/music.m4a", "assets/sound.mp3", "assets/video.mp4"]);
  expect(host.querySelectorAll("[data-audio-row]")).toHaveLength(3);
  expect(host.querySelector("[data-video-card]")?.textContent).toBe("assets/video.mp4");
  expect(probeMediaUrl).toHaveBeenCalledTimes(2);
  act(() => chip("Audio 3").click());
  expect(host.querySelectorAll("[data-audio-row]")).toHaveLength(3);
  expect(host.querySelector("[data-video-card]")).toBeNull();
  act(() => chip("Video 1").click());
  expect(host.querySelectorAll("[data-video-card]")).toHaveLength(1);
  expect(host.querySelector("[data-audio-row]")).toBeNull();
});

it.each([video, { ...video, hasAudio: false }, null])("keeps video cards when metadata does not confirm audio-only content: %j", async metadata => {
  vi.mocked(probeMediaUrl).mockResolvedValue(metadata);
  await render(["assets/video.mp4"]);
  expect(host.querySelector("[data-audio-row]")).toBeNull();
  expect(host.querySelector("[data-video-card]")?.textContent).toBe("assets/video.mp4");
});

it("discards a late probe from the previous project even when the asset path is identical", async () => {
  let finishOld!: (result: MediaProbeResult) => void;
  vi.mocked(probeMediaUrl).mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; })).mockResolvedValueOnce(video);
  await render(["assets/clip.mp4"], "old");
  await render(["assets/clip.mp4"], "new");
  await act(async () => finishOld(audio));
  expect(host.querySelector("[data-audio-row]")).toBeNull();
  expect(host.querySelector("[data-video-card]")).not.toBeNull();
});

it("removes audio-only classification immediately when switching projects", async () => {
  vi.mocked(probeMediaUrl).mockResolvedValueOnce(audio).mockReturnValueOnce(new Promise(() => {}));
  await render(["assets/clip.mp4"], "old");
  expect(host.querySelector("[data-audio-row]")).not.toBeNull();
  await render(["assets/clip.mp4"], "new");
  expect(host.querySelector("[data-audio-row]")).toBeNull();
  expect(host.querySelector("[data-video-card]")).not.toBeNull();
});
