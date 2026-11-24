import { useLivePreviewIframe } from "../player/store/previewIframeStore";
import { buildProjectApiPath } from "../utils/projectRouting";
import { useEffect, useRef } from "react";
import { useCaptionStore } from "../captions/store";
import { acceptStudioRuntimeMessage } from "../player/lib/runtimeProtocol";
import { useCaptionSync } from "../captions/hooks/useCaptionSync";
import { parseCaptionComposition } from "../captions/parser";
import { hydrateManagedCaptionSource } from "../captions/nativeSource";
import { studioApiFetch } from "../utils/studioApiFetch";

interface UseCaptionDetectionParams {
  projectId: string | null;
  activeCompPath: string | null;
  compIdToSrc: Map<string, string>;
  captionEditMode: boolean;
  captionHasSelection: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  captionSync: ReturnType<typeof useCaptionSync>;
  setRightCollapsed: (collapsed: boolean) => void;
}

export function useCaptionDetection({
  projectId,
  activeCompPath,
  compIdToSrc,
  captionEditMode,
  captionHasSelection,
  previewIframeRef,
  captionSync,
  setRightCollapsed,
}: UseCaptionDetectionParams) {
  const livePreviewIframe = useLivePreviewIframe();
  // Switching compositions must drop the previous comp's caption state — a
  // stale model + full-canvas overlay otherwise blocks normal element editing
  // on the new composition (and edit mode could never be exited).
  const prevCompPathRef = useRef<string | null>(activeCompPath);
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (prevCompPathRef.current !== activeCompPath) {
      prevCompPathRef.current = activeCompPath;
      const store = useCaptionStore.getState();
      if (store.model || store.isEditMode) {
        // Flush the last debounced caption edit before the reset destroys the
        // model — otherwise a save landing after the switch writes nothing.
        store.retrySave?.();
        store.reset();
      }
    }
  }, [activeCompPath]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;

    let activating = false;

    const tryActivateCaptions = () => {
      const captionState = useCaptionStore.getState();
      // `dismissed` = user explicitly exited caption editing; don't re-trap them.
      if (captionState.isEditMode || captionState.dismissed || activating) {
        return;
      }

      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      let win: Window | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
        win = iframe?.contentWindow ?? null;
      } catch {
        return;
      }
      if (!doc || !win) return;

      const groups = doc.querySelectorAll(".caption-group");
      if (groups.length === 0) return;

      let captionSrcPath: string | null = null;

      const compHosts = doc.querySelectorAll("[data-composition-src], [data-composition-file]");
      for (const host of compHosts) {
        const src =
          host.getAttribute("data-composition-src") || host.getAttribute("data-composition-file");
        if (src && src.includes("captions")) {
          captionSrcPath = src;
          break;
        }
      }

      if (!captionSrcPath) {
        for (const [id, src] of compIdToSrc) {
          if (id.includes("caption") || src.includes("caption")) {
            captionSrcPath = src;
            break;
          }
        }
      }

      if (!captionSrcPath && activeCompPath?.includes("captions")) {
        captionSrcPath = activeCompPath;
      }

      if (!captionSrcPath) {
        const captionComp = doc.querySelector('[data-composition-id*="caption"]');
        if (captionComp) {
          const compId = captionComp.getAttribute("data-composition-id") || "";
          captionSrcPath = compIdToSrc.get(compId) || null;
        }
      }

      // A project's root index.html can itself be an explicitly managed
      // caption composition. The composition-to-file map is not guaranteed
      // to include its root ID, unlike nested caption assets. Only fall back
      // to the active root after verifying the exact caption composition ID;
      // the fetched source must also opt into our SHA-managed format.
      const managedRootFallback = !captionSrcPath && Boolean(activeCompPath)
        && Boolean(doc.querySelector('[data-composition-id="captions"]'));
      if (managedRootFallback) captionSrcPath = activeCompPath;
      if (!captionSrcPath) return;

      activating = true;
      const srcPath = captionSrcPath;
      studioApiFetch(buildProjectApiPath(projectId, `/files/${encodeURIComponent(srcPath)}`))
        .then((r) => r.json())
        .then(async (data: { content?: string }) => {
          if (!data.content || !doc || !win || useCaptionStore.getState().isEditMode) return;
          if (managedRootFallback &&
              !data.content.includes('data-openmotion-caption-source="v1"')) return;
          const root = doc.querySelector("[data-composition-id]");
          const w = parseInt(root?.getAttribute("data-width") ?? "1920", 10);
          const h = parseInt(root?.getAttribute("data-height") ?? "1080", 10);
          const dur = parseFloat(root?.getAttribute("data-duration") ?? "0");
          const model = parseCaptionComposition(doc, win, data.content, w, h, dur);
          if (!model) return;
          // Managed caption scripts are the native-render source of truth.
          // Verify their hash and canonical authored word IDs, and hydrate
          // saved wrapper transforms before enabling editing. The legacy
          // sidecar remains the fallback ONLY for unmarked custom sources.
          const hydrated = await hydrateManagedCaptionSource(data.content, model);
          if (useCaptionStore.getState().isEditMode) return;
          const store = useCaptionStore.getState();
          store.setModel(hydrated.model);
          store.setSourceFilePath(srcPath);
          store.setEditMode(true);
          if (!hydrated.managed) void captionSync.loadOverrides();
        })
        .catch((error: unknown) => {
          // A corrupted managed source must fail closed, not reopen an editor
          // with empty offsets that would overwrite the authored native file.
          useCaptionStore.getState().setSyncError(
            "Caption source could not be verified: " + String(error),
          );
        })
        .finally(() => {
          activating = false;
        });
    };

    const handleMessage = (e: MessageEvent) => {
      if (!e.source || e.source !== previewIframeRef.current?.contentWindow) return;
      const data = e.data;
      if (data?.source === "hf-preview" && (data?.type === "state" || data?.type === "timeline")) {
        if (!acceptStudioRuntimeMessage(data)) return;
        tryActivateCaptions();
      }
    };

    // The iframe can finish its initial script after this effect's first
    // read, without sending a later trusted hf-preview state message. Observe
    // the live document only until it exposes its first caption group; this
    // cannot rewrite source or activate an unrelated, non-caption project.
    let observedDocument: MutationObserver | null = null;
    const previewFrame = previewIframeRef.current;
    const observePreview = () => {
      observedDocument?.disconnect();
      observedDocument = null;
      let current: Document | null = null;
      try { current = previewIframeRef.current?.contentDocument ?? null; }
      catch { return; }
      if (!current?.documentElement) return;
      if (current.querySelector(".caption-group")) {
        tryActivateCaptions();
        return;
      }
      observedDocument = new MutationObserver(() => {
        if (!current?.querySelector(".caption-group")) return;
        observedDocument?.disconnect();
        observedDocument = null;
        tryActivateCaptions();
      });
      observedDocument.observe(current.documentElement, { childList: true, subtree: true });
    };
    window.addEventListener("message", handleMessage);
    previewFrame?.addEventListener("load", observePreview);
    observePreview();

    return () => {
      observedDocument?.disconnect();
      previewFrame?.removeEventListener("load", observePreview);
      window.removeEventListener("message", handleMessage);
    };
  }, [activeCompPath, projectId, compIdToSrc, captionSync, previewIframeRef, livePreviewIframe]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (captionEditMode) {
      setRightCollapsed(!captionHasSelection);
    }
  }, [captionHasSelection, captionEditMode, setRightCollapsed]);
}
