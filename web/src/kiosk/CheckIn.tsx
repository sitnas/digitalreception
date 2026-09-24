import { useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { PhotoCapture, SignaturePad, Steps } from './parts';
import type { Locale, Strings } from './strings';
import type { KioskConfig, KioskHost } from './types';

const PURPOSES = ['MEETING', 'INTERVIEW', 'SUPPLIER', 'MAINTENANCE', 'DELIVERY', 'OTHER'] as const;
const DOC_TYPES = ['ID_CARD', 'PASSPORT', 'DRIVING_LICENSE', 'OTHER'] as const;
const DISTANCES = ['UNDER_10_KM', 'FROM_10_TO_100_KM', 'OVER_100_KM'] as const;
const NAME = /^[\p{L}\p{M}' .-]+$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type StepKey = 'details' | 'notice' | 'photos' | 'sign';

export interface CheckInResult { code: string; label: string; emailQueued: boolean; badgeEmailQueued: boolean }

interface Props { cfg: KioskConfig; locale: Locale; t: Strings; onDone: (r: CheckInResult) => void; onCancel: () => void; onReloadConfig: () => Promise<void> }

export function CheckIn({ cfg, locale, t, onDone, onCancel, onReloadConfig }: Props) {
  const { policy } = cfg;
  const hasDirectory = cfg.hosts.length > 0;
  // The document photo is taken together with the document data; the photos step is only for the laptop serial.
  const steps = useMemo<StepKey[]>(() => ['details', 'notice', ...(policy.assetPhotosRequired ? ['photos' as const] : []), 'sign'], [policy]);
  const labels = steps.map((s) => t.steps[['details', 'notice', 'photos', 'sign'].indexOf(s)]);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ firstName: '', lastName: '', company: '', email: '', host: '', hostId: '', purpose: '', travelDistance: '', documentType: '', documentNumber: '' });
  const [touched, setTouched] = useState(false);
  const [noticeRead, setNoticeRead] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [docPhoto, setDocPhoto] = useState<string | null>(null);
  const [assetPhoto, setAssetPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = cfg.notices[locale]!;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const errors = useMemo(() => {
    const e: Partial<Record<keyof typeof f, string>> = {};
    for (const k of ['firstName', 'lastName'] as const) {
      if (!f[k].trim()) e[k] = t.required; else if (!NAME.test(f[k].trim())) e[k] = t.invalidName;
    }
    if (f.email.trim() && !EMAIL.test(f.email.trim())) e.email = t.invalidEmail;
    if (hasDirectory ? !f.hostId : !f.host.trim()) e.host = t.required;
    if (!f.purpose) e.purpose = t.required;
    if (!f.travelDistance) e.travelDistance = t.required;
    if (policy.documentDataEnabled) {
      if (!f.documentType) e.documentType = t.required;
      if (f.documentNumber.trim().length < 3) e.documentNumber = t.required;
    }
    return e;
  }, [f, t, policy.documentDataEnabled, hasDirectory]);
  const docPhotoMissing = policy.documentPhotoEnabled && !docPhoto;

  const key = steps[step];
  const canNext =
    key === 'details' ? Object.keys(errors).length === 0 && !docPhotoMissing :
    key === 'notice' ? noticeRead :
    key === 'photos' ? !policy.assetPhotosRequired || !!assetPhoto :
    !!signature;

  const next = async () => {
    if (key === 'details' && (Object.keys(errors).length || docPhotoMissing)) { setTouched(true); return; }
    if (step < steps.length - 1) { setError(null); setStep(step + 1); window.scrollTo(0, 0); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.kiosk.post<{ code: string; emailQueued: boolean; badgeEmailQueued: boolean }>('/visits', {
        locale, firstName: f.firstName, lastName: f.lastName, company: f.company || undefined, email: f.email.trim() || undefined,
        sendNoticeEmail: sendEmail && !!f.email.trim(),
        ...(hasDirectory ? { hostId: f.hostId } : { host: f.host }),
        purpose: f.purpose, travelDistance: f.travelDistance,
        documentType: policy.documentDataEnabled ? f.documentType : undefined,
        documentNumber: policy.documentDataEnabled ? f.documentNumber : undefined,
        privacyNoticeId: notice.id, privacyAccepted: true, signature,
        documentPhoto: policy.documentPhotoEnabled ? docPhoto : undefined,
        assetPhoto: policy.assetPhotosRequired ? assetPhoto : undefined,
      });
      onDone({ code: res.code, label: `${f.firstName.trim()} ${f.lastName.trim().charAt(0)}.`, emailQueued: res.emailQueued, badgeEmailQueued: res.badgeEmailQueued });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NOTICE_OUTDATED') {
        await onReloadConfig();
        setNoticeRead(false); setScrolledToEnd(false); setSignature(null);
        setStep(steps.indexOf('notice'));
        setError(t.errors.NOTICE_OUTDATED);
      } else if (e instanceof ApiError && (e.code === 'HOST_NOT_FOUND' || e.code === 'HOST_REQUIRED')) {
        // The directory changed while the visitor was typing: reload it and ask to pick again.
        await onReloadConfig();
        setF((cur) => ({ ...cur, hostId: '' })); setSignature(null); setStep(0);
        setError(t.errors.generic);
      } else setError(e instanceof ApiError ? t.errors.generic : t.errors.offline);
    } finally { setBusy(false); }
  };

  const err = (k: keyof typeof f) => (touched && errors[k] ? <span className="error" role="alert">{errors[k]}</span> : null);
  const inv = (k: keyof typeof f) => (touched && errors[k] ? true : undefined);

  return (
    <div>
      <Steps labels={labels} current={step} />
      {error && <p className="alert" role="alert">{error}</p>}

      {key === 'details' && (
        <form className="k-form" onSubmit={(e) => { e.preventDefault(); next(); }} noValidate autoComplete="off">
          <div className="k-row">
            <div className="field"><label htmlFor="fn">{t.firstName}</label><input id="fn" className="input" value={f.firstName} onChange={set('firstName')} maxLength={80} aria-invalid={inv('firstName')} autoCapitalize="words" />{err('firstName')}</div>
            <div className="field"><label htmlFor="ln">{t.lastName}</label><input id="ln" className="input" value={f.lastName} onChange={set('lastName')} maxLength={80} aria-invalid={inv('lastName')} autoCapitalize="words" />{err('lastName')}</div>
          </div>
          <div className="k-row">
            <div className="field"><label htmlFor="co">{t.company}</label><input id="co" className="input" value={f.company} onChange={set('company')} maxLength={120} /><span className="hint">{t.companyHint}</span></div>
            {!hasDirectory && <div className="field"><label htmlFor="ho">{t.host}</label><input id="ho" className="input" value={f.host} onChange={set('host')} maxLength={120} aria-invalid={inv('host')} /><span className="hint">{t.hostHint}</span>{err('host')}</div>}
          </div>
          {hasDirectory && (
            <div className="field">
              <HostPicker hosts={cfg.hosts} value={f.hostId} onChange={(hostId) => setF({ ...f, hostId })} invalid={inv('host')} t={t} />
              {err('host')}
            </div>
          )}
          <div className="field">
            <span className="label" id="purpose-l">{t.purpose}</span>
            <div className="k-chips" role="group" aria-labelledby="purpose-l">
              {PURPOSES.map((p) => <button type="button" key={p} className="k-chip" aria-pressed={f.purpose === p} onClick={() => setF({ ...f, purpose: p })}>{t.purposes[p]}</button>)}
            </div>
            {err('purpose')}
          </div>
          <div className="field">
            <span className="label" id="dist-l">{t.distance}</span>
            <div className="k-chips" role="group" aria-labelledby="dist-l">
              {DISTANCES.map((d) => <button type="button" key={d} className="k-chip" aria-pressed={f.travelDistance === d} onClick={() => setF({ ...f, travelDistance: d })}>{t.distances[d]}</button>)}
            </div>
            {err('travelDistance')}
          </div>
          {policy.documentDataEnabled && (
            <>
              <div className="field">
                <span className="label" id="doc-l">{t.documentType}</span>
                <div className="k-chips" role="group" aria-labelledby="doc-l">
                  {DOC_TYPES.map((d) => <button type="button" key={d} className="k-chip" aria-pressed={f.documentType === d} onClick={() => setF({ ...f, documentType: d })}>{t.documentTypes[d]}</button>)}
                </div>
                {err('documentType')}
              </div>
              <div className="field"><label htmlFor="dn">{t.documentNumber}</label><input id="dn" className="input" value={f.documentNumber} onChange={set('documentNumber')} maxLength={40} aria-invalid={inv('documentNumber')} autoCapitalize="characters" />{err('documentNumber')}</div>
            </>
          )}
          {policy.documentPhotoEnabled && (
            <div className="field">
              <PhotoCapture title={t.photoDocTitle} hint={t.photoDocHint} value={docPhoto} onChange={setDocPhoto} t={t} />
              {touched && docPhotoMissing && <span className="error" role="alert">{t.required}</span>}
            </div>
          )}
          <div className="field"><label htmlFor="em">{t.email}</label><input id="em" className="input" type="email" inputMode="email" value={f.email} onChange={set('email')} maxLength={190} aria-invalid={inv('email')} autoCapitalize="none" /><span className="hint">{t.emailHint}</span>{err('email')}</div>
          <button type="submit" hidden />
        </form>
      )}

      {key === 'notice' && (
        <div className="stack">
          <div className="k-notice" tabIndex={0} onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setScrolledToEnd(true); }}
            ref={(el) => { if (el && el.scrollHeight <= el.clientHeight + 12 && !scrolledToEnd) setScrolledToEnd(true); }}>
            <h3>{notice.title}</h3>
            {notice.body.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
            <p className="muted" style={{ fontSize: 14 }}>v{notice.version}</p>
          </div>
          {!scrolledToEnd && <p className="muted" style={{ margin: 0 }}>{t.noticeScroll}</p>}
          <label className="k-check" aria-disabled={!scrolledToEnd}>
            <input type="checkbox" checked={noticeRead} disabled={!scrolledToEnd} onChange={(e) => setNoticeRead(e.target.checked)} />{t.noticeRead}
          </label>
          {cfg.emailAvailable && f.email.trim() && (
            <label className="k-check"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />{t.sendNotice}</label>
          )}
        </div>
      )}

      {key === 'photos' && (
        <div className="stack">
          {policy.assetPhotosRequired && <PhotoCapture title={t.photoAssetTitle} hint={t.photoAssetHint} value={assetPhoto} onChange={setAssetPhoto} t={t} />}
        </div>
      )}

      {key === 'sign' && (
        <div className="stack">
          <div><h2 className="k-h2">{t.signTitle}</h2><p className="muted" style={{ margin: 0 }}>{t.signHint}</p></div>
          <SignaturePad onChange={setSignature} clearLabel={t.clear} />
        </div>
      )}

      <div className="k-actions">
        <button type="button" className="btn btn-ghost" onClick={() => (step === 0 ? onCancel() : setStep(step - 1))} disabled={busy}>{step === 0 ? t.cancel : t.back}</button>
        <button type="button" className="btn btn-primary" onClick={next} disabled={busy || (key !== 'details' && !canNext)}>
          {busy ? t.sending : step === steps.length - 1 ? t.confirmCheckIn : t.next}
        </button>
      </div>
    </div>
  );
}

/** Drop-down of the people who can be visited at this site: name, department and role only. */
function HostPicker({ hosts, value, onChange, invalid, t }: { hosts: KioskHost[]; value: string; onChange: (id: string) => void; invalid?: boolean; t: Strings }) {
  const label = (h: KioskHost) => {
    const profile = [h.department, h.jobTitle].filter(Boolean).join(' · ');
    return profile ? `${h.firstName} ${h.lastName} — ${profile}` : `${h.firstName} ${h.lastName}`;
  };
  return (
    <>
      <label htmlFor="host">{t.host}</label>
      <select id="host" className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid}>
        <option value="" disabled>{t.hostPlaceholder}</option>
        {hosts.map((h) => <option key={h.id} value={h.id}>{label(h)}</option>)}
      </select>
      <span className="hint">{t.hostPickHint}</span>
    </>
  );
}
