import type { Copy } from "../../locale/index.js";
import {
  badge,
  button,
  text as copyText,
  emptyState,
  field,
  m,
  numberField,
  setButtonSelected,
  slot,
} from "../../locale/index.js";
/** One transport view per Studio; playback updates never replace an active seek input. */
export function playerControls(
  document: Document,
  options: {
    time: HTMLOutputElement;
    control(action: "play" | "pause" | "seek", time?: number): void;
  },
) {
  const seek = numberField(document, { label: m("定位秒"), min: 0, unit: "s", change: () => {} }),
    element = slot(document, "toolbar"),
    controls: HTMLButtonElement[] = [];
  let owner = "";
  for (const action of ["play", "pause"] as const) {
    const control = button(document, {
      label: action === "play" ? m("播放") : m("暂停"),
      icon: action,
      iconOnly: true,
      variant: "ghost",
      compact: true,
      onClick: () => options.control(action),
    });
    controls.push(control);
    element.append(control);
  }
  const locate = button(document, {
    label: m("定位"),
    variant: "ghost",
    compact: true,
    onClick: () => {
      seek.validate();
      options.control("seek", seek.input.valueAsNumber);
    },
  });
  controls.push(locate);
  element.append(field(document, m("定位秒"), seek.element, true, true), locate, options.time);
  return {
    element,
    update(identity: string, blocked: boolean, ready: boolean) {
      if (identity !== owner) {
        seek.value(0, true);
        owner = identity;
      }
      seek.readonly(blocked || !ready);
      for (const control of controls) control.disabled = blocked || !ready;
    },
  };
}
export function studioTools(
  document: Document,
  options: {
    title: Copy;
    file: string;
    mode: "source" | "preview";
    blocked: boolean;
    setMode(mode: "source" | "preview"): void;
    add(): void;
    open(): void;
    close(): void;
  },
) {
  const context = slot(document, "spread"),
    title = slot(document, "title"),
    file = slot(document, "title"),
    controls = slot(document, "spread"),
    tools = slot(document, "toolbar");
  copyText(title, options.title);
  copyText(file, options.file === "index.html" ? m("主合成 / index.html") : m("局部合成 / {0}", [options.file]));
  context.append(title, badge(document, m("编辑器类型"), "Motion"));
  for (const mode of ["preview", "source"] as const) {
    const control = button(document, {
      label: mode === "preview" ? m("预览") : m("源码"),
      icon: mode === "preview" ? "eye" : "code",
      variant: "tab",
      compact: true,
      selected: options.mode === mode,
      onClick: () => options.setMode(mode),
    });
    control.dataset.mode = mode;
    tools.append(control);
  }
  tools.append(
    button(document, {
      label: m("添加文本"),
      icon: "text",
      variant: "ghost",
      compact: true,
      disabled: options.blocked,
      onClick: options.add,
    }),
    button(document, {
      label: m("打开预览"),
      icon: "refresh",
      iconOnly: true,
      variant: "ghost",
      disabled: options.blocked,
      onClick: options.open,
    }),
    button(document, {
      label: m("关闭预览"),
      icon: "close",
      iconOnly: true,
      variant: "ghost",
      onClick: options.close,
    }),
  );
  controls.append(file, tools);
  return [context, controls];
}

/** Mode chrome is presentation state even while source changes invalidate the native model. */
export function syncMode(root: HTMLElement, mode: "preview" | "source") {
  for (const control of root.querySelectorAll<HTMLButtonElement>("[data-mode]"))
    setButtonSelected(control, control.dataset.mode === mode);
}

export function emptyStudio(document: Document, session: boolean, start: () => void) {
  const view = emptyState(document, {
    title: m("让想法成为画面"),
    detail: m("创建空白或模板项目，或让 Agent 创建项目后继续编辑。"),
    icon: "film",
  });
  view.actions.append(
    button(document, {
      label: session ? m("新建影片工程") : m("开始创作"),
      icon: "plus",
      primary: true,
      onClick: start,
    }),
  );
  return view.element;
}
