import { RemixIcon } from "../../icons/RemixIcons";
import { useI18n } from '../../i18n/I18n';
import { Eye, EyeSlash } from "../../icons/RemixIcons";
import { X } from "../../icons/SystemIcons";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import type { DomEditSelection } from "./domEditingTypes";

/** The action buttons in the inspector header: visibility, Ungroup (groups only), copy, clear. */
import { keyHint, useStudioKeys } from "../../player/components/studioShortcuts";

export function InspectorHeaderActions({
  element,
  copied,
  onCopy,
  onClear,
  onUngroup,
  selectedElementId,
  selectedElementHidden,
  visibilityLabel,
  onToggleHidden,
}: {
  element: DomEditSelection;
  copied: boolean;
  onCopy: () => void;
  onClear: () => void;
  onUngroup?: () => void;
  selectedElementId?: string | null;
  selectedElementHidden?: boolean;
  visibilityLabel?: string;
  onToggleHidden?: (id: string, hidden: boolean) => void;
}) {
  const { t } = useI18n();
  const track = useTrackDesignInput();
  return (
    <div className="flex items-center gap-1">
      {selectedElementId && onToggleHidden && (
        <button
          type="button"
          aria-label={visibilityLabel}
          title={visibilityLabel}
          onClick={() => {
            track("toggle", "Element visibility");
            void onToggleHidden(selectedElementId, !selectedElementHidden);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
        >
          {selectedElementHidden ? (
            <EyeSlash size={13} weight="bold" aria-hidden="true" />
          ) : (
            <Eye size={13} weight="bold" aria-hidden="true" />
          )}
        </button>
      )}
      {onUngroup && element.dataAttributes["hf-group"] != null && (
        <button
          type="button"
          onClick={() => {
            track("button", "Ungroup");
            onUngroup();
          }}
          title={t('Ungroup ({shortcut})', { shortcut: keyHint('ungroup', useStudioKeys()) })}
          className="flex h-6 items-center rounded-sm px-2 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
        >
          {t('Ungroup')}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          track("button", "Copy element info");
          onCopy();
        }}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
          copied
            ? "text-accent-ink"
            : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
        }`}
        title={t(copied ? "Copied!" : "Copy element info to clipboard")}
      >
        <RemixIcon name="file-copy-line" size={13} />
      </button>
      <button
        type="button"
        aria-label={t("Clear selection")}
        onClick={() => {
          track("button", "Clear selection");
          onClear();
        }}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
      >
        <X size={13} />
      </button>
    </div>
  );
}
