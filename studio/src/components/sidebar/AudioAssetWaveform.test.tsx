// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThumbnailRequest, ThumbnailSnapshot } from "../../player/lib/thumbnailScheduler";
import { I18nProvider } from "../../i18n/I18n";
import { AudioAssetWaveform } from "./AudioAssetWaveform";

const { lease } = vi.hoisted(() => ({ lease: vi.fn((_request: ThumbnailRequest | null): ThumbnailSnapshot => ({ status: "loading" })) }));
vi.mock("../../hooks/useThumbnailLease", () => ({ useThumbnailLease: lease }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const props = { asset: "assets/voice (中文).wav", audioUrl: "/preview/voice.wav", projectId: "p1", sessionEpoch: 1, revision: 0, visible: true };
function mount(override: Partial<typeof props> = {}) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = (input: Partial<typeof props>) => act(() => root.render(<I18nProvider initialLocale="zh-CN"><AudioAssetWaveform {...props} {...input} /></I18nProvider>));
  render(override); return { host, render };
}
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; lease.mockReset().mockReturnValue({ status: "loading" }); vi.restoreAllMocks(); });

describe("audio asset sample preview", () => {
  it("defers work offscreen, uses real peaks, and invalidates a replaced asset", async () => {
    const { host, render } = mount({ visible: false });
    expect(lease).toHaveBeenLastCalledWith(null);
    expect(host.querySelectorAll("line")).toHaveLength(0);
    render({ visible: true });
    const first = lease.mock.lastCall![0]!;
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ peaks: [0, .5, 1, .25] })));
    const result = await first.load(new AbortController().signal);
    expect(fetch.mock.calls[0][0]).toBe("/api/projects/p1/waveform/assets/voice%20(%E4%B8%AD%E6%96%87).wav");
    expect(result.value).toEqual({ kind: "waveform", peaks: [0, .5, 1, .25] });
    lease.mockReturnValue({ status: "ready", value: result.value });
    render({ revision: 1 });
    expect(lease.mock.lastCall![0]!.key).not.toBe(first.key);
    expect(host.querySelectorAll("line")).toHaveLength(64);
    expect(host.querySelector('[role="slider"]')).toBeNull();
  });

  it("shows a localized unavailable state without invented peaks", () => {
    lease.mockReturnValue({ status: "error", error: new Error("missing media") });
    const { host } = mount();
    expect(host.textContent).toContain("波形不可用");
    expect(host.querySelectorAll("line")).toHaveLength(0);
  });

  it("reduces line density in a narrow waveform slot", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(90);
    lease.mockReturnValue({ status: "ready", value: { kind: "waveform", peaks: [0, .5, 1] } });
    const { host } = mount();
    expect(host.querySelectorAll("line")).toHaveLength(30);
  });
});
