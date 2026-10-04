import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTimeFormat } from '../lib/format';
import { applyBrand } from '../lib/theme';
import { PhotoCapture, SignaturePad, Steps } from '../kiosk/parts';
import { LOCALE_NAMES, STRINGS, type Locale } from '../kiosk/strings';
import type { GuestDocument, Notice } from '../kiosk/types';

const DOC_TYPES = ['ID_CARD', 'PASSPORT', 'DRIVING_LICENSE', 'OTHER'] as const;
const DISTANCES = ['UNDER_10_KM', 'FROM_10_TO_100_KM', 'OVER_100_KM'] as const;
const NAME = /^[\p{L}\p{M}' .-]+$/u;

interface Invitation {
  organisation: { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null };
  site: { name: string; timezone: string };
  expectedAt: string; host: string | null; purpose: string; locale: Locale;
  guest: { firstName: string; lastName: string; company: string | null; travelDistance: string | null };
  policy: { locales: Locale[]; defaultLocale: Locale; documentDataEnabled: boolean; documentPhotoEnabled: boolean; assetPhotosRequired: boolean };
  notices: Partial<Record<Locale, Notice>>;
  documents: Partial<Record<Locale, GuestDocument[]>>;
  preregisteredAt: string | null;
}

type StepKey = 'details' | 'notice' | 'docs' | 'sign';
const STEP_LABEL: Record<StepKey, number> = { details: 0, notice: 1, sign: 3, docs: 4 };

/** The code comes in the URL fragment (/guest#CODE): it never reaches server logs or other sites. */
const codeFromUrl = () => decodeURIComponent(window.location.hash.slice(1)).toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Pre-registration from the guest's phone, opened from the invitation email. Same questions as
 * the reception tablet (minus the person to meet, already known), then the tablet only confirms.
 */
export function GuestApp() {
  const [code] = useState(codeFromUrl);
  const [inv, setInv] = useState<Invitation | null>(null);
  // The phone's language when the organisation offers it, otherwise the language of the invitation.
  const [phoneLocale] = useState(() => navigator.language.slice(0, 2) as Locale);
  const [locale, setLocale] = useState<Locale>(() => (phoneLocale in STRINGS ? phoneLocale : 'it'));
  const first = useRef(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [session, setSession] = useState(0);
  const t = STRINGS[locale];

  const load = useCallback(async () => {
    try {
      const r = await api.post<Invitation>('/guest/invitation/open', { code });
      applyBrand(r.organisation); setInv(r); setFatal(null);
      if (!first.current) { first.current = true; setLocale(r.policy.locales.includes(phoneLocale) ? phoneLocale : r.locale); }
      return r;
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      setFatal(c === 'INVITATION_EXPIRED' ? 'guestExpired' : c === 'INVITATION_USED' ? 'guestUsed' : e instanceof ApiError && e.status === 404 ? 'guestNotFound' : 'offline');
      return null;
    }
  }, [code, phoneLocale]);

  useEffect(() => { if (code.length === 8) load(); }, [code, load]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const message = (k: string) => (k === 'offline' ? t.errors.offline : t[k as 'guestExpired' | 'guestUsed' | 'guestNotFound']);
  const shell = (body: React.ReactNode) => (
    <div className="kiosk guest" lang={locale}>
      <header className="k-top">
        <span className="k-site">
          {inv?.organisation.logo ? <img src={inv.organisation.logo} alt={inv.organisation.name} className="k-logo" /> : inv && <span className="k-org">{inv.organisation.name}</span>}
          {inv && <span className="k-place">{inv.site.name}</span>}
        </span>
        {inv && inv.policy.locales.length > 1 && (
          <nav className="k-langs" aria-label="Language">
            {inv.policy.locales.map((l) => <button key={l} type="button" className="k-lang" aria-pressed={l === locale} onClick={() => setLocale(l)} lang={l}>{LOCALE_NAMES[l]}</button>)}
          </nav>
        )}
      </header>
      <main className="k-main">{body}</main>
      <footer className="k-foot">{t.privacyFooter}</footer>
    </div>
  );

  if (code.length !== 8) return shell(<p className="alert" role="alert">{t.guestNoCode}</p>);
  if (fatal) return shell(<p className="alert" role="alert">{message(fatal)}</p>);
  if (!inv) return shell(<p className="muted">…</p>);

  const when = dateTimeFormat(locale === 'en' ? 'en-GB' : locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: inv.site.timezone }).format(new Date(inv.expectedAt));

  if (done || (inv.preregisteredAt && !editing)) {
    return shell(
      <div className="k-done guest-done" role="status">
        <h1 className="k-h2">{done ? t.guestDoneTitle : t.guestTitle}</h1>
        {!done && <p style={{ margin: 0 }}>{t.guestAlready}</p>}
        <p style={{ margin: 0 }}>{t.guestWhen.replace('{when}', when).replace('{site}', inv.site.name)}{inv.host && ` ${t.guestHost.replace('{host}', inv.host)}`}</p>
        <p style={{ margin: 0 }}>{t.guestDoneText}</p>
        <button type="button" className="btn btn-ghost" onClick={() => { setDone(false); setEditing(true); setSession((s) => s + 1); }}>{t.guestEdit}</button>
      </div>,
    );
  }

  return shell(
    <>
      <h1 className="k-h2" style={{ marginBottom: 6 }}>{t.guestTitle}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {t.guestWhen.replace('{when}', when).replace('{site}', inv.site.name)}{inv.host && ` ${t.guestHost.replace('{host}', inv.host)}`} {t.guestHint}
      </p>
      <GuestForm key={session} inv={inv} code={code} locale={locale} onReload={load} onDone={() => { setDone(true); setEditing(false); load(); }} />
    </>,
  );
}

function GuestForm({ inv, code, locale, onReload, onDone }: { inv: Invitation; code: string; locale: Locale; onReload: () => Promise<Invitation | null>; onDone: () => void }) {
  const t = STRINGS[locale];
  const { policy } = inv;
  const notice = inv.notices[locale];
  const documents = useMemo(() => inv.documents[locale] ?? [], [inv.documents, locale]);
  const steps = useMemo<StepKey[]>(() => ['details', 'notice', ...(documents.length ? ['docs' as const] : []), 'sign'], [documents.length]);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    firstName: inv.guest.firstName, lastName: inv.guest.lastName, company: inv.guest.company ?? '', travelDistance: inv.guest.travelDistance ?? '', documentType: '', documentNumber: '',
  });
  const [touched, setTouched] = useState(false);
  const [docPhoto, setDocPhoto] = useState<string | null>(null);
  const [noticeEnd, setNoticeEnd] = useState(false);
  const [noticeRead, setNoticeRead] = useState(false);
  const [docsEnd, setDocsEnd] = useState<Set<string>>(() => new Set());
  const [docsOk, setDocsOk] = useState<Set<string>>(() => new Set());
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another language means other texts: what was accepted must be read again.
  useEffect(() => { setNoticeEnd(false); setNoticeRead(false); setDocsEnd(new Set()); setDocsOk(new Set()); }, [locale]);

  const errors = useMemo(() => {
    const e: Partial<Record<keyof typeof f, string>> = {};
    for (const k of ['firstName', 'lastName'] as const) {
      if (!f[k].trim()) e[k] = t.required; else if (!NAME.test(f[k].trim())) e[k] = t.invalidName;
    }
    if (!f.travelDistance) e.travelDistance = t.required;
    if (policy.documentDataEnabled) {
      if (!f.documentType) e.documentType = t.required;
      if (f.documentNumber.trim().length < 3) e.documentNumber = t.required;
    }
    return e;
  }, [f, t, policy.documentDataEnabled]);
  const docPhotoMissing = policy.documentPhotoEnabled && !docPhoto;
  const key = steps[step];
  const canNext = key === 'details' ? true : key === 'notice' ? noticeRead : key === 'docs' ? documents.every((d) => docsOk.has(d.id)) : !!signature;

  if (!notice) return <p className="alert" role="alert">{t.errors.generic}</p>;

  const next = async () => {
    if (key === 'details' && (Object.keys(errors).length || docPhotoMissing)) { setTouched(true); return; }
    if (step < steps.length - 1) { setError(null); setStep(step + 1); window.scrollTo(0, 0); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/guest/invitation', {
        code, locale, firstName: f.firstName, lastName: f.lastName, company: f.company || undefined, travelDistance: f.travelDistance,
        documentType: policy.documentDataEnabled ? f.documentType : undefined, documentNumber: policy.documentDataEnabled ? f.documentNumber : undefined,
        documentPhoto: policy.documentPhotoEnabled ? docPhoto : undefined,
        privacyNoticeId: notice.id, privacyAccepted: true, acceptedDocuments: documents.map((d) => d.id), signature,
      });
      onDone();
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      if (c === 'NOTICE_OUTDATED' || c === 'DOCUMENTS_OUTDATED') {
        // The texts changed while the guest was reading: reload them and ask again from that step.
        await onReload();
        setNoticeEnd(false); setNoticeRead(false); setDocsEnd(new Set()); setDocsOk(new Set()); setSignature(null);
        setStep(c === 'NOTICE_OUTDATED' ? 1 : Math.max(1, steps.indexOf('docs')));
        setError(t.errors[c]);
      } else setError(e instanceof ApiError ? (c === 'INVITATION_USED' ? t.guestUsed : c === 'INVITATION_EXPIRED' ? t.guestExpired : t.errors.generic) : t.errors.offline);
    } finally { setBusy(false); }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const err = (k: keyof typeof f) => (touched && errors[k] ? <span className="error" role="alert">{errors[k]}</span> : null);
  const inv_ = (k: keyof typeof f) => (touched && errors[k] ? true : undefined);
  const scrolled = (el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - 12;

  return (
    <div>
      <Steps labels={steps.map((s) => t.steps[STEP_LABEL[s]])} current={step} caption={t.stepOf.replace('{n}', String(step + 1)).replace('{total}', String(steps.length))} />
      {error && <p className="alert" role="alert">{error}</p>}

      {key === 'details' && (
        <form className="k-form" onSubmit={(e) => { e.preventDefault(); next(); }} noValidate>
          <div className="k-row">
            <div className="field"><label htmlFor="fn">{t.firstName}</label><input id="fn" className="input" value={f.firstName} onChange={set('firstName')} maxLength={80} aria-invalid={inv_('firstName')} autoComplete="given-name" />{err('firstName')}</div>
            <div className="field"><label htmlFor="ln">{t.lastName}</label><input id="ln" className="input" value={f.lastName} onChange={set('lastName')} maxLength={80} aria-invalid={inv_('lastName')} autoComplete="family-name" />{err('lastName')}</div>
          </div>
          <div className="field"><label htmlFor="co">{t.company}</label><input id="co" className="input" value={f.company} onChange={set('company')} maxLength={120} autoComplete="organization" /><span className="hint">{t.companyHint}</span></div>
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
              <div className="field"><label htmlFor="dn">{t.documentNumber}</label><input id="dn" className="input" value={f.documentNumber} onChange={set('documentNumber')} maxLength={40} aria-invalid={inv_('documentNumber')} autoCapitalize="characters" autoComplete="off" />{err('documentNumber')}</div>
            </>
          )}
          {policy.documentPhotoEnabled && (
            <div className="field">
              <PhotoCapture title={t.photoDocTitle} hint={t.photoDocHint} value={docPhoto} onChange={setDocPhoto} t={t} />
              {touched && docPhotoMissing && <span className="error" role="alert">{t.required}</span>}
            </div>
          )}
          <button type="submit" hidden />
        </form>
      )}

      {key === 'notice' && (
        <div className="stack">
          <div className="k-notice" tabIndex={0} onScroll={(e) => { if (scrolled(e.currentTarget)) setNoticeEnd(true); }}
            ref={(el) => { if (el && el.scrollHeight <= el.clientHeight + 12 && !noticeEnd) setNoticeEnd(true); }}>
            <h3>{notice.title}</h3>
            {notice.body.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
            <p className="muted" style={{ fontSize: 14 }}>v{notice.version}</p>
          </div>
          {!noticeEnd && <p className="muted" style={{ margin: 0 }}>{t.noticeScroll}</p>}
          <label className="k-check" aria-disabled={!noticeEnd}>
            <input type="checkbox" checked={noticeRead} disabled={!noticeEnd} onChange={(e) => setNoticeRead(e.target.checked)} />{t.noticeRead}
          </label>
        </div>
      )}

      {key === 'docs' && (
        <div className="stack">
          <div><h2 className="k-h2">{t.docsTitle}</h2><p className="muted" style={{ margin: 0 }}>{t.docsHint}</p></div>
          {documents.map((d) => {
            const end = docsEnd.has(d.id);
            const reached = () => setDocsEnd((x) => (x.has(d.id) ? x : new Set(x).add(d.id)));
            return (
              <section key={d.id} className="stack" style={{ gap: 10 }} aria-label={d.title}>
                <div className="k-notice k-doc" tabIndex={0} onScroll={(e) => { if (scrolled(e.currentTarget)) reached(); }}
                  ref={(el) => { if (el && el.scrollHeight <= el.clientHeight + 12 && !end) reached(); }}>
                  <h3>{d.title}</h3>
                  {d.body.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
                  <p className="muted" style={{ fontSize: 14 }}>v{d.version}</p>
                </div>
                {!end && <p className="muted" style={{ margin: 0 }}>{t.noticeScroll}</p>}
                <label className="k-check" aria-disabled={!end}>
                  <input type="checkbox" checked={docsOk.has(d.id)} disabled={!end}
                    onChange={(e) => setDocsOk((x) => { const n = new Set(x); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                  {t.docAccept}: {d.title}
                </label>
              </section>
            );
          })}
        </div>
      )}

      {key === 'sign' && (
        <div className="stack">
          <div><h2 className="k-h2">{t.signTitle}</h2><p className="muted" style={{ margin: 0 }}>{documents.length ? t.signHintDocs : t.signHint}</p></div>
          <SignaturePad onChange={setSignature} clearLabel={t.clear} />
        </div>
      )}

      <div className="k-actions">
        {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>{t.back}</button>}
        <button type="button" className="btn btn-primary" onClick={next} disabled={busy || (key !== 'details' && !canNext)} aria-busy={busy}>
          {busy ? t.sending : step === steps.length - 1 ? t.guestSubmit : t.next}
        </button>
      </div>
    </div>
  );
}
