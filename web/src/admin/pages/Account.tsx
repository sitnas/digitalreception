import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { errorText, useI18n } from '../i18n';
import { ErrorBox, PageHead, useAsync } from '../ui';

interface MfaStatus { enabled: boolean; enabledAt: string | null; required: boolean; recoveryCodesLeft: number }
interface Setup { secret: string; otpauthUrl: string; qrSvg: string }

/** Enrolment: QR code (or the key typed by hand), then a first code; returns the recovery codes. */
export function MfaEnroll({ onEnabled, onCancel }: { onEnabled: (codes: string[]) => void; onCancel?: () => void }) {
  const { t } = useI18n();
  // Each call replaces the pending secret, so it runs once per enrolment (also under React StrictMode).
  const [setup, setSetup] = useState<{ data: Setup | null; error: unknown }>({ data: null, error: null });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.post<Setup>('/auth/mfa/setup').then((data) => setSetup({ data, error: null }), (error) => setSetup({ data: null, error }));
  }, []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onEnabled((await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code })).recoveryCodes); }
    catch (err) { setError(errorText(t, err)); setCode(''); }
    finally { setBusy(false); }
  };

  return (
    <form className="stack mfa-enroll" onSubmit={confirm}>
      <ErrorBox error={setup.error} />
      <ol className="mfa-steps">
        <li>{t.mfa.step1}</li>
        <li>
          {t.mfa.step2}
          {setup.data && (
            <div className="mfa-qr-row">
              <img className="mfa-qr" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.data.qrSvg)}`} alt="QR" width={176} height={176} />
              <code className="secret mfa-secret">{setup.data.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </div>
          )}
        </li>
        <li>
          {t.mfa.step3}
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="mfa-code" className="sr-only">{t.mfa.code}</label>
            <input id="mfa-code" className="input mfa-code-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
              placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </div>
        </li>
      </ol>
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="inline">
        <button className="btn btn-primary" disabled={busy || !setup.data || code.length !== 6}>{t.mfa.confirm}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{t.mfa.cancel}</button>}
      </div>
    </form>
  );
}

/** Shown once after enabling or regenerating: copy, download, then confirm. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* text stays selectable */ } };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${t.mfa.recoveryTitle} (${location.host})\n\n${text}\n`], { type: 'text/plain' }));
    a.download = `recovery-codes-${location.hostname}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>{t.mfa.recoveryTitle}</h2>
      <p className="muted" style={{ margin: 0 }}>{t.mfa.recoveryIntro}</p>
      <ul className="recovery-codes" aria-label={t.mfa.recoveryTitle}>{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="inline">
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? t.mfa.copied : t.mfa.copy}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={download}>{t.mfa.download}</button>
      </div>
      <button type="button" className="btn btn-primary" onClick={onDone}>{t.mfa.saved}</button>
    </div>
  );
}

export function AccountPage() {
  const { t, intl } = useI18n();
  const status = useAsync(() => api.get<MfaStatus>('/auth/mfa'), []);
  const [mode, setMode] = useState<'idle' | 'enroll' | 'disable' | 'regenerate'>('idle');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [f, setF] = useState({ password: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const s = status.data;

  const reset = () => { setMode('idle'); setF({ password: '', code: '' }); setError(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === 'disable') { await api.post('/auth/mfa/disable', f); setNotice(t.mfa.disabled); }
      else setCodes((await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code: f.code })).recoveryCodes);
      reset(); status.reload();
    } catch (err) { setError(errorText(t, err)); setF((x) => ({ ...x, code: '' })); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title={t.mfa.title} intro={t.mfa.intro} />
      <ErrorBox error={status.error} />
      {notice && <p className="alert alert-info" role="status">{notice}</p>}
      {s && (
        <section className="a-card stack" style={{ maxWidth: 640 }}>
          <div className="access-row">
            <div>
              <strong>{t.mfa.section}</strong>
              <p className="muted" style={{ margin: 0 }}>{s.enabled && s.enabledAt ? t.mfa.statusOn.replace('{date}', fmtDateTime(s.enabledAt, intl)) : t.mfa.statusOff}</p>
            </div>
            <span className={s.enabled ? 'pill OPEN' : 'pill'}>{s.enabled ? t.mfa.on : t.mfa.off}</span>
          </div>
          {s.required && <p className="hint" style={{ margin: 0 }}>{t.mfa.required}</p>}

          {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} /> :
            !s.enabled ? (
              mode === 'enroll'
                ? <MfaEnroll onEnabled={(c) => { setCodes(c); reset(); status.reload(); }} onCancel={reset} />
                : <div><button type="button" className="btn btn-primary" onClick={() => setMode('enroll')}>{t.mfa.enable}</button></div>
            ) : mode === 'idle' ? (
              <>
                <p style={{ margin: 0 }}>{t.mfa.recoveryLeft.replace('{n}', String(s.recoveryCodesLeft))}</p>
                {s.recoveryCodesLeft <= 3 && <p className="alert" role="status" style={{ margin: 0 }}>{t.mfa.recoveryLow}</p>}
                <div className="access-row">
                  <div><strong>{t.mfa.regenerate}</strong><p className="muted">{t.mfa.regenerateHelp}</p></div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('regenerate')}>{t.mfa.regenerate}</button>
                </div>
                {!s.required && (
                  <div className="access-row">
                    <div><strong>{t.mfa.disable}</strong><p className="muted">{t.mfa.disableHelp}</p></div>
                    <button type="button" className="btn btn-ghost btn-sm is-danger" onClick={() => setMode('disable')}>{t.mfa.disable}</button>
                  </div>
                )}
              </>
            ) : (
              <form className="stack" onSubmit={submit}>
                <strong>{mode === 'disable' ? t.mfa.disable : t.mfa.regenerate}</strong>
                {mode === 'disable' && (
                  <div className="field"><label htmlFor="mp">{t.mfa.password}</label><input id="mp" className="input" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
                )}
                <div className="field">
                  <label htmlFor="mc">{mode === 'disable' ? t.mfa.codeOrRecovery : t.mfa.code}</label>
                  <input id="mc" className="input mfa-code-input" autoComplete="one-time-code" inputMode={mode === 'disable' ? 'text' : 'numeric'} maxLength={mode === 'disable' ? 11 : 6}
                    value={f.code} onChange={(e) => setF({ ...f, code: mode === 'disable' ? e.target.value : e.target.value.replace(/\D/g, '') })} required />
                </div>
                {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
                <div className="inline">
                  <button className={mode === 'disable' ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy}>{mode === 'disable' ? t.mfa.disable : t.mfa.confirm}</button>
                  <button type="button" className="btn btn-ghost" onClick={reset}>{t.mfa.cancel}</button>
                </div>
              </form>
            )}
        </section>
      )}
    </>
  );
}
