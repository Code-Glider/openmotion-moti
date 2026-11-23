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
 * Real browser text can be visible in the native textarea before the React
 * change handler has observed the final insertion. A blur must persist what
 * the user sees, not a previously rendered or debounced value. This also
 * covers the Windows Studio regression where Arabic 52% was displayed in the
 * inspector but the native project and player still contained 25%.
 */
it.each([
  { script: "Hebrew", before: "שָׁלוֹם OpenMotion 2026", final: "שָׁלוֹם OpenMotion 2030" },
  { script: "Arabic", before: "السَّلَامُ OpenMotion 25%", final: "السَّلَامُ OpenMotion 52%" },
  { script: "Persian", before: "فارسی پ چ ژ گ ۲۰۲۶", final: "فارسی پ چ ژ گ ۲۰۶۲" },
  { script: "Urdu", before: "اردو ٹ ڈ ڑ ں ے", final: "اردو ڈ ٹ ڑ ں ے" },
  { script: "Syriac", before: "ܫܠܡܐ ܒܪܝܟܐ", final: "ܒܪܝܟܐ ܫܠܡܐ" },
  { script: "Ethiopic LTR", before: "ሰላም ኢትዮጵያ", final: "ሰላም አዲስ አበባ" },
  { script: "English LTR", before: "Render ABC-123", final: "Render DEF-456" },
])("saves the live $script Unicode on blur even if the last native insertion precedes React onChange",
  async ({ before, final }) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCommit = vi.fn();
    const setNative = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    expect(setNative).toBeTypeOf("function");
    try {
      act(() => root.render(<TextAreaField flat label="Content" value={before} onCommit={onCommit} />));
      const textarea = host.querySelector("textarea")!;
      const intermediate = before + " draft";
      act(() => {
        textarea.focus();
        setNative!.call(textarea, intermediate);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      // Simulate native text insertion followed by Tab/blur in the same task.
      // Do not synthesize the *second* React input event: the native visible
      // value must win over the last onChange/draft/debounce snapshot.
      act(() => {
        setNative!.call(textarea, final);
        expect(textarea.value).toBe(final);
        textarea.blur();
      });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(final);
      await new Promise(resolve => setTimeout(resolve, 165));
      expect(onCommit, "stale debounce wrote over the final Unicode").toHaveBeenCalledTimes(1);
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


/**
 * The preview/selection model can echo the edited value into the inspector
 * props before the durable native-project edit completes. That echo is not a
 * persistence acknowledgement. Both the 120ms debounce and an immediate
 * Tab/blur must still send the user's actual logical Unicode text exactly
 * once, even when the latest prop already equals the textarea.
 */
it.each([
  { script: "Persian", before: "فارسی پ چ ژ گ ۲۰۲۶", final: "فارسی پ چ ژ گ ۲۰۶۲" },
  { script: "Arabic", before: "السَّلَامُ 25%", final: "السَّلَامُ 52%" },
])("does not lose an authored $script edit when its props echo before native persistence", async ({ before, final }) => {
  for (const flush of ["blur", "debounce"] as const) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCommit = vi.fn();
    const setNative = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    const render = (value: string) => <TextAreaField flat label="Content" value={value} onCommit={onCommit} />;
    try {
      act(() => root.render(render(before)));
      const textarea = host.querySelector("textarea")!;
      act(() => {
        textarea.focus();
        setNative.call(textarea, final);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      // A preview refresh is not proof the versioned project file was saved.
      act(() => root.render(render(final)));
      expect(textarea.value).toBe(final);
      expect(onCommit).not.toHaveBeenCalled();
      if (flush === "blur") {
        act(() => textarea.blur());
      } else {
        await new Promise(resolve => setTimeout(resolve, 165));
      }
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(final);
      if (flush === "debounce") {
        act(() => textarea.blur());
      } else {
        await new Promise(resolve => setTimeout(resolve, 165));
      }
      expect(onCommit, "blur/debounce duplicated the authoring commit").toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  }
});

it("does not author a phantom commit when an edited RTL field is restored to its focus-time value", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  const original = "فارسی پ چ ژ گ ۲۰۲۶";
  const setNative = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  try {
    act(() => root.render(<TextAreaField flat label="Content" value={original} onCommit={onCommit} />));
    const textarea = host.querySelector("textarea")!;
    act(() => {
      textarea.focus();
      setNative.call(textarea, "فارسی پ چ ژ گ ۲۰۶۲");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      setNative.call(textarea, original);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 165));
    expect(onCommit).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

/**
 * Native source writes are async. A 120ms debounce can dispatch before the
 * parent has acknowledged its revision. Blurring the same field must not send
 * a second identical write against that stale revision, but a later return
 * to the original text must undo the already-submitted intermediate edit.
 */
it.each([
  { script: "Persian", before: "فارسی پ چ ژ گ ۲۰۲۶", after: "فارسی پ چ ژ گ ۲۰۶۲" },
  { script: "Arabic", before: "السَّلَامُ 25%", after: "السَّلَامُ 52%" },
])("deduplicates $script debounce/blur while preserving an authored reversal", async ({ before, after }) => {
  const setNative = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  for (const reverse of [false, true]) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCommit = vi.fn();
    try {
      // The parent intentionally continues to report the previous source
      // revision while an asynchronous save is still unresolved.
      act(() => root.render(<TextAreaField flat label="Content" value={before} onCommit={onCommit} />));
      const textarea = host.querySelector("textarea")!;
      const input = (next: string) => act(() => {
        setNative.call(textarea, next);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => textarea.focus());
      input(after);
      await new Promise(resolve => setTimeout(resolve, 175));
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenNthCalledWith(1, after);
      if (reverse) input(before);
      act(() => textarea.blur());
      expect(onCommit).toHaveBeenCalledTimes(reverse ? 2 : 1);
      if (reverse) expect(onCommit).toHaveBeenNthCalledWith(2, before);
      await new Promise(resolve => setTimeout(resolve, 165));
      expect(onCommit, "a late debounce duplicated the native save").toHaveBeenCalledTimes(reverse ? 2 : 1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  }
});

/**
 * Switching the selected clip can update inspector props while the old
 * textarea remains focused. Its unchanged draft is not a newly authored
 * source edit. Blurring must NOT write the old clip's text over the newly
 * selected clip; after blur the field must display the new source text.
 * This is distinct from a preview echo following a real input (covered above).
 */
it.each([
  { from: "فارسی پ چ ژ گ ۲۰۲۶", to: "السَّلَامُ 25%", script: "Persian to Arabic" },
  { from: "شָׁלוֹם OpenMotion", to: "English LTR ABC-123", script: "Hebrew to English" },
])("does not persist untouched $script inspector content into a different clip on blur", async ({ from, to }) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  const render = (value: string) => <TextAreaField flat label="Content" value={value} onCommit={onCommit} />;
  try {
    act(() => root.render(render(from)));
    const textarea = host.querySelector("textarea")!;
    act(() => textarea.focus());
    expect(textarea.value).toBe(from);
    // Studio selection changes without a single trusted input into this field.
    act(() => root.render(render(to)));
    expect(textarea.value).toBe(from);
    act(() => textarea.blur());
    expect(onCommit, "an old clip was written into a new source").not.toHaveBeenCalled();
    expect(textarea.value, "the unedited draft was not replaced on blur").toBe(to);
    await new Promise(resolve => setTimeout(resolve, 165));
    expect(onCommit).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

/** A visible native edit remains authoritative even without an onChange event. */
it("commits native Unicode input while props changed during focus when the textarea actually differs from its baseline", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  const original = "فارسی ۲۰۲۶";
  const switched = "English clip 12";
  const typed = "فارسی ۲۰۶۲";
  const setNative = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  try {
    act(() => root.render(<TextAreaField flat label="Content" value={original} onCommit={onCommit} />));
    const textarea = host.querySelector("textarea")!;
    act(() => textarea.focus());
    act(() => root.render(<TextAreaField flat label="Content" value={switched} onCommit={onCommit} />));
    act(() => {
      setNative.call(textarea, typed);
      // The native input arrives before React's onChange observes it.
      textarea.blur();
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(typed);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
