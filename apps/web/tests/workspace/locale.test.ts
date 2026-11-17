import { locales } from "@open-motion/workspace/contract";
import { expect, it } from "vitest";
import { catalog } from "@/lib/locale/catalog/index.js";
import {
  attr,
  button,
  languageScope,
  m,
  numberField,
  option,
  setButton,
  sourceLabel,
  tabs,
  text,
  timeTracks,
} from "@/lib/locale/index.js";
import { format } from "@/lib/locale/messages.js";

it("provides every language with the same placeholders and formats numbers, dates and nested messages without translating authored values", () => {
  for (const key of Object.keys(catalog) as (keyof typeof catalog)[]) {
    const expected = [...key.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
    expect(catalog[key]).toHaveLength(locales.length - 1);
    for (const translation of catalog[key]) {
      expect(translation.trim()).not.toBe("");
      expect([...translation.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort()).toEqual(expected);
    }
    for (const locale of locales) expect(format(m(key), locale)).not.toContain("[object Object]");
  }
  expect(format(m("关闭{0}", [m("界面设置")]), "en")).toBe("Close Interface settings");
  expect(format(m("关闭{0}", ["保存"]), "en")).toBe("Close 保存");
  expect(format({ number: 12.5, digits: 2 }, "de")).toBe("12,50");
  expect(format({ date: 1700000000000 }, "ja")).not.toBe(format({ date: 1700000000000 }, "en"));
});

it("updates only bound chrome in each view, preserving authored collisions, source, selection, focus and frame identity", async () => {
  const root = document.createElement("section"),
    other = document.createElement("section");
  document.body.append(root, other);
  const language = languageScope(root),
    independent = languageScope(other);
  const save = button(document, { label: m("保存"), detail: m("未保存") });
  const authored = button(document, { label: "保存", detail: "保存" });
  const source = document.createElement("textarea"),
    frame = document.createElement("iframe");
  source.value = "<p>保存</p>";
  const sibling = button(document, { label: m("保存") });
  root.append(save, authored, source, frame);
  other.append(sibling);
  source.focus();
  source.setSelectionRange(3, 5);
  language.set("en");
  expect(save.getAttribute("aria-label")).toBe("Save");
  expect(save.getAttribute("aria-description")).toBe("Unsaved");
  expect(sourceLabel(save)).toBe("保存");
  expect(authored.textContent).toBe("保存保存");
  expect(sibling.getAttribute("aria-label")).toBe("保存");
  expect(document.activeElement).toBe(source);
  expect([source.selectionStart, source.selectionEnd]).toEqual([3, 5]);
  expect(source.value).toBe("<p>保存</p>");
  expect(root.querySelector("iframe")).toBe(frame);
  const late = button(document, { label: m("重试") });
  root.append(late);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(late.getAttribute("aria-label")).toBe("Retry");
  setButton(save, { label: "保存" });
  text(authored.querySelector(".om-button__label")!, "自定义");
  attr(authored, "title", "保存");
  independent.set("ja");
  language.set("de");
  expect(save.getAttribute("aria-label")).toBe("保存");
  expect(save.hasAttribute("aria-description")).toBe(false);
  expect(authored.title).toBe("保存");
  expect(authored.textContent).toBe("自定义");
  expect(sibling.getAttribute("aria-label")).toBe("保存");
  language.dispose();
  independent.dispose();
  root.remove();
  other.remove();
});

it("localizes number fields, tabs, native track kinds and lane labels while keeping IDs and callbacks stable", () => {
  const root = document.createElement("section"),
    language = languageScope(root);
  const number = numberField(document, { label: m("开始秒"), unit: "s", change: () => {} });
  const navigation = tabs(document, { label: m("资源视图"), select: () => {} });
  navigation.update([{ id: "files", label: m("文件") }], "files");
  const track = timeTracks(document, {
    duration: 10,
    disabled: false,
    select: () => {},
    seek: () => {},
    commit: () => {},
    tracks: [
      {
        id: "owned",
        label: "保存",
        start: 0,
        duration: 2,
        minimumStart: 0,
        selected: true,
        kind: m("音频"),
        lanes: [{ id: "lane", label: m("动画"), keys: [] }],
      },
    ],
  });
  const languageOption = option(document, m("深色"), "dark");
  root.append(number.element, navigation.element, track.element, languageOption);
  document.body.append(root);
  language.set("en");
  expect(number.input.getAttribute("aria-label")).toBe("Start seconds");
  expect(navigation.element.querySelector("button")?.getAttribute("aria-label")).toBe("Files");
  expect(track.element.querySelector("[data-clip-id]")?.getAttribute("aria-label")).toBe("保存 0.00s / 2.00s");
  expect(track.element.querySelector(".om-time__kind")?.textContent).toBe("Audio");
  expect(track.element.querySelector("[data-lane-id]")?.textContent).toBe("Animation");
  expect(languageOption.value).toBe("dark");
  expect(languageOption.textContent).toBe("Dark");
  language.dispose();
  root.remove();
});
