import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { MotionIcon } from './icons';
import { templateSearchBrief, validReferenceLink } from './templateSearch';
import * as tracking from './templateLibraryTracking';
import type { ListContext } from './templateLibraryTracking';
import styles from './TemplateLibraryDialog.module.css';

type Mode = 'reference' | 'describe';
type Props = {
  query: string; context: ListContext; reason: 'no_results' | 'unsuitable' | 'catalog_empty';
  searchAction?: ReactNode; expanded: boolean; onExpand: () => void; onActivity: () => ListContext;
  showToast: (message: string, kind: 'info' | 'error') => unknown;
};

/** The library prepares a request. Only the user can send it in their own chat. */
export function TemplateSearchRecovery({ query, context, reason, searchAction, expanded, onExpand, onActivity, showToast }: Props) {
  const { t } = useI18n(), titleId = useId();
  const [mode, setMode] = useState<Mode>(), [source, setSource] = useState<'link' | 'local'>('link');
  const [reference, setReference] = useState(''), [referenceNotes, setReferenceNotes] = useState('');
  const [description, setDescription] = useState(''), [manual, setManual] = useState('');
  const [copying, setCopying] = useState(false);
  const busy = useRef(false), shown = useRef<string | undefined>(undefined), section = useRef<HTMLElement>(null);
  const start = useRef<HTMLButtonElement>(null), focusStart = useRef(false);
  useEffect(() => {
    if (!expanded || !section.current || typeof IntersectionObserver === 'undefined') return;
    const key = context.resultSetId;
    if (!key || shown.current === key) return;
    const observer = new IntersectionObserver(entries => {
      if (document.hidden || !entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0)) return;
      shown.current = key; tracking.reportRecoveryShown(reason, context); observer.disconnect();
    }, { threshold: 0.01 });
    observer.observe(section.current);
    return () => observer.disconnect();
  }, [expanded, context, reason]);
  useEffect(() => {
    if (focusStart.current && !mode) { focusStart.current = false; start.current?.focus(); }
  }, [mode]);

  function choose(next: Mode) {
    tracking.reportRecoveryAction(next, onActivity());
    if (next === 'describe' && !description) setDescription(query);
    setMode(next); setManual('');
  }
  function back() { focusStart.current = true; setMode(undefined); setManual(''); }
  const valid = mode === 'reference' ? source === 'local' || validReferenceLink(reference) : Boolean(description.trim());
  async function copy() {
    if (busy.current || !mode || !valid) return;
    busy.current = true; setCopying(true);
    const attemptId = tracking.newTrackingId();
    const actionContext = onActivity();
    const brief = templateSearchBrief({ mode, source, query, reference, description: mode === 'reference' ? referenceNotes : description }, t);
    tracking.reportRecoveryAction('copy_brief', actionContext);
    try {
      await navigator.clipboard.writeText(brief); setManual('');
      tracking.reportSearchHandoff(mode === 'reference' ? source : 'description', attemptId, 'clipboard_written', actionContext);
      showToast(t('Request copied. Paste the request in your chat and send it.'), 'info');
    } catch {
      setManual(brief);
      tracking.reportSearchHandoff(mode === 'reference' ? source : 'description', attemptId, 'manual_fallback', actionContext);
      showToast(t('Copy failed. Select and copy the instruction below.'), 'error');
    } finally { busy.current = false; setCopying(false); }
  }
  if (!expanded) return <div className={styles.recoveryTeaser}><button className="om-button" onClick={onExpand}>{t('Nothing suitable?')}</button></div>;
  const title = t(reason === 'no_results' ? 'No templates match the current conditions.' : reason === 'catalog_empty' ? 'No templates available yet.' : 'Nothing suitable?');
  return <section ref={section} className={styles.searchRecovery} data-form={mode ? 'open' : undefined} aria-label={t('Find another starting point')}>
    <div className={styles.recoveryStatus}>
      <span className={styles.recoveryMark} aria-hidden="true"><MotionIcon name="search" size={24} /></span>
      <div className={styles.recoveryStatusCopy}><h2 id={titleId}>{title}</h2>
        <p>{t(reason === 'catalog_empty' ? 'You can still make a video from a reference.' : 'Keep looking, or make the video you had in mind.')}</p></div>
      {searchAction && <div className={styles.recoverySearchAction}>{searchAction}</div>}
    </div>
    <div className={styles.recoveryBody}>
      {!mode ? <div className={styles.recoveryIntro}>
        <span aria-hidden="true" className={styles.recoveryFilm}><MotionIcon name="film" size={22} /></span>
        <div><h3>{t('Start with a reference')}</h3>
          <p>{t('Share a video in your chat. Your Agent can use it to make an editable OpenMotion project.')}</p></div>
        <button ref={start} className="om-button" data-primary onClick={() => choose('reference')}>{t('Make a video from a reference')}<MotionIcon name="arrow-right" size={16} /></button>
      </div> : <form aria-labelledby={`${titleId}-form`} className={styles.recoveryForm} onSubmit={event => { event.preventDefault(); void copy(); }}>
        <div className={styles.recoveryHeading}>
          <div><h3 id={`${titleId}-form`}>{t(mode === 'reference' ? 'Add your reference' : 'Describe your video')}</h3>
            <p>{t('Copy the request, then paste it into the chat where you use OpenMotion and send it to start.')}</p></div>
          <button type="button" className="om-button" onClick={back} disabled={copying}>{t('Back')}</button>
        </div>
        {mode === 'reference' && <>
          <div className={styles.recoveryActions} role="group" aria-label={t('Reference video')}>
            <button className="om-button om-filter-pill" type="button" aria-pressed={source === 'link'} disabled={copying} onClick={() => { setSource('link'); setManual(''); }}>{t('Video link')}</button>
            <button className="om-button om-filter-pill" type="button" aria-pressed={source === 'local'} disabled={copying} onClick={() => { setSource('local'); setManual(''); }}>{t('Local video')}</button>
          </div>
          {source === 'link' ? <label>{t('Reference video')}<input autoFocus autoComplete="off" type="url" required maxLength={2000} value={reference} disabled={copying} onChange={event => { setReference(event.target.value); setManual(''); }} placeholder="https://…" /></label>
            : <p className={styles.recoveryNote}>{t('Attach the video in your Agent before sending.')}</p>}
        </>}
        <label key={mode}>{t(mode === 'describe' ? 'What video do you want to make?' : 'What would you like to keep or change? (optional)')}
          <textarea autoFocus={mode === 'describe'} maxLength={1000} required={mode === 'describe'} rows={3}
            value={mode === 'describe' ? description : referenceNotes} disabled={copying} onChange={event => {
              const update = mode === 'describe' ? setDescription : setReferenceNotes;
              update(event.target.value); setManual('');
            }} /></label>
        {manual && <label>{t('Creation instruction')}<textarea className={styles.manualCopy} readOnly value={manual} rows={5} onFocus={event => event.target.select()} /></label>}
        <div className={styles.recoveryFooter}>
          <div className={styles.recoveryActions}>
            <button className="om-button" data-primary disabled={copying || !valid}><MotionIcon name="copy" size={16} />{t('Copy request')}</button>
            <button type="button" className={`om-button ${styles.recoveryTextButton}`} disabled={copying} onClick={() => choose(mode === 'reference' ? 'describe' : 'reference')}>
              {t(mode === 'reference' ? 'Describe your video' : 'Add your reference')}</button>
          </div>
          <p className={styles.recoveryNote}><a href="?page=mcp" target="_blank" rel="noopener noreferrer">{t('Connect an Agent')}<MotionIcon name="arrow-up-right" size={14} /></a></p>
        </div>
      </form>}
    </div>
  </section>;
}
