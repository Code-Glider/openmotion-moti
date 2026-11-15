import { useI18n } from "../i18n/I18n";
import { IconButton, Menu, MenuCheckboxItem, MenuItem, MenuSeparator } from "../components/ui";
import { useDockLayoutStore } from "../components/dock/dockLayoutStore";
import { PANEL_DEFINITIONS } from "../components/dock/panelRegistry";
import { RemixIcon } from "../icons/RemixIcons";
import { TAB_ICONS } from "../components/dock/DockTab";

export function EditorLayoutMenu() {
  const { t } = useI18n();
  const controller = useDockLayoutStore(state => state.controller);
  const visible = useDockLayoutStore(state => state.visiblePanels);
  const collapsed = useDockLayoutStore(state => state.collapsedZones);
  return <Menu modal={false} aria-label={t("Panels and layout")} align="end" className="motion-context-menu motion-editor-layout-menu"
    trigger={<IconButton aria-label={t("Panels and layout")} title={t("Panels and layout")} disabled={!controller} icon={<RemixIcon name="layout-2-line" size={16} />} />}>
    <div className="motion-menu-label">{t("Show panels")}</div>
    {(["compositions", "assets", "catalog", "preview", "design", "layers", "timeline"] as const).map(id => {
      const Icon = TAB_ICONS[id];
      return <MenuCheckboxItem key={id}
      closeOnClick={false} checked={visible.has(id) && !collapsed?.includes(PANEL_DEFINITIONS[id].zone)}
      onCheckedChange={checked => controller?.setPanelVisible?.(id, checked)}><span className="motion-layout-menu-option"><Icon size={16} aria-hidden /><span>{t(PANEL_DEFINITIONS[id].title)}</span></span></MenuCheckboxItem>;
    })}
    <MenuSeparator />
    <div className="motion-menu-label">{t("Layout presets")}</div>
    <MenuItem onClick={() => controller?.fitTimeline?.()}>{t("Fit timeline to content")}</MenuItem>
    <MenuItem onClick={() => controller?.applyWorkspacePreset?.("preview")}>{t("Focus preview")}</MenuItem>
    <MenuItem onClick={() => controller?.applyWorkspacePreset?.("edit")}>{t("Restore default layout")}</MenuItem>
  </Menu>;
}
