import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18n";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { createThumbnailKey } from "../../player/lib/thumbnailScheduler";
import { loadWaveform } from "../../player/lib/audioWaveformLoader";
import { decimatePeaks } from "../../player/components/audioWaveformPeaks";
import { encodePreviewPath } from "../../player/components/thumbnailUtils";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { Tooltip } from "../ui/Tooltip";

/** Viewport-gated, revision-scoped sample peaks; this is not a seek control. */
export function AudioAssetWaveform({ asset, projectId, audioUrl, revision, sessionEpoch, visible }: {
  asset: string; projectId: string; audioUrl: string; revision: number; sessionEpoch: number; visible: boolean;
}) {
  const { t } = useI18n();
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [barCount, setBarCount] = useState(64);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setBarCount(Math.max(1, Math.min(64, Math.floor(element.clientWidth / 3))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const request = useMemo(() => ({
    key: createThumbnailKey({ kind: "asset-waveform", source: audioUrl, revision }),
    projectId, sessionEpoch, kind: "waveform" as const, priority: "visible" as const, rich: false,
    load: async (signal: AbortSignal) => {
      const peaks = await loadWaveform(audioUrl, buildProjectApiPath(projectId, `/waveform/${encodePreviewPath(asset)}`), signal, "audio");
      return { value: { kind: "waveform" as const, peaks }, weight: peaks.length * Float64Array.BYTES_PER_ELEMENT };
    },
  }), [asset, audioUrl, projectId, revision, sessionEpoch]);
  const snapshot = useThumbnailLease(visible ? request : null);
  const peaks = snapshot.status === "ready" && snapshot.value.kind === "waveform" ? snapshot.value.peaks : null;
  const bars = useMemo(() => peaks ? decimatePeaks(peaks, 0, 1, barCount) : [], [barCount, peaks]);
  return <span ref={setElement} className="motion-audio-waveform" data-waveform-state={snapshot.status}>
    {bars.length ? <svg aria-hidden="true" viewBox={`0 0 ${barCount * 4} 20`} preserveAspectRatio="none">
      {bars.map((peak, index) => {
        const height = Math.max(1, Math.min(1, Math.max(0, peak)) * 18);
        return <line key={index} x1={index * 4 + 2} x2={index * 4 + 2} y1={10 - height / 2} y2={10 + height / 2} />;
      })}
    </svg> : snapshot.status === "error" ? <Tooltip label={t("waveform unavailable")} wrap>
      <span className="motion-audio-waveform-unavailable">{t("waveform unavailable")}</span>
    </Tooltip> : <span className="motion-audio-waveform-placeholder" aria-hidden="true" />}
  </span>;
}
