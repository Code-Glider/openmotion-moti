import type { ButtonOptions } from "@open-motion/components";
import * as atoms from "@open-motion/components";
import { attr, text, unbind } from "./bindings.js";
import { type Copy, m, original } from "./messages.js";

export * from "@open-motion/components";
export { attr, sourceLabel, text } from "./bindings.js";
export { type Copy, m } from "./messages.js";

type Options = Omit<ButtonOptions, "label" | "detail"> & { label: Copy; detail?: Copy };
export function setButton(element: HTMLButtonElement, options: Options) {
  atoms.setButton(element, {
    ...options,
    label: original(options.label),
    detail: options.detail === undefined ? undefined : original(options.detail),
  });
  attr(element, "aria-label", options.label);
  attr(element, "title", options.iconOnly ? options.label : "");
  const label = element.querySelector<HTMLElement>(".om-button__label");
  if (label) {
    const detail = label.querySelector(".om-button__detail");
    text(label.firstChild ?? label, options.label);
    if (detail && options.detail !== undefined) text(detail, options.detail);
  }
  if (options.detail !== undefined) attr(element, "aria-description", options.detail);
  else unbind(element, "aria-description");
}
export function button(document: Document, options: Options) {
  const element = atoms.button(document, {
    ...options,
    label: original(options.label),
    detail: options.detail === undefined ? undefined : original(options.detail),
  });
  setButton(element, options);
  return element;
}
export function field(document: Document, label: Copy, control: HTMLElement, inline = false, hidden = false) {
  const element = atoms.field(document, original(label), control, inline, hidden);
  text(element.querySelector("span")!, label);
  return element;
}
export function note(document: Document, value: Copy) {
  const element = atoms.note(document, original(value));
  text(element, value);
  return element;
}
export function heading(document: Document, value: Copy, compact = false) {
  const element = atoms.heading(document, original(value), compact);
  text(element, value);
  return element;
}
export function readout(document: Document, label: Copy, value: Copy) {
  const element = atoms.readout(document, original(label), original(value));
  attr(element, "aria-label", label);
  text(element, value);
  return element;
}
export function badge(document: Document, label: Copy, value: Copy, active = false) {
  const element = atoms.badge(document, original(label), original(value), active);
  attr(element, "aria-label", label);
  text(element, value);
  return element;
}
export function pane(document: Document, label: Copy, icon: atoms.Icon) {
  const view = atoms.pane(document, original(label), icon);
  text(view.header.querySelector(".om-pane__title")!, label);
  return view;
}
export function panel(document: Document, title: Copy) {
  const element = atoms.panel(document, original(title));
  attr(element, "aria-label", title);
  text(element.firstElementChild!, title);
  return element;
}
export function list(document: Document, label: Copy) {
  const element = atoms.list(document, original(label));
  attr(element, "aria-label", label);
  return element;
}
export function previewFrame(document: Document, title: Copy) {
  const element = atoms.previewFrame(document, original(title));
  attr(element, "title", title);
  return element;
}
export function imagePreview(document: Document, alt: Copy) {
  const element = atoms.imagePreview(document, original(alt));
  attr(element, "alt", alt);
  return element;
}
export function disclosure(document: Document, label: Copy, opened = false) {
  const view = atoms.disclosure(document, original(label), opened);
  text(view.element.querySelector("summary")!.firstChild!, label);
  return view;
}
export function emptyState(document: Document, options: { title: Copy; detail: Copy; icon: atoms.Icon }) {
  const view = atoms.emptyState(document, {
    ...options,
    title: original(options.title),
    detail: original(options.detail),
  });
  text(view.element.querySelector(".om-empty__title")!, options.title);
  text(view.element.querySelector(".om-empty__detail")!, options.detail);
  return view;
}
export function dialog(document: Document, label: Copy, drawer = false) {
  const view = atoms.dialog(document, original(label), drawer);
  text(view.element.querySelector("h2")!, label);
  const close = view.element.querySelector<HTMLButtonElement>("button")!;
  const caption = m("关闭{0}", [label]);
  attr(close, "aria-label", caption);
  attr(close, "title", caption);
  text(close.querySelector("span")!, caption);
  return view;
}

export function option(document: Document, label: Copy, value: string) {
  const element = document.createElement("option");
  element.value = value;
  text(element, label);
  return element;
}
