import type { Clip } from "@open-motion/motion/contract";
import { timeAtProgress } from "@open-motion/motion/protocol";
import { badge, button, m, note, timeTracks } from "../../locale/index.js";

const mounted = new WeakMap<
  HTMLElement,
  {
    identity: string;
    key: string;
    axis: ReturnType<typeof timeTracks>;
    actions: HTMLElement;
  }
>();
export function studioTimeline(
  document: Document,
  options: {
    identity: string;
    clips: Clip[];
    selected: string;
    blocked: boolean;
    time: number;
    duration: number | null;
    root: HTMLElement;
    actions: HTMLElement;
    canUndo: boolean;
    canRedo: boolean;
    undo(): void;
    redo(): void;
    choose(id: string): void;
    seek(time: number): void;
    retime(id: string, time: number): void;
    commit(id: string, start: number, duration: number): void;
  },
) {
  // The exact editable binding fences callback reuse; playback time alone never replaces a gesture's nodes.
  const key = JSON.stringify([
      options.clips,
      options.selected,
      options.blocked,
      options.duration,
      options.canUndo,
      options.canRedo,
    ]),
    current = mounted.get(options.root);
  if (
    current?.identity === options.identity &&
    current.key === key &&
    current.axis.disabled === options.blocked &&
    current.actions === options.actions &&
    options.root.contains(current.axis.element)
  ) {
    current.axis.resize(options.root.clientWidth);
    current.axis.time(options.time);
    return current.axis;
  }
  const startFocus = document.activeElement?.hasAttribute("data-start-edge");
  const focus = document.activeElement?.closest("[data-keyframe-focus],[data-clip-id]");
  const focusKey = focus?.getAttribute("data-keyframe-focus"),
    focusClip = focus?.getAttribute("data-clip-id");
  const tracks = options.clips.filter(
    (c) =>
      (!c.composition || !!c.host) && c.start !== null && c.duration !== null && Number.isFinite(c.start + c.duration),
  );
  const length =
    options.duration ??
    Math.max(1, ...options.clips.map((c) => (c.composition ? (c.duration ?? 0) : (c.start ?? 0) + (c.duration ?? 0))));
  const axis = timeTracks(document, {
    duration: length,
    disabled: options.blocked,
    tracks: tracks.map((c) => ({
      id: c.id,
      label: c.host ? `${c.id} · ${c.host.source}` : c.text || c.tag,
      kind: c.link
        ? m("链接媒体")
        : c.host
          ? m("合成")
          : c.media?.kind === "audio"
            ? m("音频")
            : c.media
              ? m("图像")
              : m("T · 文本"),
      readonly: !!c.link?.reason || !!c.host?.reason || (c.media?.kind === "audio" && c.media.maximum === null),
      minimumStart: c.media?.kind === "image" && !c.media.linkReason && !c.link && !c.animations.length ? 0 : undefined,
      maximum: c.link?.maximum ?? c.host?.maximum ?? c.media?.maximum ?? undefined,
      start: c.start ?? 0,
      duration: c.duration ?? 1,
      selected: c.id === options.selected,
      lanes: c.animations
        .filter((a) => !a.reason)
        .map((a) => ({
          id: a.id,
          label: a.property ?? m("动画"),
          keys: a.frames.map((f, i) => ({
            id: JSON.stringify({ animationId: a.id, percentage: f.percentage, elementId: c.id }),
            focus: JSON.stringify([c.id, a.property, i]),
            time: (a.start ?? 0) + ((a.duration ?? 0) * timeAtProgress(a.ease, f.percentage)) / 100,
            range: {
              start:
                i === 0
                  ? (c.start ?? 0)
                  : (a.start ?? 0) +
                    ((a.duration ?? 0) * timeAtProgress(a.ease, a.frames[i - 1]?.percentage ?? 0)) / 100 +
                    0.001,
              end:
                i === a.frames.length - 1
                  ? (c.start ?? 0) + (c.duration ?? 0)
                  : (a.start ?? 0) +
                    ((a.duration ?? 0) * timeAtProgress(a.ease, a.frames[i + 1]?.percentage ?? 100)) / 100 -
                    0.001,
            },
            label: `${a.property} ${f.percentage}%`,
          })),
        })),
    })),
    select: options.choose,
    seek: options.seek,
    retime: options.retime,
    commit: options.commit,
  });
  axis.resize(options.root.clientWidth);
  axis.time(options.time);
  options.actions.replaceChildren(
    badge(document, m("时间轴长度"), m("{0}s", [{ number: length, digits: 2 }])),
    button(document, {
      label: m("时间轴撤销"),
      icon: "undo",
      iconOnly: true,
      variant: "ghost",
      disabled: options.blocked || !options.canUndo,
      onClick: options.undo,
    }),
    button(document, {
      label: m("时间轴重做"),
      icon: "redo",
      iconOnly: true,
      variant: "ghost",
      disabled: options.blocked || !options.canRedo,
      onClick: options.redo,
    }),
  );
  options.root.replaceChildren(
    tracks.length ? axis.element : note(document, m("添加文本，或为图层声明开始秒与持续秒。")),
    note(
      document,
      m(
        "拖动移动片段，右侧手柄调整长度；静态独立 PNG 的左侧手柄调整起点并保留终点，聚焦手柄后可用方向键微调。方向键微调，Shift 为 1 秒，Alt 调整长度。菱形点击定位、拖动或方向键调整关键帧，Escape 取消拖动。",
      ),
    ),
  );
  const selector = focusKey ? "[data-keyframe-focus]" : "[data-clip-id]",
    value = focusKey ?? focusClip;
  if (value) {
    const target = [...options.root.querySelectorAll<SVGElement>(selector)].find(
      (e) => e.getAttribute(focusKey ? "data-keyframe-focus" : "data-clip-id") === value,
    );
    (startFocus ? (target?.querySelector<SVGElement>("[data-start-edge]") ?? target) : target)?.focus();
  }
  mounted.set(options.root, { identity: options.identity, key, axis, actions: options.actions });
  return axis;
}
