import { RemixIcon } from "../../icons/RemixIcons";
import { OverflowText } from "../ui/OverflowText";
import { useMvpEditor } from "../../motion/StudioHost";
import { useI18n } from "../../i18n/I18n";
import { useState, useRef, useEffect, useCallback } from "react";
import { InlineAssetRename } from "./InlineAssetRename";
import { ContextMenu } from "./AssetContextMenu";
import { filename, formatDuration, type CopyFeedback } from "./assetHelpers";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";
import { usePlayerStore } from "../../player/store/playerStore";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";
import { findClipForAsset, isPointerClick } from "../../utils/assetClickBehavior";
import { resolveMediaPreviewUrl } from "../../player/components/thumbnailUtils";
import { timelineClipFocusId } from "../../player/components/timelineNavigationIdentity";

import { AudioAssetWaveform } from "./AudioAssetWaveform";
import { useAudioAssetPreview } from "../../hooks/useAudioAssetPreview";
import { useNearViewport } from "../../hooks/useNearViewport";
import { thumbnailRevisionOf } from "../../player/store/thumbnailSlice";
import { useToast } from "../../hooks/useToast";
import { StudioToastViewport } from "../StudioToastViewport";

export function AudioRow({
  projectId,
  asset,
  used,
  meta,
  onCopy,
  copyFeedback,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: {
  projectId: string;
  asset: string;
  used: boolean;
  meta?: { description?: string; duration?: number };
  onCopy: (path: string) => void;
  copyFeedback: CopyFeedback;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => unknown;
}) {
  const { t } = useI18n();
  const mvp = useMvpEditor();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const visible = useNearViewport(element);
  const sessionEpoch = usePlayerStore(s => s.timelineSessionEpoch);
  const revision = usePlayerStore(s => thumbnailRevisionOf(s.thumbnailRevisions, asset));
  const { toasts, showToast, dismissToast } = useToast();
  const name = filename(asset);
  const sourceUrl = resolveMediaPreviewUrl(asset, projectId);
  const serveUrl = `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}assetRevision=${revision}&session=${sessionEpoch}`;
  const { playing, pending, time, duration, toggle } = useAudioAssetPreview(serveUrl, visible, () => showToast(t("Preview failed to load")));
  const durationLabel = formatDuration(duration || meta?.duration || 0);
  const timeLabel = time > 0 ? `${formatDuration(Math.floor(time)) || "00:00"} / ${durationLabel || "—"}` : durationLabel || "—";
  const isCopied = copyFeedback?.path === asset && copyFeedback.ok;
  const copyFailed = copyFeedback?.path === asset && !copyFeedback.ok;

  useEffect(() => {
    if (isCopied) showToast(t("Copied"), "info");
    if (copyFailed) showToast(t("Copy failed"));
  }, [isCopied, copyFailed, showToast, t]);

  // CapCut-style click behavior: drag-threshold gate.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const requestTimelineFocus = usePlayerStore((s) => s.requestTimelineFocus);
  const elements = usePlayerStore((s) => s.elements);
  const setPreviewAsset = useAssetPreviewStore((s) => s.setPreviewAsset);
  const clearPreviewAsset = useAssetPreviewStore((s) => s.clearPreviewAsset);

  // Legacy: reveal an existing clip. MVP: always preview the source. Otherwise open
  // the preview overlay. Shared by pointer-up and keyboard activation so the
  // row does the same thing however it is operated.
  const activateRow = useCallback(() => {
    if (used && !mvp) {
      const clip = findClipForAsset(elements, asset);
      if (clip) {
        // Dismiss any open preview overlay (from another asset) — the reveal
        // must not leave a stale preview card floating over the canvas.
        clearPreviewAsset();
        const clipKey = clip.key ?? clip.id;
        setSelectedElementId(clipKey);
        // Scroll the timeline so the selected clip is actually visible.
        requestTimelineFocus(timelineClipFocusId(clipKey));
        return;
      }
    }
    // Not added → preview overlay (audio player)
    setPreviewAsset(asset, projectId, onAddAssetToTimeline ? () => onAddAssetToTimeline(asset) : undefined);
  }, [
    mvp,
    used,
    elements,
    asset,
    projectId,
    setSelectedElementId,
    requestTimelineFocus,
    setPreviewAsset,
    onAddAssetToTimeline,
    clearPreviewAsset,
  ]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const origin = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!origin) return;
      if (!isPointerClick(e.clientX - origin.x, e.clientY - origin.y)) return;
      activateRow();
    },
    [activateRow],
  );

  return (
    <>
      <div
        ref={setElement}
        data-playing={playing || undefined}
        draggable
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        role="button"
        tabIndex={0}
        aria-label={t("{name}: open, drag to timeline, right-click for actions", { name: name })}
        onKeyDown={(e) => {
          // Only when the row itself is focused — keydowns bubbling from the
          // inner controls (play button) must keep their native activation.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activateRow();
          }
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset, duration: meta?.duration }));
          e.dataTransfer.setData("text/plain", asset);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        className="motion-audio-row"
      >
        <button
          type="button"
          aria-label={playing || pending ? t("Pause preview of {name}", { name }) : t("Play preview of {name}", { name })}
          aria-pressed={playing || pending}
          aria-busy={pending || undefined}
          draggable={false}
          className="motion-audio-play-button"
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); void toggle(); }}
        >
          <RemixIcon name={playing || pending ? "pause-fill" : "play-fill"} size={16} />
        </button>
        <div className="motion-audio-content">
          <div className="motion-audio-heading">
            {renaming && onRename ? <InlineAssetRename asset={asset} onRename={onRename} onDone={() => setRenaming(false)} /> :
              <OverflowText text={name} className="motion-audio-name" />}
            <button type="button" className="motion-audio-menu-button" aria-label={t("Actions for {value0}", { value0: name })} title={t("Actions for {value0}", { value0: name })} aria-haspopup="menu" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setContextMenu({ x: rect.left, y: rect.bottom }); }}><RemixIcon name="more-line" size={16} /></button>
          </div>
          {used && <span className="motion-audio-used">{t("In use")}</span>}
          <div className="motion-audio-detail">
            <AudioAssetWaveform asset={asset} projectId={projectId} audioUrl={serveUrl} revision={revision} sessionEpoch={sessionEpoch} visible={visible} />
            <span className="motion-audio-time">{timeLabel}</span>
          </div>
        </div>
      </div>
      <StudioToastViewport toasts={toasts} dismissToast={dismissToast} />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={asset}
          onClose={() => setContextMenu(null)}
          onCopy={onCopy}
          onDelete={onDelete}
          onRename={onRename}
          onStartRename={() => setRenaming(true)}
          onAddAtPlayhead={onAddAssetToTimeline}
          onPreview={path => setPreviewAsset(path, projectId)}
          downloadUrl={serveUrl}
        />
      )}
    </>
  );
}
