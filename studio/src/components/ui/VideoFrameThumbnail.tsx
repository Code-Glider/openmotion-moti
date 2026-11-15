import { useI18n } from "../../i18n/I18n";
import { useState, useEffect } from "react";

/**
 * Extracts a representative JPEG frame from a video URL using a hidden
 * video + canvas. Seeks to ~10% of duration to avoid black opening frames.
 * Used by AssetThumbnail (assets tab) and RenderQueueItem (renders tab).
 */
export function VideoFrameThumbnail({
  src,
  fallbackLabel,
}: {
  src: string;
  /** Shown instead of an endless shimmer when the video can't be decoded. */
  fallbackLabel?: string;
}) {
  const { t } = useI18n();
  const [frame, setFrame] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setFrame(null);
    let disposed = false;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Clearing src fires one more `error` on the video, so the error handler
    // must be detached first — otherwise error → cleanup → error spins forever.
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      video.removeEventListener("error", onError);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("seeked", onSeeked);
      video.src = "";
      video.load();
    };
    const onError = () => {
      // Ignore the synthetic error cleanup itself just triggered.
      if (disposed || !video.getAttribute("src")) return;
      setFrame(null);
      setFailed(true);
      cleanup();
    };

    const onMetadata = () => {
      if (disposed) return;
      // Audio-only containers have no drawable video frame. A zero-sized
      // canvas would serialize as "data:," and render a broken image.
      if (!video.videoWidth || !video.videoHeight) { onError(); return; }
      video.currentTime = Math.min(2, video.duration * 0.1 || 2);
    };

    const onSeeked = () => {
      if (disposed) return;
      if (!ctx || !video.videoWidth || !video.videoHeight) { onError(); return; }
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const image = canvas.toDataURL("image/jpeg", 0.7);
        if (!image.startsWith("data:image/")) { onError(); return; }
        setFrame(image);
        cleanup();
      } catch {
        onError();
      }
    };

    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.src = src;
    video.load();

    return cleanup;
  }, [src]);

  if (failed && !frame) {
    return (
      <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
        <span className="text-[9px] font-medium text-neutral-600">{fallbackLabel ?? t("Video")}</span>
      </div>
    );
  }

  if (!frame) {
    return <div data-thumbnail-loading className="w-full h-full bg-panel-surface" />;
  }

  return <img src={frame} alt="" draggable={false} className="w-full h-full object-contain"
    onError={() => { setFrame(null); setFailed(true); }} />;
}
