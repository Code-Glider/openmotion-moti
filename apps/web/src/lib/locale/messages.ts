import type { Locale } from "@open-motion/workspace/contract";
import { catalog } from "./catalog/index.js";
export type Copy = string | Message;
export type Value = Copy | number | { readonly date: number } | { readonly number: number; readonly digits: number };
export interface Message {
  readonly key: keyof typeof catalog;
  readonly values: readonly Value[];
}
export function m(key: keyof typeof catalog, values: readonly Value[] = []): Message {
  return { key, values };
}
const columns: Exclude<Locale, "zh-CN">[] = ["en", "ja", "ko", "de", "fr", "ru", "es", "pt-BR", "it", "tr"];
export function format(value: Value, locale: Locale): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
  if ("number" in value)
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: value.digits,
      maximumFractionDigits: value.digits,
    }).format(value.number);
  if ("date" in value)
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value.date);
  const pattern = locale === "zh-CN" ? value.key : catalog[value.key]?.[columns.indexOf(locale)];
  if (pattern === undefined) throw new Error(`Missing interface translation: ${value.key}/${locale}`);
  return pattern.replace(/\{(\d+)\}/g, (_, i: string) => format(value.values[Number(i)] ?? "", locale));
}
export const original = (value: Copy): string => format(value, "zh-CN");
