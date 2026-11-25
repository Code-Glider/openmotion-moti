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

it("serializes drag, undo and redo snapshots even when the first guarded native write is delayed", async () => {
  const original = await fixture();
  let persisted = original;
  let releaseFirst!: () => void;
  let writeCount = 0;
  io.nativeRead.mockImplementation(async () => persisted);
  io.nativeWrite.mockImplementation(async (_path: string, content: string, expected: string) => {
    if (++writeCount === 1) {
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
    }
    // The next read must observe the actual preceding write, not an invented
    // version of the file. Model an ETag conflict if that invariant is broken.
    expect(expected).toBe(persisted);
    persisted = content;
  });
  const moved = buildModel();
  moved.segments.get("segment-0")!.style = { x: 24, y: -12 };
  useCaptionStore.getState().setModel(moved);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  const api = mount();
  act(() => api.save());
  await vi.waitFor(() => expect(io.nativeWrite).toHaveBeenCalledOnce());
  act(() => {
    useCaptionStore.getState().setModel(buildModel());
    api.save();
    useCaptionStore.getState().setModel(moved);
    api.save();
  });
  // Allow promise continuations to run; the two later transactions must
  // remain behind the delayed native write instead of reading stale HTML.
  await act(async () => { await Promise.resolve(); });
  expect(io.nativeRead).toHaveBeenCalledOnce();
  expect(io.nativeWrite).toHaveBeenCalledOnce();
  expect(io.sidecar).not.toHaveBeenCalled();
  await act(async () => { releaseFirst(); });
  await vi.waitFor(() => expect(io.nativeWrite).toHaveBeenCalledTimes(3));
  const [, first, firstBase] = io.nativeWrite.mock.calls[0];
  const [, undone, undoBase] = io.nativeWrite.mock.calls[1];
  const [, redone, redoBase] = io.nativeWrite.mock.calls[2];
  expect(firstBase).toBe(original);
  expect(first).toContain("translate(24px, -12px)");
  expect(undoBase).toBe(first);
  expect(undone).toBe(original);
  expect(redoBase).toBe(undone);
  expect(redone).toBe(first);
  expect(persisted).toBe(first);
  expect(io.sidecar).not.toHaveBeenCalled();
  expect(useCaptionStore.getState().syncError).toBeNull();
});

it("keeps the newest native failure visible and permits an explicit ordered retry", async () => {
  const original = await fixture();
  const moved = buildModel();
  moved.segments.get("segment-0")!.style = { x: 24, y: -12 };
  io.nativeRead.mockResolvedValue(original);
  io.nativeWrite.mockRejectedValueOnce(new Error("FILE_VERSION_CONFLICT"));
  useCaptionStore.getState().setModel(moved);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  const api = mount();
  act(() => api.save());
  await vi.waitFor(() => expect(useCaptionStore.getState().syncError)
    .toBe("Caption changes couldn't be saved"));
  act(() => api.save());
  await vi.waitFor(() => expect(io.nativeWrite).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(useCaptionStore.getState().syncError).toBeNull());
  expect(io.nativeWrite.mock.calls[1]).toEqual(io.nativeWrite.mock.calls[0]);
});


it("rejects a stale explicit word ID without applying its positional fallback or later overrides", async () => {
  const model = buildModel();
  model.segments.get("segment-0")!.wordId = "authored-hebrew";
  model.segments.get("segment-1")!.wordId = "authored-latin";
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.sidecar.mockResolvedValue({
    ok: true,
    json: async () => ({
      content: JSON.stringify([
        { wordId: "deleted-hebrew", wordIndex: 0, x: 100 },
        { wordId: "authored-latin", wordIndex: 1, x: 200 },
      ]),
    }),
  });
  const api = mount();
  await act(async () => { await api.loadOverrides(); });
  expect(useCaptionStore.getState().syncError).toMatch(/corrupt/);
  expect(useCaptionStore.getState().model?.segments.get("segment-0")?.style).toEqual({});
  expect(useCaptionStore.getState().model?.segments.get("segment-1")?.style).toEqual({});
  expect(io.nativeWrite).not.toHaveBeenCalled();
});

it("rejects duplicate authored word IDs instead of applying the second override", async () => {
  const model = buildModel();
  model.segments.get("segment-0")!.wordId = "authored-hebrew";
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.sidecar.mockResolvedValue({
    ok: true,
    json: async () => ({
      content: JSON.stringify([
        { wordId: "authored-hebrew", wordIndex: 0, x: 10 },
        { wordId: "authored-hebrew", wordIndex: 0, x: 99 },
      ]),
    }),
  });
  const api = mount();
  await act(async () => { await api.loadOverrides(); });
  expect(useCaptionStore.getState().syncError).toMatch(/corrupt/);
  expect(useCaptionStore.getState().model?.segments.get("segment-0")?.style).toEqual({});
});

it("loads stable-ID overrides by identity and preserves anonymous legacy positional overrides", async () => {
  const model = buildModel();
  model.segments.get("segment-0")!.wordId = "authored-hebrew";
  model.segments.get("segment-1")!.wordId = "authored-latin";
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.sidecar.mockResolvedValue({
    ok: true,
    json: async () => ({
      content: JSON.stringify([
        { wordId: "authored-latin", wordIndex: 0, x: 17 },
        { wordIndex: 0, y: -8 },
      ]),
    }),
  });
  const api = mount();
  await act(async () => { await api.loadOverrides(); });
  expect(useCaptionStore.getState().syncError).toBeNull();
  expect(useCaptionStore.getState().model?.segments.get("segment-0")?.style).toEqual({ y: -8 });
  expect(useCaptionStore.getState().model?.segments.get("segment-1")?.style).toEqual({ x: 17 });
});


it("refuses an explicit word ID shared by two authored model segments", async () => {
  const model = buildModel();
  model.segments.get("segment-0")!.wordId = "duplicate-authored-id";
  model.segments.get("segment-1")!.wordId = "duplicate-authored-id";
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.sidecar.mockResolvedValue({
    ok: true,
    json: async () => ({
      content: JSON.stringify([
        { wordId: "duplicate-authored-id", wordIndex: 0, x: 42 },
      ]),
    }),
  });
  const api = mount();
  await act(async () => { await api.loadOverrides(); });
  expect(useCaptionStore.getState().syncError).toMatch(/corrupt/);
  expect(useCaptionStore.getState().model?.segments.get("segment-0")?.style).toEqual({});
  expect(useCaptionStore.getState().model?.segments.get("segment-1")?.style).toEqual({});
  expect(io.nativeWrite).not.toHaveBeenCalled();
});


it.each([
  { label: "empty explicit ID", row: { wordId: "", wordIndex: 0, x: 77 } },
  { label: "whitespace explicit ID", row: { wordId: "   ", wordIndex: 0, x: 77 } },
  { label: "null explicit ID", row: { wordId: null, wordIndex: 0, x: 77 } },
  { label: "numeric explicit ID", row: { wordId: 123, wordIndex: 0, x: 77 } },
  { label: "negative legacy index", row: { wordIndex: -1, x: 77 } },
  { label: "fractional legacy index", row: { wordIndex: 0.5, x: 77 } },
  { label: "out-of-range legacy index", row: { wordIndex: 200, x: 77 } },
  { label: "string legacy index", row: { wordIndex: "0", x: 77 } },
  { label: "null entry", row: null },
])("atomically rejects $label without positional retargeting", async ({ row }) => {
  const model = buildModel();
  model.segments.get("segment-0")!.wordId = "authored-hebrew";
  model.segments.get("segment-1")!.wordId = "authored-latin";
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  const original = useCaptionStore.getState().model;
  io.sidecar.mockResolvedValue({
    ok: true,
    json: async () => ({ content: JSON.stringify([
      { wordId: "authored-latin", wordIndex: 1, x: 50 },
      row,
    ]) }),
  });
  const api = mount();
  await act(async () => { await api.loadOverrides(); });
  expect(useCaptionStore.getState().syncError).toMatch(/corrupt/);
  expect(useCaptionStore.getState().model).toBe(original);
  expect(useCaptionStore.getState().model?.segments.get("segment-0")?.style).toEqual({});
  expect(useCaptionStore.getState().model?.segments.get("segment-1")?.style).toEqual({});
  expect(io.nativeWrite).not.toHaveBeenCalled();
});

it("retains valid identity-free legacy index zero and stable-ID precedence", async () => {
  const model = buildModel();
  model.segments.get("segment-0")!.wordId = "authored-hebrew";
  model.segments.get("segment-1")!.wordId = "authored-latin";
  useCaptionStore.getState().setModel(model);
  useCaptionStore.getState().setSourceFilePath("captions.html");
  io.sidecar.mockResolvedValue({
    ok: true,
    json: async () => ({ content: JSON.stringify([
      { wordIndex: 0, y: -8 },
      { wordId: "authored-latin", wordIndex: 0, x: 17 },
    ]) }),
  });
  const api = mount();
  await act(async () => { await api.loadOverrides(); });
  expect(useCaptionStore.getState().syncError).toBeNull();
  expect(useCaptionStore.getState().model?.segments.get("segment-0")?.style).toEqual({ y: -8 });
  expect(useCaptionStore.getState().model?.segments.get("segment-1")?.style).toEqual({ x: 17 });
});
