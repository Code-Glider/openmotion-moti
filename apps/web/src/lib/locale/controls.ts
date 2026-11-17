import * as atoms from "@open-motion/components";
import { attr, display, text } from "./bindings.js";
import { type Copy, m, original } from "./messages.js";
export function numberField(
  document: Document,
  options: Omit<Parameters<typeof atoms.numberField>[1], "label" | "unit"> & { label: Copy; unit: Copy },
) {
  const view = atoms.numberField(document, {
    ...options,
    label: original(options.label),
    unit: original(options.unit),
    message: (issue) => {
      const message =
        issue === "minimum"
          ? m("请输入不小于 {0} 的数值。", [options.min ?? 0])
          : issue === "exclusiveMinimum"
            ? m("请输入大于 {0} 的数值。", [options.min ?? 0])
            : issue === "maximum"
              ? m("请输入不大于 {0} 的数值。", [options.max ?? 0])
              : m("请输入有效数值。");
      text(view.error, message);
      return display(view.input, message);
    },
    change: (value) => {
      view.check(true, false);
      options.change(value);
    },
  });
  attr(view.input, "aria-label", options.label);
  text(view.element.querySelector(".om-number__unit")!, options.unit);
  return { ...view, validate: () => view.validate(true), check: () => view.check(true) };
}
export function tooltip(document: Document, trigger: HTMLButtonElement, label: Copy) {
  const view = atoms.tooltip(document, trigger, original(label));
  const surface = view.element.querySelector('[role="tooltip"]')!;
  attr(surface, "aria-label", label);
  text(surface, label);
  return view;
}
export function previewViewport(document: Document) {
  const view = atoms.previewViewport(document);
  attr(view.element.querySelector("svg")!, "aria-label", m("原生画布"));
  return view;
}
type Tab = Omit<Parameters<ReturnType<typeof atoms.tabs>["update"]>[0][number], "label"> & { label: Copy };
export function tabs(document: Document, options: Omit<Parameters<typeof atoms.tabs>[1], "label"> & { label: Copy }) {
  const view = atoms.tabs(document, { ...options, label: original(options.label) });
  attr(view.element, "aria-label", options.label);
  return {
    ...view,
    update(items: Tab[], selected: string, disabled = false) {
      view.update(
        items.map((item) => ({ ...item, label: original(item.label) })),
        selected,
        disabled,
      );
      for (const item of items) {
        const control = [...view.element.querySelectorAll<HTMLElement>('[role="tab"]')].find(
          (n) => n.dataset.tab === item.id,
        );
        if (!control) continue;
        attr(control, "aria-label", item.label);
        text(control.querySelector(".om-button__label")!, item.label);
      }
    },
  };
}
export function tree(document: Document, options: Omit<Parameters<typeof atoms.tree>[1], "label"> & { label: Copy }) {
  const view = atoms.tree(document, { ...options, label: original(options.label) });
  attr(view.element, "aria-label", options.label);
  return view;
}
type Lane = Omit<NonNullable<atoms.TimeTrack["lanes"]>[number], "label"> & { label: Copy };
type Track = Omit<atoms.TimeTrack, "kind" | "lanes"> & { kind?: Copy; lanes?: Lane[] };
export function timeTracks(
  document: Document,
  options: Omit<Parameters<typeof atoms.timeTracks>[1], "tracks"> & { tracks: Track[] },
) {
  const view = atoms.timeTracks(document, {
    ...options,
    tracks: options.tracks.map((track) => ({
      ...track,
      lanes: track.lanes?.map((lane) => ({ ...lane, label: original(lane.label) })),
      kind: track.kind === undefined ? undefined : original(track.kind),
    })),
  });
  attr(view.element.querySelector("svg")!, "aria-label", m("原生时间轴轨道"));
  for (const [i, tick] of view.element.querySelectorAll(".om-time__tick").entries())
    text(tick, m("{0}s", [{ number: (i / 10) * Math.max(1, options.duration), digits: 1 }]));
  for (const track of options.tracks) {
    const group = [...view.element.querySelectorAll<SVGElement>("[data-clip-id]")].find(
      (n) => n.dataset.clipId === track.id,
    );
    if (!group) continue;
    attr(
      group,
      "aria-label",
      m("{0} {1}秒 / {2}秒", [track.label, { number: track.start, digits: 2 }, { number: track.duration, digits: 2 }]),
    );
    attr(group, "aria-description", track.readonly ? m("只读时间窗口") : m("可编辑时间窗口"));
    const edge = group.querySelector("[data-start-edge]");
    if (edge) attr(edge, "aria-label", m("调整 {0} 起点并保留终点", [track.label]));
    text(group.querySelector(".om-time__kind")!, track.kind ?? m("T · 文本"));
  }
  const lanes = [...view.element.querySelectorAll<SVGElement>(".om-time__label")].filter(
    (node) => !node.closest("[data-clip-id]"),
  );
  for (const [i, lane] of options.tracks.flatMap((track) => track.lanes ?? []).entries())
    if (lanes[i]) text(lanes[i]!, lane.label);
  return view;
}
