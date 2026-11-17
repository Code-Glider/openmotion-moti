import { FieldValidationError, fieldFeedback } from "../forms.js";

export type NumberIssue = "number" | "minimum" | "exclusiveMinimum" | "maximum";
export function numberField(
  document: Document,
  options: {
    label: string;
    min?: number;
    max?: number;
    exclusiveMin?: boolean;
    message?(issue: NumberIssue): string;
    optional?: boolean;
    unit: string;
    change(value: number | undefined): void;
  },
) {
  const element = document.createElement("div"),
    input = document.createElement("input"),
    unit = document.createElement("span");
  const container = document.createElement("div"),
    feedback = fieldFeedback(input);
  container.className = "om-field__body";
  container.append(element, feedback.element);
  element.className = "om-number";
  input.className = "om-number__input";
  unit.className = "om-number__unit";
  unit.textContent = options.unit;
  input.setAttribute("aria-label", options.label);
  input.type = "number";
  input.step = "any";
  input.required = !options.optional;
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  let interacted = false,
    forceRequired = false;
  const issue = (required = false): NumberIssue | null => {
    if (input.validity.badInput) return "number";
    if (!input.value) return options.optional && !required ? null : "number";
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return "number";
    if (options.min !== undefined && (options.exclusiveMin ? value <= options.min : value < options.min))
      return options.exclusiveMin ? "exclusiveMinimum" : "minimum";
    if (options.max !== undefined && value > options.max) return "maximum";
    return null;
  };
  const check = (required = false, focus = true) => {
    interacted = true;
    forceRequired ||= required;
    const problem = issue(forceRequired);
    feedback.show(
      problem ? (options.message?.(problem) ?? `Enter a valid value for ${input.getAttribute("aria-label")}`) : "",
    );
    if (problem && focus) input.focus();
    return !problem;
  };
  const changed = () => {
    check(false, false);
    options.change(input.value ? input.valueAsNumber : options.optional ? undefined : Number.NaN);
  };
  input.addEventListener("input", changed);
  input.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key) || input.readOnly) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1,
      value = (Number(input.value) || 0) + direction * (event.shiftKey ? 1 : 0.1);
    input.value = String(
      Math.max(options.min ?? -Infinity, Math.min(options.max ?? Infinity, Math.round(value * 1000) / 1000)),
    );
    changed();
  });
  element.append(input, unit);
  return {
    element: container,
    input,
    error: feedback.element,
    check,
    value(value: number | undefined, reset = false) {
      const next = value === undefined ? "" : String(value);
      if ((reset || document.activeElement !== input) && input.value !== next) input.value = next;
      if (reset) {
        interacted = false;
        forceRequired = false;
        feedback.show("");
      } else if (interacted) check(false, false);
    },
    validate(required = false) {
      if (!check(required)) throw new FieldValidationError(feedback.element.textContent ?? "Invalid field");
    },
    readonly(value: boolean) {
      input.readOnly = value;
    },
  };
}
