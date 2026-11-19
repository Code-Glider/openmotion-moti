import { useEffect, useRef, useState } from 'react';
import { useShownStudioTheme } from '../utils/studioTheme';
import { prepareMotionGuide, type GuideAppearance } from './templateMotionGuideDocument';

export function TemplateMotionGuide({ url, title, expanded = false, onEscape }: { url: string; title: string; expanded?: boolean; onEscape?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useShownStudioTheme();
  const latestTheme = useRef(theme);
  latestTheme.current = theme;
  const [document, setDocument] = useState<{ url: string; src: string; html?: string }>({ url: '', src: 'about:blank' });
  function appearance(): GuideAppearance {
    const style = getComputedStyle(frame.current!);
    return {
      theme: latestTheme.current,
      background: style.backgroundColor,
      text: style.getPropertyValue('--motion-text').trim(),
      muted: style.getPropertyValue('--motion-muted').trim(),
      surface: style.getPropertyValue('--motion-panel').trim(),
      border: style.getPropertyValue('--motion-border').trim(),
    };
  }
  function syncAppearance() {
    // The iframe deliberately has an opaque origin, so targetOrigin must be '*'.
    frame.current?.contentWindow?.postMessage({ type: 'openmotion:guide-appearance', appearance: appearance() }, '*');
  }
  useEffect(() => { syncAppearance(); }, [theme]);
  useEffect(() => {
    if (!expanded || !onEscape) return;
    function receiveEscape(event: MessageEvent) {
      const guide = frame.current;
      if (guide?.hasAttribute('srcdoc') && guide.ownerDocument.activeElement === guide &&
          event.source === guide.contentWindow && event.origin === 'null' && event.data === 'openmotion:guide-escape') onEscape?.();
    }
    window.addEventListener('message', receiveEscape);
    return () => window.removeEventListener('message', receiveEscape);
  }, [expanded, onEscape]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Guide unavailable');
        const source = await response.text();
        if (!controller.signal.aborted) {
          // A blob retains the parent's URL origin for authored postMessage calls.
          // The sandbox still gives its script an opaque security origin.
          const html = prepareMotionGuide(source, response.url || url, appearance(), expanded);
          if (expanded) setDocument({ url, src: 'about:blank', html });
          else {
            objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            setDocument({ url, src: objectUrl });
          }
        }
      } catch {
        // Keep guides usable when a remote host does not permit CORS reads.
        if (!controller.signal.aborted) setDocument({ url, src: url });
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, expanded]);
  const current = document.url === url ? document : undefined;
  return <iframe ref={frame} src={current?.html ? undefined : current?.src ?? 'about:blank'} srcDoc={current?.html} title={title} onLoad={syncAppearance}
    sandbox="allow-scripts" loading={expanded ? 'eager' : 'lazy'} referrerPolicy="no-referrer" />;
}
