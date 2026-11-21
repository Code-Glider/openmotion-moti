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
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(replacement);
      // The pending debounce must have been cancelled by the blur commit.
      await new Promise((resolve) => setTimeout(resolve, 160));
      expect(onCommit).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
