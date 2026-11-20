import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '../components/ui/Skeleton';

const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 800;

/**
 * Lazy-loaded, edge-to-edge scaled sandboxed iframe thumbnail for Design Studio templates and projects.
 * Dynamically matches the host container width via ResizeObserver so there is zero dead gutter.
 */
export function ScaledPreviewThumb({
  src,
  title,
  badge,
  topRight,
}: {
  src: string;
  title: string;
  badge?: string;
  topRight?: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0.25);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) setScale(width / VIRTUAL_WIDTH);
    };
    update();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return () => ro?.disconnect();
    }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '160px' });
    io.observe(el);
    return () => { io.disconnect(); ro?.disconnect(); };
  }, []);

  return (
    <div ref={hostRef} className="om-design-card-thumb" data-loaded={loaded}>
      {!loaded && <Skeleton className="om-design-thumb-skeleton" />}
      {visible && (
        <iframe
          title={title}
          src={src}
          loading="lazy"
          sandbox="allow-scripts"
          tabIndex={-1}
          onLoad={() => setLoaded(true)}
          style={{
            width: VIRTUAL_WIDTH,
            height: VIRTUAL_HEIGHT,
            transform: `scale(${scale})`,
            opacity: loaded ? 1 : 0,
          }}
        />
      )}
      {badge && <span className="om-design-thumb-badge">{badge}</span>}
      {topRight && <div className="om-design-thumb-action">{topRight}</div>}
    </div>
  );
}
