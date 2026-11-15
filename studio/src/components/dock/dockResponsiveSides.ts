import type { DockviewApi } from "dockview-react";
import { COLLAPSED_SIDE_WIDTH, DOCK_GAPS, SIDE_FOCUS_DOCK_WIDTH, defaultSideWidths, isSideCollapsed, previewMinimumWidth, sideMinimumWidth } from "./dockLayout";
import { PANEL_DEFINITIONS, type PanelId } from "./panelRegistry";
import type { createSidePanelMotion } from "./dockSidePanelMotion";

export const previewIsEnabled = (api: DockviewApi) => !api.getPanel("preview")?.group.element.classList.contains("hf-dock-preview-hidden");

/** Visibility is independent. When two readable columns no longer fit, stack them. */
export function createResponsiveDockSides(api: DockviewApi, dockWidth: () => number, motion: ReturnType<typeof createSidePanelMotion>, sync: () => void) {
  const widths = new Map<"left" | "right", number>();
  let stacked = false;
  let reflowing = false;
  const reflow = () => {
    if (reflowing) return;
    const left = api.getPanel("compositions")?.group;
    const right = api.getPanel("design")?.group;
    const preview = api.getPanel("preview")?.group;
    if (!left || !right || !preview) return;
    reflowing = true;
    try {
      const width = dockWidth();
      const narrow = width < SIDE_FOCUS_DOCK_WIDTH;
      const both = !isSideCollapsed(left) && !isSideCollapsed(right);
      const enabled = previewIsEnabled(api);
      const onlyTimeline = !enabled && isSideCollapsed(left) && isSideCollapsed(right);
      left.api.setVisible(!onlyTimeline);
      right.api.setVisible(!onlyTimeline);
      if (onlyTimeline) api.getPanel("timeline")?.group.api.setVisible(true);
      const stack = narrow && both;
      for (const group of [left, right]) group.api.setConstraints({ minimumWidth: 0, maximumWidth: Infinity, minimumHeight: 96 });
      preview.api.setConstraints({ minimumWidth: previewMinimumWidth(width, true) });
      if (stack !== stacked) {
        preview.api.setVisible(true);
        right.api.moveTo({ group: stack ? left : preview, position: stack ? "bottom" : "right", skipSetActive: true });
        stacked = stack;
      }
      preview.api.setVisible(enabled && (!narrow || (isSideCollapsed(left) && isSideCollapsed(right))));
      if (onlyTimeline) return;
      if (stack) {
        const height = Math.max(192, api.height - (api.getPanel("timeline")?.group.api.isVisible ? api.getPanel("timeline")!.group.height : 0));
        left.api.setSize({ height: Math.floor(height / 2) });
        return;
      }
      const groups = [{ group: left, zone: "left" as const }, { group: right, zone: "right" as const }];
      const preferred = defaultSideWidths(width);
      const available = width - DOCK_GAPS - (narrow || !enabled ? 0 : previewMinimumWidth(width, true));
      const minimum = sideMinimumWidth(width, true);
      const targets = groups.map(({ group, zone }) => isSideCollapsed(group) ? COLLAPSED_SIDE_WIDTH : Math.max(minimum, widths.get(zone) ?? preferred[zone]));
      const excess = Math.max(0, targets[0]! + targets[1]! - available);
      const flexible = groups.filter(({ group }) => !isSideCollapsed(group)).length;
      const expandedTotal = targets.reduce((sum, target, index) => sum + (isSideCollapsed(groups[index]!.group) ? 0 : target), 0);
      const fitted = groups.map(({ group }, index) => {
        const collapsed = isSideCollapsed(group);
        if (collapsed) return COLLAPSED_SIDE_WIDTH;
        if (narrow) return available - COLLAPSED_SIDE_WIDTH;
        if (!enabled) return (available - (2 - flexible) * COLLAPSED_SIDE_WIDTH) * targets[index]! / expandedTotal;
        return Math.max(minimum, targets[index]! - excess / flexible);
      });
      groups.forEach(({ group }, index) => group.api.setConstraints({ minimumWidth: fitted[index], maximumWidth: fitted[index] }));
      groups.forEach(({ group }, index) => group.api.setSize({ width: fitted[index] }));
      groups.forEach(({ group }) => {
        const collapsed = isSideCollapsed(group);
        group.api.setConstraints({ minimumWidth: collapsed ? COLLAPSED_SIDE_WIDTH : minimum, maximumWidth: collapsed ? COLLAPSED_SIDE_WIDTH : Infinity });
      });
    } finally {
      reflowing = false;
      sync();
    }
  };
  const setCollapsed = (id: PanelId, collapsed: boolean, animate: boolean) => {
    const group = api.getPanel(id)?.group;
    const zone = PANEL_DEFINITIONS[id].zone;
    if (!group || zone === "center" || isSideCollapsed(group) === collapsed) return;
    const narrow = dockWidth() < SIDE_FOCUS_DOCK_WIDTH;
    const from = group.width;
    if (!narrow && previewIsEnabled(api) && api.getPanel("preview")?.group.api.isVisible) for (const [panelId, side] of [["compositions", "left"], ["design", "right"]] as const) {
      const other = api.getPanel(panelId)?.group;
      if (other && !isSideCollapsed(other) && !motion.has(other.element)) widths.set(side, other.width);
    }
    motion.finishAll();
    group.element.classList.toggle("hf-dock-side-collapsed", collapsed);
    reflow();
    const target = group.width;
    if (animate && !narrow && Math.abs(from - target) > 1) {
      const resize = (width: number, finished: boolean) => {
        const opposite = api.getPanel(zone === "left" ? "design" : "compositions")?.group;
        if (opposite) opposite.api.setConstraints({ minimumWidth: opposite.width, maximumWidth: opposite.width });
        group.api.setConstraints({ minimumWidth: COLLAPSED_SIDE_WIDTH, maximumWidth: Infinity });
        group.api.setSize({ width });
        if (finished) reflow();
      };
      resize(from, false);
      motion.run(group.element, from, target, true, resize);
    }
    sync();
  };
  const setPreviewVisible = (visible: boolean) => {
    if (!visible) api.exitMaximizedGroup();
    api.getPanel("preview")?.group.element.classList.toggle("hf-dock-preview-hidden", !visible);
    reflow();
  };
  return { setCollapsed, reflow, setPreviewVisible, resetWidths: () => { widths.clear(); reflow(); } };
}
