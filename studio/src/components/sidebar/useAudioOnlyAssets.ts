import { useEffect, useMemo, useState } from "react";
import { resolveMediaPreviewUrl } from "../../player/components/thumbnailUtils";
import { probeMediaUrl } from "../../player/lib/mediaProbe";
import { VIDEO_EXT } from "../../utils/mediaTypes";

const EMPTY = new Set<string>();

/** Reuse bounded, cached track probes so audio-only containers use normal audio rows. */
export function useAudioOnlyAssets(projectId: string, assets: string[]): ReadonlySet<string> {
  const candidates = useMemo(() => assets.filter(asset => VIDEO_EXT.test(asset)), [assets]);
  const [detected, setDetected] = useState({ projectId, paths: EMPTY });

  useEffect(() => {
    let cancelled = false;
    void Promise.all(candidates.map(async asset => {
      const result = await probeMediaUrl(resolveMediaPreviewUrl(asset, projectId));
      return result?.hasAudio && !result.hasVideo ? asset : null;
    })).then(paths => {
      if (!cancelled) setDetected({ projectId, paths: new Set(paths.filter((path): path is string => path !== null)) });
    });
    return () => { cancelled = true; };
  }, [projectId, candidates]);

  return detected.projectId === projectId ? detected.paths : EMPTY;
}
