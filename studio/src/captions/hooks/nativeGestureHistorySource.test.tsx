// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { buildCaptionModel } from "../parser";
import { managedCaptionScriptTag } from "../nativeSource";
import { useCaptionStore } from "../store";
import { useCaptionSync } from "./useCaptionSync";

const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), sidecar: vi.fn() }));
vi.mock("../../hooks/useProjectFileWriter", () => ({
  useProjectFileWriter: () => ({ readProjectFile: io.read, writeProjectFile: io.write }),
}));
vi.mock("../../utils/studioApiFetch", () => ({ studioApiFetch: io.sidecar }));
afterEach(() => { useCaptionStore.getState().reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("persists two distinct pointer transactions, undo and redo to managed native source", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Date, "now").mockReturnValue(42_000);
  const model = buildCaptionModel([
    { id: "he", text: "שָׁלוֹם", start: 0, end: 0.6 },
    { id: "en", text: "ABC-123", start: 0.65, end: 1 },
  ], { width: 640, height: 360, duration: 2, wordsPerGroup: 2 });
  const source = '<!doctype html><html><body><div id="captions-container" data-composition-id="captions" data-width="640" data-height="360" data-duration="2"></div>'
    + await managedCaptionScriptTag(model) + '</body></html>';
  let persisted = source;
  io.read.mockReset().mockImplementation(async () => persisted);
  io.write.mockReset().mockImplementation(async (path: string, next: string, expected: string) => {
    expect(path).toBe("captions.html");
    expect(expected).toBe(persisted);
    persisted = next;
  });
  io.sidecar.mockReset().mockResolvedValue({ ok: true });
  useCaptionStore.getState().reset();
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  let api!: ReturnType<typeof useCaptionSync>;
  function Harness() { api = useCaptionSync("project"); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  try {
    const save = async (count: number) => {
      act(() => api.save());
      await vi.waitFor(() => expect(io.write).toHaveBeenCalledTimes(count));
      expect(persisted).toContain("שָׁלוֹם");
      expect(persisted).toContain("ABC-123");
      expect(useCaptionStore.getState().model!.segments.get("segment-1")!.style).toEqual({});
      return persisted;
    };
    act(() => useCaptionStore.getState().updateSegmentStyle("segment-0", { x: 24, y: -12 }, { distinctHistory: true }));
    const first = await save(1);
    expect(first).toContain("translate(24px, -12px)");
    act(() => useCaptionStore.getState().updateSegmentStyle("segment-0", { x: 40, y: -12 }, { distinctHistory: true }));
    const second = await save(2);
    expect(second).toContain("translate(40px, -12px)");
    expect(useCaptionStore.getState().past).toHaveLength(2);
    act(() => expect(useCaptionStore.getState().undo()).not.toBeNull());
    expect(await save(3)).toBe(first);
    act(() => expect(useCaptionStore.getState().redo()).not.toBeNull());
    expect(await save(4)).toBe(second);
    expect(io.sidecar).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});
