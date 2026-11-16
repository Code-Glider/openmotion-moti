import { useEffect, useState } from 'react';
import type { GenerationLimit } from '../../../shared/gateway';
import { useI18n } from '../i18n/I18n';
import { gatewayRequest } from './gatewayClient';

export function GenerationLimitSettings({ showToast }: { showToast: (message: string, kind: 'info' | 'error') => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<GenerationLimit>(), [value, setValue] = useState('30'), [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true; setFailed(false);
    void gatewayRequest<GenerationLimit>('settings/generation-limit').then(data => {
      if (!Number.isInteger(data.limit) || !Number.isInteger(data.used)) throw new Error('Invalid generation limit');
      if (current) { setSettings(data); setValue(String(data.limit)); }
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [retry]);
  const valid = value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 500;
  return <form className="om-card om-card-stack" aria-label={t('Generation limit')} onSubmit={event => {
    event.preventDefault(); if (!valid || busy || !settings && !failed) return; setBusy(true);
    void gatewayRequest<GenerationLimit>('settings/generation-limit', 'PUT', { limit: Number(value) }).then(data => {
      setSettings(data); setValue(String(data.limit)); setFailed(false); showToast(t('Generation limit saved'), 'info');
    }).catch(error => showToast(t(error instanceof Error ? error.message : 'Could not save settings'), 'error')).finally(() => setBusy(false));
  }}>
    <h2 className="om-subtitle">{t('Generation limit')}</h2>
    {failed ? <><p className="om-muted" role="alert">{t('Could not load generation limit. Save a limit to repair the setting.')}</p><button className="om-button" type="button" onClick={() => setRetry(n => n + 1)}>{t('Retry')}</button></> : null}
    {!settings && !failed ? <p className="om-muted" role="status">{t('Loading settings…')}</p> : <>
        <label className="om-label">{t('New submissions per 24 hours')}<span className="om-field"><input type="number" min={0} max={500} step={1} required aria-label={t('New submissions per 24 hours')} value={value} disabled={busy} onChange={event => setValue(event.target.value)} /></span></label>
        {settings && <p className="om-muted">{t('{used} submissions in the last 24 hours', { used: settings.used })}</p>}
        <p className="om-muted">{t('Failed and cancelled jobs count across this workspace.')}</p>
        <p className="om-muted">{t('0 disables the limit; maximum 500. This is not a spending limit.')}</p>
        <button className="om-button" type="submit" disabled={!valid || busy || !failed && Number(value) === settings?.limit}>{t(busy ? 'Saving…' : 'Save limit')}</button>
      </>}
  </form>;
}
