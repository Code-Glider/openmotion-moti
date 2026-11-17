import { attr, m, pane, panelGrid, railLayout, slot } from "../locale/index.js";
export function workspaceLayout(document: Document) {
  const shell = railLayout(document, { compact: true }),
    header = slot(document, "header"),
    editor = slot(document, "fill");
  shell.body.setAttribute("role", "region");
  attr(shell.body, "aria-label", m("编辑工作区"));
  header.setAttribute("role", "toolbar");
  attr(header, "aria-label", m("项目工具栏"));
  editor.setAttribute("role", "region");
  attr(editor, "aria-label", m("项目编辑器"));
  shell.body.append(header, editor);
  return { element: shell.element, editor, header, rail: shell.rail, body: shell.body };
}
/** Product registration and placement. Atoms own only anonymous grid cells and panel surfaces. */
export function studioLayout(document: Document) {
  const grid = panelGrid(document),
    registry = {
      library: { label: m("资源"), symbol: "folder", cell: grid.leading, region: m("图层与文件") },
      canvas: { label: m("预览"), symbol: "eye", cell: grid.body, region: m("画布与源码") },
      inspector: { label: m("属性"), symbol: "layers", cell: grid.trailing, region: m("属性") },
      timeline: { label: m("时间轴"), symbol: "clock", cell: grid.footer, region: m("时间轴") },
    } as const;
  const mount = (name: keyof typeof registry) => {
    const definition = registry[name],
      view = pane(document, definition.label, definition.symbol);
    definition.cell.setAttribute("role", "region");
    attr(definition.cell, "aria-label", definition.region);
    definition.cell.append(view.element);
    return view;
  };
  return {
    focusBody: grid.focusBody,
    element: grid.element,
    library: mount("library"),
    canvas: mount("canvas"),
    inspector: mount("inspector"),
    timeline: mount("timeline"),
  };
}
