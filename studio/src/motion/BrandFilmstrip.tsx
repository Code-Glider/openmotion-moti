import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { GalleryTemplate } from '../../../shared/catalog';
import { MotionIcon } from './icons';
import { TemplatePoster } from './TemplateGalleryCard';
import { popupSurface, POPUP_LAYER } from '../components/ui/floatingSurface';
import { brandWorkDate, formatBrandWorkDate, recordBrandReview } from './brandStoryData';
import styles from './BrandStories.module.css';

/** Browsing the reel never changes playback; only activating a frame selects it. */
export function BrandFilmstrip({ brand, items, selectedId, progress, playing, reduced, covered, onSelect, onBrowse }: {
  onBrowse?: (method: 'arrow' | 'drag', direction?: 'previous' | 'next') => void;
  brand: string; items: GalleryTemplate[]; selectedId?: string; progress: number;
  playing: boolean; reduced: boolean; covered: boolean; onSelect: (item: GalleryTemplate) => void;
}) {
  const rail = useRef<HTMLOListElement>(null);
  const drag = useRef<{ pointer: number; x: number; scroll: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [dragging, setDragging] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [finePointer, setFinePointer] = useState(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
  const key = items.map(item => item.id).join(',');
  const measure = () => {
    setPeekId(null);
    const node = rail.current;
    if (node) setEdges({ start: node.scrollLeft <= 2, end: node.scrollWidth - node.clientWidth - node.scrollLeft <= 2 });
  };
  useEffect(() => {
    const preference = matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setFinePointer(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (covered) setPeekId(null); }, [covered]);
  const reveal = (button: HTMLElement | null, smooth = true) => {
    const node = rail.current;
    if (!node || !button) return;
    const frame = button.closest('li')!;
    const left = frame.getBoundingClientRect().left - node.getBoundingClientRect().left + node.scrollLeft;
    if (left < node.scrollLeft || left + frame.clientWidth > node.scrollLeft + node.clientWidth) {
      node.scrollTo({ left: Math.max(0, left - (node.clientWidth - frame.clientWidth) / 2), behavior: !reduced && smooth ? 'smooth' : 'instant' });
    }
  };
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (rail.current) observer.observe(rail.current);
    return () => observer.disconnect();
  }, [key]);
  useEffect(() => { reveal(rail.current?.querySelector('[aria-current="true"]') ?? null, false); }, [selectedId, key]);
  const page = (direction: number) => {
    const node = rail.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * .75, behavior: reduced ? 'instant' : 'smooth' });
    onBrowse?.('arrow', direction < 0 ? 'previous' : 'next');
    recordBrandReview('brand_reel_browse', { brand, method: 'arrow', direction });
  };
  const finishDrag = (event: PointerEvent<HTMLOListElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    if (state.moved) { onBrowse?.('drag'); recordBrandReview('brand_reel_browse', { brand, method: 'drag' }); }
    suppressClick.current = state.moved;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <section className={styles.filmstrip} aria-label="品牌作品胶片时间轴">
    <header className={styles.reelHeading}>
      <div><MotionIcon name="film" size={18} /><h2>作品时间轴</h2><span>{items.length} 支作品</span></div>
      <div className={styles.reelControls}><span>拖动浏览 · 点击观看</span><button className="om-button om-icon-button" aria-label="向前浏览胶片" disabled={edges.start} onClick={() => page(-1)}><MotionIcon name="arrow-left" size={16} /></button><button className="om-button om-icon-button" aria-label="向后浏览胶片" disabled={edges.end} onClick={() => page(1)}><MotionIcon name="arrow-right" size={16} /></button></div>
    </header>
    <ol ref={rail} className={styles.reelRail} data-dragging={dragging || undefined} onScroll={measure}
      onDragStart={event => event.preventDefault()}
      onPointerDown={event => {
        setPeekId(null);
        suppressClick.current = false;
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        drag.current = { pointer: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
      }} onPointerMove={event => {
        const state = drag.current;
        if (!state || state.pointer !== event.pointerId) return;
        const distance = event.clientX - state.x;
        if (!state.moved && Math.abs(distance) < 6) return;
        if (!state.moved) { state.moved = true; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }
        event.preventDefault();
        event.currentTarget.scrollLeft = state.scroll - distance;
      }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
      onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
        buttons[next]?.focus({ preventScroll: true }); reveal(buttons[next]);
      }}>
      {items.map((item, index) => {
        const date = brandWorkDate(item);
        const selected = item.id === selectedId;
        return <li key={item.id} data-active={selected || undefined} data-film-id={item.id}>
          <BaseTooltip.Root open={peekId === item.id && !dragging && !covered && finePointer} disabled={dragging || covered || !finePointer} onOpenChange={open => {
            setPeekId(previous => open ? item.id : previous === item.id ? null : previous);
            if (open) recordBrandReview('brand_reel_peek', { brand, templateId: item.id });
          }}>
          <BaseTooltip.Trigger delay={180} render={<button className={`om-button ${styles.reelFrame}`} aria-label={'选择作品 ' + item.title} aria-current={selected ? 'true' : undefined} aria-pressed={selected} onClick={event => { setPeekId(null); onSelect(item); reveal(event.currentTarget); }} />}>
            <span className={styles.reelDate}><span>{String(index + 1).padStart(2,'0')}</span>{date && <time dateTime={date.value}>{formatBrandWorkDate(date)}</time>}</span>
            <span className={styles.reelImage}><TemplatePoster template={item} />
              {selected ? <span className={styles.reelNow} data-playing={playing || undefined}><i /><i /><i /><span>当前观看</span></span> : <span className={styles.reelPlay}><MotionIcon name="play" size={16} /></span>}
              {item.duration != null && <span className={styles.reelDuration}>{Math.round(item.duration)}s</span>}
              {selected && <span className={styles.nodeProgress} style={{ width: `${progress * 100}%` }} />}
            </span>
            <strong>{item.title}</strong>
          </BaseTooltip.Trigger>
          <BaseTooltip.Portal container={rail.current?.closest('dialog') ?? undefined}>
            <BaseTooltip.Positioner side="top" sideOffset={12} collisionPadding={16} className={POPUP_LAYER}>
              <BaseTooltip.Popup role="tooltip" aria-label={'放大预览 ' + item.title} className={`${popupSurface} ${styles.reelPeek}`} data-reduced={reduced || undefined}>
                <div className={styles.reelPeekMedia}><TemplatePoster template={item} eager /></div>
                <div className={styles.reelPeekCopy}><strong>{item.title}</strong><span>{date && <time dateTime={date.value}>{formatBrandWorkDate(date)}</time>}<span>{item.duration != null ? `${Math.round(item.duration)}s` : ''}</span></span></div>
              </BaseTooltip.Popup>
            </BaseTooltip.Positioner>
          </BaseTooltip.Portal>
          </BaseTooltip.Root>
        </li>;
      })}
    </ol>
  </section>;
}
