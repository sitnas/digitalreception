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
  const codeInput = useRef<HTMLInputElement>(null);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onEnabled((await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code })).recoveryCodes); }
    catch (err) { setError(errorText(t, err)); setCode(''); codeInput.current?.focus(); }
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
              <img className="mfa-qr" src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.data.qrSvg)}`} alt={t.mfa.qrAlt} width={176} height={176} />
              <code translate="no" className="secret mfa-secret">{setup.data.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </div>
          )}
        </li>
        <li>
          <label htmlFor="mfa-code">{t.mfa.step3}</label>
          <input ref={codeInput} id="mfa-code" name="code" className="input mfa-code-input" style={{ marginTop: 8 }} inputMode="numeric" autoComplete="one-time-code"
            pattern="\d{6}" title={t.mfa.codeHint} maxLength={6} placeholder="123456" aria-invalid={!!error} aria-describedby={error ? 'mfa-code-err' : undefined}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
        </li>
      </ol>
      {error && <p id="mfa-code-err" className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="inline">
        <button className="btn btn-primary" disabled={busy || !setup.data} aria-busy={busy}>{t.mfa.confirm}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{t.mfa.cancel}</button>}
      </div>
    </form>
  );
}

/** Shown once after enabling or regenerating: copy, download, then confirm. Focus moves to the heading. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const text = codes.join('\n');
  const doCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopy('done'); setTimeout(() => setCopy('idle'), 1500); } catch { setCopy('failed'); }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${t.mfa.recoveryTitle} (${location.host})\n\n${text}\n`], { type: 'text/plain' }));
    a.download = `recovery-codes-${location.hostname}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="stack">
      <h2 ref={heading} tabIndex={-1} style={{ margin: 0 }}>{t.mfa.recoveryTitle}</h2>
      <p className="muted" style={{ margin: 0 }}>{t.mfa.recoveryIntro}</p>
      <ul className="recovery-codes" aria-label={t.mfa.recoveryTitle} translate="no">{codes.map((c) => <li key={c}><code translate="no">{c}</code></li>)}</ul>
      <div className="inline">
        <button type="button" className="btn btn-ghost btn-sm" onClick={doCopy}>{copy === 'done' ? t.mfa.copied : t.mfa.copy}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={download}>{t.mfa.download}</button>
      </div>
      <p className="hint" role="status" aria-live="polite" style={{ margin: 0 }}>{copy === 'failed' ? t.mfa.copyFailed : ''}</p>
      <button type="button" className="btn btn-primary" onClick={onDone}>{t.mfa.saved}</button>
    </div>
  );
}

type Mode = 'idle' | 'enroll' | 'disable' | 'regenerate';

export function AccountPage() {
  const { t, intl } = useI18n();
  const status = useAsync(() => api.get<MfaStatus>('/auth/mfa'), []);
  const [mode, setMode] = useState<Mode>('idle');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [f, setF] = useState({ password: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement | null>(null);
  const codeField = useRef<HTMLInputElement | null>(null);
  const s = status.data;
  const disabling = mode === 'disable';

  // Keyboard and screen-reader users land on the first field of the form that just opened.
  useEffect(() => { if (mode === 'disable' || mode === 'regenerate') firstField.current?.focus(); }, [mode]);

  const reset = () => { setMode('idle'); setF({ password: '', code: '' }); setError(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      if (disabling) { await api.post('/auth/mfa/disable', f); setNotice(t.mfa.disabled); }
      else setCodes((await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code: f.code })).recoveryCodes);
      reset(); status.reload();
    } catch (err) { setError(errorText(t, err)); setF((x) => ({ ...x, code: '' })); codeField.current?.focus(); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title={t.mfa.title} intro={t.mfa.intro} />
      <ErrorBox error={status.error} />
      <div role="status" aria-live="polite">{notice && <p className="alert alert-info">{notice}</p>}</div>
      {s && (
        <section className="a-card stack" style={{ maxWidth: 640 }} aria-labelledby="mfa-section">
          <div className="access-row">
            <div>
              <h2 id="mfa-section" className="a-card-title">{t.mfa.section}</h2>
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
                {s.recoveryCodesLeft <= 3 && <p className="alert" style={{ margin: 0 }}>{t.mfa.recoveryLow}</p>}
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
                <strong>{disabling ? t.mfa.disable : t.mfa.regenerate}</strong>
                {disabling && (
                  <div className="field">
                    <label htmlFor="mp">{t.mfa.password}</label>
                    <input ref={firstField} id="mp" name="password" className="input" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="mc">{disabling ? t.mfa.codeOrRecovery : t.mfa.code}</label>
                  <input ref={(el) => { codeField.current = el; if (!disabling) firstField.current = el; }} id="mc" name="code" className="input mfa-code-input"
                    autoComplete="one-time-code" spellCheck={false} translate="no"
                    {...(disabling
                      ? { inputMode: 'text' as const, autoCapitalize: 'characters', maxLength: 11 }
                      : { inputMode: 'numeric' as const, pattern: '\\d{6}', title: t.mfa.codeHint, maxLength: 6 })}
                    aria-invalid={!!error} aria-describedby={error ? 'mc-err' : undefined}
                    value={f.code} onChange={(e) => setF({ ...f, code: disabling ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '') })} required />
                </div>
                {error && <p id="mc-err" className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
                <div className="inline">
                  <button className={disabling ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy} aria-busy={busy}>{disabling ? t.mfa.disable : t.mfa.confirm}</button>
                  <button type="button" className="btn btn-ghost" onClick={reset}>{t.mfa.cancel}</button>
                </div>
              </form>
            )}
        </section>
      )}
    </>
  );
}
