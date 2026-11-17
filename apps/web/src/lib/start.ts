import { setTheme } from "@open-motion/theme";
import { mount, type WebView } from "../view.js";
import { type Bootstrap, bootstrap } from "./bootstrap.js";
import { attr, button, text as copyText, emptyState, layout, m, note } from "./locale/index.js";

/** Owns only pre-mount presentation. Retry never changes project identity or starts an OS instance. */
export function start(
  root: HTMLElement,
  options: {
    url: URL;
    entry: string;
    injected?: Bootstrap;
    transport?: typeof fetch;
    mounted?(view: WebView): void;
  },
) {
  const document = root.ownerDocument,
    controller = new AbortController();
  let view: WebView | undefined,
    flight: Promise<void> | undefined,
    disposed = false;
  const attempt = () => {
    if (disposed || flight || view) return flight ?? Promise.resolve();
    const page = layout(document, "page"),
      state = emptyState(document, {
        title: m("打开 OpenMotion"),
        detail: m("连接本地运行实例后进入原项目，重试不会创建项目或改变项目内容。"),
        icon: "film",
      }),
      status = note(document, m("连接中")),
      retry = button(document, { label: m("重试连接"), primary: true, onClick: () => void attempt() });
    attr(page, "aria-label", m("启动状态"));
    status.setAttribute("role", "status");
    retry.hidden = true;
    state.actions.append(status, retry);
    page.append(state.element);
    setTheme(root, "light");
    root.replaceChildren(page);
    root.setAttribute("aria-busy", "true");
    flight = (async () => {
      try {
        const config = await bootstrap(options.injected, options.url, options.transport, controller.signal);
        if (disposed) return;
        view = mount(root, { ...config, entry: options.entry });
        options.mounted?.(view);
      } catch {
        if (disposed) return;
        root.replaceChildren(page);
        status.setAttribute("role", "alert");
        copyText(
          status,
          m(
            "无法连接本地运行实例。请确认实例已启动后重试；若实例已重启，请通过 odsuite status 获取当前入口。原项目链接保持不变。",
          ),
        );
        retry.hidden = false;
      } finally {
        if (!disposed) root.removeAttribute("aria-busy");
      }
    })().finally(() => {
      flight = undefined;
    });
    return flight;
  };
  const ready = attempt();
  return {
    ready,
    get view() {
      return view;
    },
    async dispose() {
      disposed = true;
      controller.abort();
      await flight;
      await view?.dispose();
      root.removeAttribute("aria-busy");
      root.replaceChildren();
    },
  };
}
