// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { buildCaptionModel } from "../parser";
import { managedCaptionScriptTag } from "../nativeSource";
import { useCaptionStore } from "../store";
import { useCaptionSync } from "./useCaptionSync";

const io = vi.hoisted(() => ({
  nativeRead: vi.fn(),
  nativeWrite: vi.fn(),
  sidecar: vi.fn(),
}));

vi.mock("../../hooks/useProjectFileWriter", () => ({
  useProjectFileWriter: () => ({
    readProjectFile: io.nativeRead,
    writeProjectFile: io.nativeWrite,
  }),
}));
vi.mock("../../utils/studioApiFetch", () => ({
  studioApiFetch: io.sidecar,
}));

let root: Root;
function buildModel() {
  return buildCaptionModel([
    { id: "he-1", text: "שָׁלוֹם", start: 0, end: 0.6 },
    { id: "latin-1", text: "ABC-123", start: 0.65, end: 1 },
  ], { width: 640, height: 360, duration: 2, wordsPerGroup: 2 });
}

async function fixture() {
  return '<!doctype html><html><body><div id="captions-container" data-composition-id="captions" ' +
    'data-width="640" data-height="360" data-duration="2"></div>' +
    await managedCaptionScriptTag(buildModel()) + '</body></html>';
}

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  // Happy DOM's WebCrypto may be narrower than Chromium. Production uses
  // crypto.subtle; supply Node's real SHA-256 rather than a fake digest.
  vi.stubGlobal("crypto", webcrypto);
  io.nativeRead.mockReset();
  io.nativeWrite.mockReset().mockResolvedValue(undefined);
  io.sidecar.mockReset().mockResolvedValue({ ok: true });
  useCaptionStore.getState().reset();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  useCaptionStore.getState().reset();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mount(projectId = "p") {
  let api!: ReturnType<typeof useCaptionSync>;
  function Harness() {
    api = useCaptionSync(projectId);
    return null;
  }
  act(() => root.render(<Harness />));
  return api;
}

it("writes managed RTL native source without an unconditional legacy sidecar PUT", async () => {
  const original = await fixture();
  const model = buildModel();
  model.segments.get("segment-0")!.style = { x: 24, y: -12, rotation: 8, scaleX: 1.4, scaleY: 0.8 };
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.nativeRead.mockResolvedValue(original);
  const api = mount();
  act(() => api.save());
  await vi.waitFor(() => expect(io.nativeWrite).toHaveBeenCalledOnce());
  const [path, content, expected] = io.nativeWrite.mock.calls[0];
  expect(path).toBe("captions.html");
  expect(expected).toBe(original);
  expect(content).toContain('translate(24px, -12px) rotate(8deg) scale(1.4, 0.8)');
  expect(content).toContain("שָׁלוֹם");
  expect(content).toContain("ABC-123");
  // The legacy PUT lacks a version precondition. The real API responds 428
  // and blocked every managed native save, so it must not run here.
  expect(io.sidecar).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(useCaptionStore.getState().syncError).toBeNull());
});

it("does not overwrite unmarked legacy caption HTML", async () => {
  const legacy = '<!doctype html><div data-composition-id="captions"></div><script>window.custom=1</script>';
  useCaptionStore.getState().setModel(buildModel());
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.nativeRead.mockResolvedValue(legacy);
  const api = mount();
  act(() => api.save());
  await vi.waitFor(() => expect(io.sidecar).toHaveBeenCalledOnce());
  expect(io.nativeRead).toHaveBeenCalledOnce();
  expect(io.nativeWrite).not.toHaveBeenCalled();
  expect(useCaptionStore.getState().syncError).toBeNull();
});

it("does not conceal native ETag conflicts behind a successful sidecar write", async () => {
  const model = buildModel();
  model.segments.get("segment-0")!.style = { x: 16, y: -5 };
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.nativeRead.mockResolvedValue(await fixture());
  io.nativeWrite.mockRejectedValue(new Error("FILE_VERSION_CONFLICT"));
  const api = mount();
  act(() => api.save());
  await vi.waitFor(() =>
    expect(useCaptionStore.getState().syncError).toBe("Caption changes couldn't be saved"));
  expect(io.nativeWrite).toHaveBeenCalledOnce();
  expect(io.sidecar).not.toHaveBeenCalled();
});
