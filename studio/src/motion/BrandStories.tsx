import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { isEditableTemplate, type GalleryTemplate } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { Skeleton } from '../components/ui/Skeleton';
import { Tooltip } from '../components/ui/Tooltip';
import { GithubLogo } from '@phosphor-icons/react';
import { templateRepositoryUrl } from './githubRepository';
import { MotionIcon } from './icons';
import { TemplateIdentity, TemplatePoster } from './TemplateGalleryCard';
import { discoveryPurposes } from './templateDiscoveryTaxonomy';
import { templateRatio } from './templateDiscovery';
import detailStyles from './TemplateLibraryDialog.module.css';
import { chronologicalItems, brandWorkTime, recordBrandReview, seriesNotes, type BrandSeries } from './brandStoryData';
import { BrandFilmstrip } from './BrandFilmstrip';
import { brandSceneFrame } from './brandStoryMotion';
import { brandWorkLesson, figmaLearningPaths, readBrandStoryNotes, storyChapterHighlights, type BrandStoryNotes, type StoryChapter } from './brandStoryLearning';
import { seriesId, reportSeriesShown, reportSeriesWork, reportSeriesClick, type SeriesView } from './brandStoryTracking';
import styles from './BrandStories.module.css';

const shortPurpose = (value: string) => ({ 'Product launch films': '产品发布', 'Product demos & explainers': '功能演示', 'Brand & company films': '商业介绍', 'Fundraising announcements': '融资官宣', 'Event & campaign films': '活动推广', 'Milestones & results': '业绩里程碑', 'Partnership announcements': '合作官宣' }[value] ?? value);

export function BrandSeriesCard({ series, discovery = false, onOpen }: { series: BrandSeries; discovery?: boolean; onOpen: (series: BrandSeries, element: HTMLButtonElement) => void }) {
  const { t } = useI18n();
  const note = seriesNotes[series.name];
  return <article className={styles.seriesCard} data-brand-series={series.name} data-series-id={seriesId(series.name)}>
    <button className={styles.seriesButton} onClick={event => onOpen(series, event.currentTarget)} aria-label={'查看 ' + series.name + ' 品牌系列'}>
      <div className={styles.seriesArt}>
        <div className={styles.seriesEyebrow}><span>{discovery ? '品牌系列精选' : 'TOP 100 · 品牌合集'}</span><MotionIcon name="arrow-up-right" size={17} /></div>
        <div className={styles.coverStack} aria-hidden="true">{series.items.slice(0, 3).reverse().map((item, index, covers) => <div className={styles.stackItem} key={item.id} data-layer={3 - covers.length + index}><TemplatePoster template={item} /></div>)}</div>
        <span className="om-gallery-card-shade" style={{ opacity: 1 }} aria-hidden="true" />
        <div className={styles.artCaption}><TemplateIdentity template={series.items[0]} brand /><strong>{series.name}</strong><span>{series.items.length} 支作品</span></div>
      </div>
      <div className={styles.seriesCopy}>
        {discovery ? <><h2>{note?.title ?? series.name + '，值得借鉴的表达'}</h2><p>{series.videoInsight ?? note?.focus}</p></> : <div className={styles.seriesPurposes}>{series.purposes.slice(0, 2).map(value => <span key={value}>{shortPurpose(value) === value ? t(value) : shortPurpose(value)}</span>)}</div>}
        <span className={styles.seriesLink}>{discovery ? '看看怎么讲' : '浏览发布历程'}<MotionIcon name="arrow-right" size={15} /></span>
      </div>
    </button>
  </article>;
}

function BrandWorkActions({ template, onCopy, onDownload, onDetails, trackingView }: {
  trackingView?: SeriesView; template: GalleryTemplate; onCopy: (item: GalleryTemplate, submit?: boolean) => Promise<string | null>;
  onDownload: (item: GalleryTemplate) => Promise<void>; onDetails: () => void;
}) {
  const { t } = useI18n();
  const [copying, setCopying] = useState(false), [downloading, setDownloading] = useState(false);
  const [manualCopy, setManualCopy] = useState('');
  const recreate = async (submit = false) => {
    setCopying(true);
    try { setManualCopy(await onCopy(template, submit) ?? ''); }
    finally { setCopying(false); }
  };
  return <div className={styles.actionDock} aria-label="作品创作操作">
    <div className={styles.storySpecs} aria-label="作品参数">
      <span className="om-badge">{t(isEditableTemplate(template) ? 'Editable project' : 'Reference creation')}</span>
      {template.duration != null && <span>{t('{value}s', { value: Number(template.duration.toFixed(1)) })}</span>}
      {(template.width || template.ratio) && <span>{templateRatio(template)}</span>}
      <button className={`om-button ${styles.detailsAction}`} onClick={onDetails}>查看完整详情<MotionIcon name="arrow-up-right" size={14} /></button>
    </div>
    <div className={styles.storyActions}>
      <div className={styles.recreateRow}>
        <button className="om-button" data-primary disabled={copying} onClick={() => void recreate()}>{copying ? t('Loading instruction…') : t('Recreate template')}<MotionIcon name="sparkles" size={17} /></button>
        <Tooltip withinDialog wrap label={t('Recreate and submit')}>
          <button className={`om-button om-icon-button ${styles.submitAction}`} disabled={copying} aria-label={t('Recreate and submit')} onClick={() => void recreate(true)}><MotionIcon name="git-branch" size={18} /></button>
        </Tooltip>
      </div>
      <div className={styles.resourceLinks}>
        <a className="om-text-link" href={templateRepositoryUrl(template)} target="_blank" rel="noreferrer" onClick={() => reportSeriesClick(trackingView, 'view_repository', template)}><GithubLogo size={16} weight="fill" />{t('View on GitHub')}</a>
        {template.motionDocumentUrl && <button className="om-text-link" disabled={downloading} onClick={async () => { setDownloading(true); try { await onDownload(template); } finally { setDownloading(false); } }}><MotionIcon name="download" size={16} />{t(downloading ? 'Downloading…' : 'Download motion.md')}</button>}
      </div>
    </div>
    {manualCopy && <textarea className={detailStyles.manualCopy} readOnly rows={5} value={manualCopy} aria-label={t('Content to copy')} onFocus={event => event.currentTarget.select()} />}
  </div>;
}

export function BrandStoriesDialog({ series, covered, onClose, onTemplate, onCompare, onCopy, onDownload, motionTime, motionNotes, trackingView }: {
  /** Absolute project time is supplied only by the MotionHarness authoring scene. */
  motionTime?: number;
  trackingView?: SeriesView;
  motionNotes?: Record<string, BrandStoryNotes>;
  onCopy: (item: GalleryTemplate, submit?: boolean) => Promise<string | null>; onDownload: (item: GalleryTemplate) => Promise<void>;
  series: BrandSeries; covered: boolean; onClose: () => void;
  onTemplate: (item: GalleryTemplate, guide?: boolean) => void; onCompare: (purpose: string) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState<{ id: string; value: BrandStoryNotes }>();
  const [progress, setProgress] = useState(0), [playing, setPlaying] = useState(false);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [mediaState, setMediaState] = useState<{ key: string; ready: boolean; failed: boolean }>();
  const [mediaAspect, setMediaAspect] = useState<{ id: string; ratio: number } | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const chronology = useMemo(() => chronologicalItems(series, true), [series]);
  const visible = chronology.filter(item => !purpose || discoveryPurposes(item).includes(purpose));
  const [selectedId, setSelectedId] = useState(chronology[0]?.id);
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  const mediaRatio = mediaAspect && mediaAspect.id === selected?.id ? mediaAspect.ratio : selected?.width && selected?.height && selected.width > 0 && selected.height > 0 ? selected.width / selected.height : 16 / 9;
  const mediaKey = selected?.id + ':' + mediaAttempt;
  const mediaReady = mediaState?.key === mediaKey && mediaState.ready;
  const mediaFailed = mediaState?.key === mediaKey && mediaState.failed;
  const markReady = () => setMediaState({ key: mediaKey, ready: true, failed: false });
  const markFailed = () => setMediaState({ key: mediaKey, ready: false, failed: true });
  const selectedIndex = visible.findIndex(item => item.id === selected?.id);
  const lesson = selected ? brandWorkLesson(selected) : undefined;
  const capturing = motionTime !== undefined;
  const selectedNotes = capturing ? motionNotes?.[selected?.id] : notes?.id === selected?.id ? notes.value : undefined;
  const chapters = storyChapterHighlights(selectedNotes?.chapters ?? []);
  const dated = chronology.map(brandWorkTime).filter((time): time is number => time !== undefined);
  const years = dated.length ? [...new Set(dated.map(time => new Date(time).getUTCFullYear()))].join(' — ') : undefined;
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const shownView = useRef<string | undefined>(undefined), shownWork = useRef<string | undefined>(undefined);
  useEffect(() => {
    const report = () => {
      if (!trackingView || capturing || covered || document.hidden || !dialog.current?.open || !selected) return;
      if (shownView.current !== trackingView.series_view_id) {
        shownView.current = trackingView.series_view_id; shownWork.current = undefined; reportSeriesShown(trackingView);
      }
      if (shownWork.current !== selected.id) {
        shownWork.current = selected.id; reportSeriesWork(trackingView, selected, selectedIndex + 1);
      }
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [trackingView, capturing, covered, selected?.id, selectedIndex]);
  const close = () => { reportSeriesClick(trackingView, 'close_detail', selected); onClose(); };

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches);
    preference.addEventListener('change', update); return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => { setProgress(0); setPlaying(false); }, [selected?.id]);
  useEffect(() => {
    if (!selected?.previewUrl || mediaReady || mediaFailed || covered) return;
    const timeout = window.setTimeout(() => { markFailed(); }, 20000);
    return () => clearTimeout(timeout);
  }, [mediaKey, selected?.previewUrl, mediaReady, mediaFailed, covered]);
  useEffect(() => {
    if (covered && video.current) {
      // A paused element can keep downloading. Release its source while the full detail owns playback.
      setMediaState(undefined);
      video.current.pause(); video.current.removeAttribute('src'); video.current.load();
    }
  }, [covered]);
  useEffect(() => {
    const pause = () => { if (document.hidden) { video.current?.pause(); } };
    document.addEventListener('visibilitychange', pause); return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const duration = parseFloat(getComputedStyle(node).getPropertyValue('--motion-duration-slow')) / 1000 || .3;
    const start = performance.now();
    let request = 0;
    const draw = (now: number) => {
      const frame = brandSceneFrame(motionTime ?? (reduced ? duration : (now - start) / 1000), duration);
      node.style.setProperty('--story-reveal', String(frame.opacity));
      node.style.setProperty('--story-travel', String(frame.travel));
      node.style.setProperty('--story-media-reveal', String(frame.mediaOpacity));
      if (motionTime === undefined && !reduced && now - start < duration * 1000) request = requestAnimationFrame(draw);
    };
    draw(start);
    return () => cancelAnimationFrame(request);
  }, [selected?.id, reduced, motionTime]);
  const stop = () => { video.current?.pause(); };
  useEffect(() => {
    if (!selected?.motionDocumentUrl || capturing) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    void fetch(selected.motionDocumentUrl, { signal: controller.signal, credentials: 'omit' }).then(async response => {
      if (!response.ok) return;
      const source = await response.text();
      if (!controller.signal.aborted && source.length <= 512000) setNotes({ id: selected.id, value: readBrandStoryNotes(source, selected.duration) });
    }).catch(() => {}).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [selected?.id, selected?.motionDocumentUrl, selected?.duration, capturing]);
  const seekChapter = (chapter: StoryChapter) => {
    const node = video.current;
    if (!node || !mediaReady || mediaFailed || covered) return;
    node.currentTime = chapter.start;
    void node.play().catch(() => setPlaying(false));
    reportSeriesClick(trackingView, 'select_chapter', selected, { chapter_index: chapters.indexOf(chapter) + 1 });
    recordBrandReview('brand_chapter', { brand: series.name, templateId: selected.id, start: chapter.start });
  };
  const choose = (item: GalleryTemplate) => { if (item.id === selected?.id) return; stop(); setSelectedId(item.id); reportSeriesClick(trackingView, 'select_work', item, { series_work_position: visible.findIndex(work => work.id === item.id) + 1 }); recordBrandReview('brand_node', { brand: series.name, templateId: item.id }); };
  const openTemplate = (item: GalleryTemplate, guide = false) => { stop(); reportSeriesClick(trackingView, 'open_detail', item); recordBrandReview('brand_template', { brand: series.name, templateId: item.id, view: 'timeline' }); onTemplate(item, guide); };
  const purposeChange = (next: string) => { stop(); setPurpose(next); reportSeriesClick(trackingView, 'filter_option', undefined, { purpose: next || 'all', selected: Boolean(next) }); recordBrandReview('brand_purpose', { brand: series.name, purpose: next }); };
  return <dialog ref={dialog} className={styles.storyDialog} aria-label={series.name + ' 品牌故事'} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onKeyDown={event => event.stopPropagation()}>
    <header className={styles.storyHeader}><button className="om-button" onClick={close}><MotionIcon name="arrow-left" size={17} />返回模板库</button><span className={styles.storyHeaderLabel}>品牌发布历程</span><button className="om-button om-icon-button" onClick={close} aria-label="关闭品牌故事" autoFocus><MotionIcon name="close" size={19} /></button></header>
    <div className={styles.storyIntro}>
      <div className={styles.brandHeading}><TemplateIdentity template={series.items[0]} brand /><h1>{series.name}</h1><span className={styles.brandMeta}>{series.items.length} 支作品{years && <> · {years}</>}</span>{series.videoInsight && <p className={styles.brandDescription}>{series.videoInsight}</p>}</div>
    </div>
    <div className={styles.purposeBar} role="group" aria-label="品牌作品用途"><button className="om-button om-filter-pill" aria-pressed={!purpose} onClick={() => purposeChange('')}>全部用途</button>{series.purposes.map(value => <button key={value} className="om-button om-filter-pill" aria-pressed={purpose === value} onClick={() => purposeChange(purpose === value ? '' : value)}>{t(value)}</button>)}</div>
    <div id="brand-timeline-panel" role="region" aria-label="发布历程" className={styles.timelinePanel}>
      <BrandFilmstrip brand={series.name} items={visible} selectedId={selected?.id} progress={progress} playing={playing} reduced={reduced} covered={covered} onSelect={choose} onBrowse={(method, direction) => reportSeriesClick(trackingView, 'browse_timeline', selected, { browse_method: method, ...(direction ? { direction } : {}) })} />
      {selected && <section className={styles.selectedStory} aria-label="当前发布作品"><div className={styles.videoColumn}><div className={styles.videoStage} style={{ '--story-media-ratio': mediaRatio } as CSSProperties} aria-busy={Boolean(selected.previewUrl && !mediaReady && !mediaFailed)}><TemplatePoster template={selected} eager />{selected.previewUrl && !mediaFailed && <video key={mediaKey} ref={video} controls autoPlay={!reduced && !covered} muted playsInline preload={covered ? "none" : reduced ? "metadata" : "auto"} src={covered ? undefined : selected.previewUrl} poster={selected.posterUrl} style={{ opacity: mediaReady ? 1 : 0 }} onLoadedMetadata={event => { const node = event.currentTarget; if (node.videoWidth > 0 && node.videoHeight > 0) setMediaAspect({ id: selected.id, ratio: node.videoWidth / node.videoHeight }); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onLoadedData={markReady} onCanPlay={markReady} onPlaying={() => { markReady(); setPlaying(true); }} onTimeUpdate={event => { const node = event.currentTarget; setProgress(Number.isFinite(node.duration) && node.duration ? node.currentTime / node.duration : 0); }} onError={() => { markFailed(); }} />}{selected.previewUrl && !mediaReady && !mediaFailed && <div className={styles.mediaStatus} role="status">正在加载原片<Skeleton style={{ width: 100, height: 4 }} /></div>}{mediaFailed && <div className={styles.mediaStatus} role="status">原片暂时无法播放<button className="om-button" onClick={() => { setMediaAttempt(value => value + 1); }}>重试播放</button></div>}</div></div>
        <div key={selected.id} className={styles.selectedCopy}><div className={styles.workHeader}><div className={styles.selectedMeta}><span>{t(discoveryPurposes(selected)[0] ?? 'Reference')}</span><span>{String(selectedIndex + 1).padStart(2, '0')} / {String(visible.length).padStart(2, '0')}</span></div><h2>{selected.title}</h2></div><div className={styles.inspectorBody}><section className={styles.workObservation} aria-label="这支作品的表达看点"><h3>表达看点</h3>{lesson ? <strong>{lesson.takeaway}</strong> : (selectedNotes?.summary || selected.description) && <p>{selectedNotes?.summary || selected.description}</p>}</section>
        {chapters.length > 0 && (selected.previewUrl || capturing) && <section className={styles.chapterCues} aria-label="片段看点"><header><h3>片段看点</h3><span>点击跳看</span></header><div>{chapters.map((chapter, index) => <button className="om-button" key={chapter.start} disabled={!mediaReady || mediaFailed || covered} aria-label={'跳看片段 ' + chapter.label} aria-current={progress * (selected.duration ?? 0) >= chapter.start && progress * (selected.duration ?? 0) < chapter.end ? 'true' : undefined} onClick={() => seekChapter(chapter)}><span>{chapters.length === 1 ? '片段' : index === 0 ? '开场' : index === chapters.length - 1 ? '收尾' : '展开'}</span><strong>{chapter.label}</strong><time>{Math.floor(chapter.start / 60).toString().padStart(2,'0')}:{Math.floor(chapter.start % 60).toString().padStart(2,'0')}</time><MotionIcon name="play" size={14} /></button>)}</div></section>}
        {(lesson?.adapt || selectedNotes?.adaptation) && <details className={styles.adaptAdvice} onToggle={event => { if (event.currentTarget.open) { reportSeriesClick(trackingView, 'expand_learning', selected, { section_id: 'adapt' }); recordBrandReview('brand_adapt_open', { brand: series.name, templateId: selected.id }); } }}><summary>用在你的产品里<MotionIcon name="chevron-down" size={14} /></summary>{lesson && <ol>{lesson.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2,'0')}</span>{step}</li>)}</ol>}<p>{lesson?.adapt || selectedNotes?.adaptation}</p></details>}
        {series.name === 'Figma' && <details className={styles.brandLearning} onToggle={event => { if (event.currentTarget.open) { reportSeriesClick(trackingView, 'expand_learning', selected, { section_id: 'habits' }); recordBrandReview('brand_learning_open', { brand: series.name }); } }}><summary>再看 Figma 的 3 个表达习惯</summary><div>{figmaLearningPaths.map(path => <section key={path.label}><h3>{path.label}</h3><p>{path.description}</p><div>{path.ids.map(id => { const item = series.items.find(work => work.id === id); return item && <button className="om-button" key={id} onClick={() => { if (purpose && !discoveryPurposes(item).includes(purpose)) setPurpose(''); choose(item); recordBrandReview('brand_learning_example', { brand: series.name, templateId: id }); }}>{item.title}<MotionIcon name="arrow-right" size={14} /></button>; })}</div></section>)}</div></details>}

        {discoveryPurposes(selected)[0] && <button className={styles.compareLink} onClick={() => { stop(); reportSeriesClick(trackingView, 'compare_brands', selected, { purpose: discoveryPurposes(selected)[0] }); recordBrandReview('brand_compare', { brand: series.name, templateId: selected.id }); onCompare(discoveryPurposes(selected)[0]); }}>比较其他品牌的「{t(discoveryPurposes(selected)[0])}」<MotionIcon name="arrow-right" size={15} /></button>}</div><BrandWorkActions key={selected.id} template={selected} trackingView={trackingView} onCopy={onCopy} onDownload={onDownload} onDetails={() => openTemplate(selected)} /></div>
      </section>}
    </div>
  </dialog>;
}
