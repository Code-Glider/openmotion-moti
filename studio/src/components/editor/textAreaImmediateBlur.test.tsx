// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TextAreaField } from "./propertyPanelSections";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/**
 * Native keyboard text replacement can send a React input and a Tab/blur
 * in one browser task. React hasn't committed the draft state yet, so the
 * blur path must use the latest input value rather than an earlier render.
 */
it.each([
  { script: "Hebrew with niqqud", source: "שלום OpenMotion 2026", replacement: "שָׁלוֹם OpenMotion 2030" },
  { script: "Arabic with harakat", source: "السَّلَامُ 25%", replacement: "السَّلَامُ 52%" },
  { script: "Persian digits", source: "فارسی ۲۰۲۶", replacement: "فارسی ۲۰۶۲" },
  { script: "Urdu", source: "اردو ٹ ڈ ڑ ں ے", replacement: "اردو ڈ ٹ ڑ ں ے" },
  { script: "Syriac", source: "ܫܠܡܐ ܒܪܝܟܐ", replacement: "ܒܪܝܟܐ ܫܠܡܐ" },
  { script: "English LTR control", source: "Render ABC-123", replacement: "Render DEF-456" },
])("commits the last $script Unicode input even when the editor blurs before React re-renders",
  async ({ source, replacement }) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCommit = vi.fn();
    try {
      act(() => root.render(<TextAreaField flat label="Content" value={source} onCommit={onCommit} />));
      const textarea = host.querySelector("textarea");
      expect(textarea).not.toBeNull();
      expect(textarea!.value).toBe(source);
      const nativeValue = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value",
      )?.set;
      expect(nativeValue).toBeTypeOf("function");
      act(() => {
        textarea!.focus();
        nativeValue!.call(textarea, replacement);
        textarea!.dispatchEvent(new Event("input", { bubbles: true }));
        // Same task: trigger the blur before the state update has rendered.
        textarea!.blur();
      });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(replacement);
      // The pending debounce must have been cancelled by the blur commit.
      await new Promise((resolve) => setTimeout(resolve, 160));
      expect(onCommit).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });


/**
 * On an actual IME, provisional input events may precede compositionend by
 * several hundred milliseconds. Never publish a half-formed grapheme as a
 * project edit, regardless of the regular 120ms non-IME debounce.
 */
it.each([
  { script: "Hebrew niqqud", preedit: "שָׁ", committed: "שָׁלוֹם ABC 12" },
  { script: "Arabic harakat", preedit: "السَّ", committed: "السَّلَامُ 25%" },
  { script: "Persian", preedit: "فار", committed: "فارسی ۲۰۲۶" },
  { script: "Urdu", preedit: "ارد", committed: "اردو ٹ ڈ ڑ ں ے" },
  { script: "Syriac", preedit: "ܫܠ", committed: "ܫܠܡܐ ܒܪܝܟܐ" },
  { script: "English LTR", preedit: "Compo", committed: "Composition ABC-123" },
])("does not debounce-save a provisional $script composition", async ({ preedit, committed }) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  const setNative = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  expect(setNative).toBeTypeOf("function");
  try {
    act(() => root.render(<TextAreaField flat label="Content" value="" onCommit={onCommit} />));
    const textarea = host.querySelector("textarea")!;
    act(() => {
      textarea.focus();
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      setNative!.call(textarea, preedit);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: preedit, inputType: "insertCompositionText", isComposing: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 175));
    expect(onCommit, "debounce fired while the IME preedit was active").not.toHaveBeenCalled();
    act(() => {
      setNative!.call(textarea, committed);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: committed, inputType: "insertCompositionText", isComposing: true }));
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: committed }));
      textarea.blur();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(committed);
    await new Promise(resolve => setTimeout(resolve, 175));
    expect(onCommit).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("defers blur during active composition until compositionend without losing the final RTL text", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  const finalText = "شکریہ ܫܠܡܐ שָׁלוֹם";
  const setNative = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  try {
    act(() => root.render(<TextAreaField flat label="Content" value="" onCommit={onCommit} />));
    const textarea = host.querySelector("textarea")!;
    act(() => {
      textarea.focus();
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      setNative.call(textarea, finalText);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true }));
      textarea.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: finalText })));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(finalText);
    await new Promise(resolve => setTimeout(resolve, 160));
    expect(onCommit).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
