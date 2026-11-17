import { useEffect, useRef, useState } from 'react';
import type { TranscriptDocument } from '../../../shared/transcript';
import { transcriptWorkflowPrompt } from '../../../shared/transcript-workflow';
import { useI18n } from '../i18n/I18n';
import { useStudioShellContext } from '../contexts/StudioContext';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { useIntegrationInfo } from './useIntegrationInfo';
import { SettingsError, SettingsLoading } from './settingsPrimitives';

export function TranscriptWorkflowBrief({ projectId, sourcePaths, transcript }: { projectId: string; sourcePaths: string[]; transcript: TranscriptDocument | null }) {
  const { t, locale } = useI18n(), shell = useStudioShellContext();
  const { info, failed, retry } = useIntegrationInfo();
  const [links, setLinks] = useState(''), [targets, setTargets] = useState('YouTube Shorts, Instagram Reels'), [languages, setLanguages] = useState(''), [notes, setNotes] = useState('');
  const [goal, setGoal] = useState<'highlights' | 'adapt'>('highlights'), [busy, setBusy] = useState(false), [manual, setManual] = useState('');
  const alive = useRef(true), lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => setManual(''), [links, targets, languages, notes, goal, transcript]);
  const field = (label: string, value: string, change: (v: string) => void, rows = 2) => <label className="flex flex-col gap-1 text-step-11 text-text-3">{t(label)}<textarea className="om-field w-full resize-y text-step-12" aria-label={t(label)} disabled={busy} value={value} rows={rows} maxLength={3000} onChange={event => change(event.target.value)} /></label>;
  async function copy() {
    if (!info || lock.current) return; lock.current = true; setBusy(true);
    try {
      await shell.waitForPendingDomEditSaves(); if (!alive.current) return;
      const prompt = transcriptWorkflowPrompt({ projectId, sourcePaths, sourceLinks: links, targets, languages, goal, notes, transcript }, info, locale);
      try { await navigator.clipboard.writeText(prompt); if (alive.current) shell.showToast(t('Copied. Paste into your Agent.'), 'info'); }
      catch { if (alive.current) { setManual(prompt); shell.showToast(t('Could not copy. Select and copy the text manually.'), 'error'); } }
    } catch (error) { if (alive.current) shell.showToast(error instanceof Error ? error.message : t('Could not save the project'), 'error'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="om-card flex flex-col gap-3" data-testid="transcript-workflow">
    <p className="text-step-12">{t('Create another version')}</p>
    <p className="text-step-11 text-text-3">{t('Your Agent retrieves source links, reviews speech and pictures, creates editable versions and exports files. Link retrieval requires a capable host. Uploading to platforms is separate.')}</p>
    {field('Source links or search brief', links, setLinks, 3)}
    <Select label={t('Version goal')} value={goal} options={[{ value: 'highlights', label: t('Extract highlights') }, { value: 'adapt', label: t('Adapt the full video') }]} onCommit={value => setGoal(value as typeof goal)} disabled={busy} />
    {field('Target platforms', targets, setTargets)}
    {field('Subtitle languages (optional)', languages, setLanguages)}
    {field('Editorial requirements', notes, setNotes)}
    <p className="text-step-11 text-text-3">{t('Subtitle translation preserves the original voice. Dubbing is a separate request.')}</p>
    {failed ? <SettingsError retry={retry} /> : !info ? <SettingsLoading /> : null}
    <Button size="sm" variant="primary" className="h-auto min-h-ctl-sm max-w-full whitespace-normal py-1" disabled={!info || busy || Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering} onClick={() => void copy()}>{t('Copy production brief')}</Button>
    {manual && <textarea className="om-field w-full resize-y text-step-11" aria-label={t('Complete workflow instruction')} readOnly rows={8} value={manual} onFocus={event => event.currentTarget.select()} />}
  </div>;
}
