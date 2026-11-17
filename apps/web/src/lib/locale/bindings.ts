import type { Locale } from "@open-motion/workspace/contract";
import { type Copy, format, type Message, original } from "./messages.js";

const bindings = new WeakMap<Node, Map<string, Message>>();
const scopes = new WeakMap<Node, Locale>();
export function localeOf(node: Node): Locale {
  for (let at: Node | null = node; at; at = at.parentNode) {
    const locale = scopes.get(at);
    if (locale) return locale;
  }
  return "zh-CN";
}
type Attribute = "aria-label" | "aria-description" | "title" | "alt" | "placeholder";
function write(node: Node, property: string, value: string) {
  if (property === "text") {
    if (node.textContent !== value) node.textContent = value;
  } else if (node.nodeType === 1) {
    const element = node as Element;
    if (element.getAttribute(property) === value) return;
    switch (property) {
      case "aria-label":
        element.setAttribute("aria-label", value);
        break;
      case "aria-description":
        element.setAttribute("aria-description", value);
        break;
      case "title":
        element.setAttribute("title", value);
        break;
      case "alt":
        element.setAttribute("alt", value);
        break;
      case "placeholder":
        element.setAttribute("placeholder", value);
        break;
    }
  }
}
export function bind(node: Node, property: string, value: Copy | number) {
  let map = bindings.get(node);
  if (typeof value === "object") {
    if (!map) {
      map = new Map();
      bindings.set(node, map);
    }
    map.set(property, value);
    write(node, property, format(value, localeOf(node)));
  } else {
    map?.delete(property);
    write(node, property, String(value));
  }
}
export const unbind = (node: Node, property: string) => bindings.get(node)?.delete(property);
export const text = (node: Node, value: Copy | number) => bind(node, "text", value);
export const attr = (node: Element, name: Attribute, value: Copy) => bind(node, name, value);
/** Stable source identity for control logic; accessible names remain localized. */
export const sourceLabel = (node: Element) =>
  bindings.get(node)?.get("aria-label")?.key ?? node.getAttribute("aria-label") ?? "";
export function languageScope(root: HTMLElement) {
  let disposed = false;
  const refresh = (node: Node) => {
    for (const [property, message] of bindings.get(node) ?? []) write(node, property, format(message, localeOf(node)));
    for (const child of node.childNodes) refresh(child);
  };
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer
    ? new Observer((records) => {
        if (disposed) return;
        for (const record of records) for (const node of record.addedNodes) if (root.contains(node)) refresh(node);
      })
    : undefined;
  scopes.set(root, "zh-CN");
  observer?.observe(root, { subtree: true, childList: true });
  return {
    set(value: Locale) {
      if (disposed) return;
      scopes.set(root, value);
      root.lang = value;
      if (root.id === "app" || root === root.ownerDocument.body) root.ownerDocument.documentElement.lang = value;
      refresh(root);
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      scopes.delete(root);
    },
  };
}

export const display = (node: Node, value: Copy) => format(value, localeOf(node));
export const sourceText = (node: Node) => {
  const message = bindings.get(node)?.get("text");
  return message ? original(message) : (node.textContent ?? "");
};
export const sameOptions = (options: Iterable<HTMLOptionElement>, entries: Iterable<readonly [string, Copy]>) =>
  JSON.stringify(Array.from(options, (node) => [node.value, sourceText(node)])) ===
  JSON.stringify(Array.from(entries, ([id, label]) => [id, original(label)]));
