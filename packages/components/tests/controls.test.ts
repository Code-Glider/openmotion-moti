import { expect, it, vi } from "vitest";
import { numberField, tabs, tree } from "@";

it("retains an incomplete numeric draft across controlled updates and rejects it before commit", () => {
  const change = vi.fn(),
    control = numberField(document, { label: "Duration", unit: "s", min: 0, change });
  document.body.append(control.element);
  control.value(3);
  control.input.focus();
  control.input.value = "";
  control.input.dispatchEvent(new Event("input"));
  control.readonly(true);
  control.value(3);
  expect(control.input.value).toBe("");
  expect(() => control.validate()).toThrow("Enter a valid value");
  control.readonly(false);
  control.input.value = "2";
  control.input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true }));
  expect(change).toHaveBeenLastCalledWith(3);
  control.value(7, true);
  expect(control.input.value).toBe("7");
});

it("keeps a tab's focus while navigating enabled items and blocks keyboard selection during a commit", () => {
  const select = vi.fn(),
    view = tabs(document, { label: "Views", select });
  const items = [
    { id: "a", label: "A" },
    { id: "b", label: "B", disabled: true },
    { id: "c", label: "C" },
  ];
  view.update(items, "a");
  document.body.append(view.element);
  const first = view.element.querySelector<HTMLButtonElement>('[data-tab="a"]');
  first?.focus();
  first?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  expect(select).toHaveBeenLastCalledWith("c");
  const focused = document.activeElement;
  view.update(items, "c");
  expect(document.activeElement).toBe(focused);
  view.update(items, "c", true);
  focused?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
  expect(select).toHaveBeenCalledTimes(1);
});

it("navigates a collapsed hierarchy without selecting hidden descendants or losing tree focus", () => {
  const select = vi.fn(),
    expand = vi.fn(),
    view = tree(document, { label: "Layers", select, expand });
  const items = [
    { id: "root", label: "Root", parent: null, icon: "film" as const },
    { id: "child", label: "Child", parent: "root", icon: "text" as const },
  ];
  document.body.append(view.element);
  view.update(items, "", new Set(), false);
  view.element.focus();
  const key = (key: string) => view.element.dispatchEvent(new KeyboardEvent("keydown", { key }));
  key("End");
  key("Enter");
  expect(select).toHaveBeenLastCalledWith("root");
  key("ArrowRight");
  expect(expand).toHaveBeenLastCalledWith("root", true);
  view.update(items, "root", new Set(["root"]), false);
  key("ArrowDown");
  key("Enter");
  expect(select).toHaveBeenLastCalledWith("child");
  expect(document.activeElement).toBe(view.element);
  view.disable(true);
  key("Home");
  key("Enter");
  expect(select).toHaveBeenCalledTimes(2);
});

it("describes invalid bounds, focuses the field and clears only its own accessibility description on correction", () => {
  const control = numberField(document, {
    label: "Duration",
    unit: "s",
    min: 0,
    exclusiveMin: true,
    max: 5,
    message: (issue) => `Duration: ${issue}`,
    change() {},
  });
  document.body.append(control.element);
  control.input.setAttribute("aria-describedby", "existing-help");
  control.input.value = "0";
  control.input.dispatchEvent(new Event("input"));
  expect(control.input.getAttribute("aria-invalid")).toBe("true");
  expect(control.error.textContent).toBe("Duration: exclusiveMinimum");
  expect(control.input.getAttribute("aria-describedby")).toBe(`existing-help ${control.error.id}`);
  expect(() => control.validate()).toThrow("exclusiveMinimum");
  expect(document.activeElement).toBe(control.input);
  control.input.value = "6";
  control.input.dispatchEvent(new Event("input"));
  expect(control.error.textContent).toBe("Duration: maximum");
  control.input.value = "0.001";
  control.input.dispatchEvent(new Event("input"));
  expect(control.check()).toBe(true);
  expect(control.error.hidden).toBe(true);
  expect(control.input.getAttribute("aria-describedby")).toBe("existing-help");
  expect(control.input.hasAttribute("aria-errormessage")).toBe(false);
});

it("retains a required touched optional draft during controlled refresh and resets feedback on a new context", () => {
  const control = numberField(document, { label: "Inherited value", unit: "", optional: true, change() {} });
  document.body.append(control.element);
  expect(control.check()).toBe(true);
  expect(control.check(true)).toBe(false);
  control.input.focus();
  control.value(2);
  expect(control.input.value).toBe("");
  expect(control.error.hidden).toBe(false);
  control.value(undefined, true);
  expect(control.error.hidden).toBe(true);
  expect(control.input.getAttribute("aria-invalid")).toBe("false");
});
