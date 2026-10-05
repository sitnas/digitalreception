import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../lib/api';
import { intlLocale, lang, t } from './badge-strings';
import { Button, Chip, Field, ScreenHeader, Screen, SkeletonRows, SuccessCheck } from './badge-ui';
import { ArrivalNotices } from './BadgePush';
import { byDay, dateIn, dayOptions, isEmail, isName, normaliseTime, PURPOSES, shareText, timeIn, type Invite, type Profile, type Purpose } from './invites';

export type { Profile } from './invites';

/**
 * Invitations on the "My badge" page, for employees who are also people to visit: the same three
 * screens as the phone app (list by day, new invitation, QR and code to forward).
 */

const QUICK_TIMES = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];

/** Calls /api/me… with the token issued at activation. */
export async function me<R>(token: string, path = '', init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/me${path}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, Array.isArray(data.message) ? data.message[0] : data.message ?? r.statusText);
  return data as R;
}

const explain = (e: unknown) => (e instanceof ApiError ? (t.invites.errors as Record<string, string>)[e.code] ?? t.errors.generic : t.errors.offline);

/** Upcoming guests of the signed-in employee, by day. */
export function InvitesList({ token, onBack, onNew, onOpen }: { token: string; onBack: () => void; onNew: () => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Invite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await me<Invite[]>(token, '/invitations')); setError(null); } catch (e) { setError(explain(e)); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // Back in front (a guest may have arrived meanwhile): refresh.
  useEffect(() => {
    const on = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [load]);

  const now = Date.now();
  const dayLabel = (date: string, tz: string) =>
    date === dateIn(now, tz) ? t.invites.today : date === dateIn(now + 86_400_000, tz) ? t.invites.tomorrow
      : new Intl.DateTimeFormat(intlLocale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00Z`));

  return (
    <>
      <ScreenHeader title={t.invites.title} backLabel={t.invites.back} onBack={onBack} />
      <Screen>
        <Button label={t.invites.new} onClick={onNew} />
        <ArrivalNotices token={token} />
        {error && <p className="mb-error-block" role="alert">{error}</p>}
        {rows === null && !error && <SkeletonRows label={t.loading} />}
        {rows && rows.length === 0 && <p className="mb-empty">{t.invites.none}</p>}
        {rows && byDay(rows).map((g) => (
          <section key={g.date} className="mb-group" aria-label={dayLabel(g.date, g.rows[0].timezone)}>
            <h2 className="mb-day">{dayLabel(g.date, g.rows[0].timezone)}</h2>
            {g.rows.map((r) => (
              <button key={r.id} type="button" className="mb-row mb-row-btn" onClick={() => onOpen(r.id)}>
                <span className="mb-time">{timeIn(Date.parse(r.expectedAt), r.timezone)}</span>
                <span className="mb-row-main">
                  <strong className={r.status === 'CANCELLED' ? 'mb-struck' : undefined}>{r.firstName} {r.lastName}</strong>
                  <small>{[r.company, r.siteName].filter(Boolean).join(' · ')}</small>
                </span>
                <span className={`mb-status${r.status === 'PENDING' ? ' is-on' : ''}`}>{t.invites.status[r.status]}</span>
              </button>
            ))}
          </section>
        ))}
      </Screen>
    </>
  );
}

/** New invitation: the guest, when and where. The host is always the signed-in employee. */
export function NewInvite({ token, profile, onBack, onCreated }: { token: string; profile: Profile; onBack: () => void; onCreated: (id: string, emailStatus: string) => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', company: '', email: '', siteId: profile.sites[0]?.id ?? '', date: '', time: '10:00', purpose: 'MEETING' as Purpose });
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'time' | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  const site = profile.sites.find((s) => s.id === f.siteId) ?? profile.sites[0];
  const days = useMemo(() => (site ? dayOptions(Date.now(), site.timezone, intlLocale) : []), [site]);
  useEffect(() => { if (days.length && !days.some((d) => d.date === f.date)) setF((x) => ({ ...x, date: days[0].date })); }, [days, f.date]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const time = normaliseTime(f.time);
    const errs: typeof errors = {};
    if (!isName(f.firstName) || !isName(f.lastName)) errs.name = t.invites.errors.name;
    if (!isEmail(f.email)) errs.email = t.invites.errors.email;
    if (!time) errs.time = t.invites.errors.time;
    // No site left means this person is no longer someone who can be visited: say so instead of doing nothing.
    if (!site) errs.form = t.invites.errors.NOT_A_HOST;
    setErrors(errs);
    if (Object.keys(errs).length || !site) return;
    setBusy(true);
    try {
      const r = await me<{ id: string; emailStatus: string }>(token, '/invitations', {
        method: 'POST',
        body: JSON.stringify({ siteId: site.id, date: f.date, time, firstName: f.firstName.trim(), lastName: f.lastName.trim(), company: f.company.trim() || null, email: f.email.trim().toLowerCase(), purpose: f.purpose, locale: lang }),
      });
      onCreated(r.id, r.emailStatus);
    } catch (err) { setErrors({ form: explain(err) }); } finally { setBusy(false); }
  };

  return (
    <>
      <ScreenHeader title={t.invites.new} backLabel={t.invites.back} onBack={onBack} />
      <Screen>
        <form className="mb-form" onSubmit={submit} noValidate>
          <h2 className="mb-section">{t.invites.guest}</h2>
          <Field id="if" label={t.invites.firstName} value={f.firstName} onChange={set('firstName')} maxLength={80} autoComplete="off" autoCapitalize="words" enterKeyHint="next" />
          <Field id="il" label={t.invites.lastName} value={f.lastName} onChange={set('lastName')} maxLength={80} autoComplete="off" autoCapitalize="words" enterKeyHint="next" error={errors.name} />
          <Field id="ic" label={t.invites.company} value={f.company} onChange={set('company')} maxLength={120} autoComplete="off" autoCapitalize="words" enterKeyHint="next" />
          <Field id="ie" label={t.invites.email} type="email" inputMode="email" value={f.email} onChange={set('email')} maxLength={190} autoComplete="off" autoCapitalize="none" spellCheck={false} error={errors.email} />

          <h2 className="mb-section">{t.invites.when}</h2>
          {profile.sites.length > 1 && (
            <div className="mb-group">
              <span className="mb-label" id="ns-l">{t.invites.site}</span>
              <div className="mb-wrap" role="radiogroup" aria-labelledby="ns-l">
                {profile.sites.map((s) => <Chip key={s.id} label={s.name} selected={s.id === site?.id} onClick={() => setF({ ...f, siteId: s.id })} />)}
              </div>
            </div>
          )}
          <div className="mb-group">
            <span className="mb-label" id="nd-l">{t.invites.day}</span>
            <div className="mb-scroll" role="radiogroup" aria-labelledby="nd-l">
              {days.map((d, i) => <Chip key={d.date} label={i === 0 ? t.invites.today : i === 1 ? t.invites.tomorrow : d.label} selected={d.date === f.date} onClick={() => setF({ ...f, date: d.date })} />)}
            </div>
          </div>
          <div className="mb-group">
            <div className="mb-wrap" role="radiogroup" aria-label={t.invites.time}>
              {QUICK_TIMES.map((q) => <Chip key={q} label={q} selected={normaliseTime(f.time) === q} onClick={() => setF({ ...f, time: q })} />)}
            </div>
            <Field id="it" label={t.invites.time} value={f.time} onChange={set('time')} inputMode="numeric" placeholder={t.invites.timeHint} maxLength={5} error={errors.time} />
          </div>
          <div className="mb-group">
            <span className="mb-label" id="np-l">{t.invites.purpose}</span>
            <div className="mb-wrap" role="radiogroup" aria-labelledby="np-l">
              {PURPOSES.map((p) => <Chip key={p} label={t.invites.purposes[p]} selected={f.purpose === p} onClick={() => setF({ ...f, purpose: p })} />)}
            </div>
          </div>
          {errors.form && <p className="mb-error-block" role="alert">{errors.form}</p>}
          <Button type="submit" label={t.invites.create} busy={busy} />
        </form>
      </Screen>
    </>
  );
}

/** One invitation: the QR and code to forward, and the way to cancel it. */
export function InviteDetail({ token, id, created, organisation, host, onBack }: { token: string; id: string; created?: string; organisation: string; host: string; onBack: () => void }) {
  const [inv, setInv] = useState<Invite | null | undefined>(undefined);
  const [qr, setQr] = useState<{ code: string; src: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const row = (await me<Invite[]>(token, '/invitations')).find((r) => r.id === id) ?? (await me<Invite[]>(token, '/invitations?scope=past')).find((r) => r.id === id) ?? null;
      setInv(row);
      if (row?.status === 'PENDING') {
        const { code, payload } = await me<{ code: string; payload: string }>(token, `/invitations/${row.id}/qr`);
        const svg = await QRCode.toString(payload, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
        setQr({ code, src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
      } else setQr(null);
    } catch (e) { setError(explain(e)); }
  }, [token, id]);
  useEffect(() => { load(); }, [load]);

  const when = inv ? new Intl.DateTimeFormat(intlLocale, { timeZone: inv.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(inv.expectedAt)) : '';
  const share = async () => {
    if (!inv || !qr) return;
    const text = shareText(t.invites.shareText, { firstName: inv.firstName, when, site: inv.siteName, organisation, code: qr.code, host });
    setNote(null);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setNote(t.invites.copied); }
    } catch { /* closed by the user */ }
  };
  const cancel = async () => {
    if (!inv || !window.confirm(`${t.invites.cancelTitle}\n${t.invites.cancelText}`)) return;
    setBusy(true); setError(null);
    try { await me(token, `/invitations/${inv.id}/cancel`, { method: 'POST', body: '{}' }); await load(); } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <ScreenHeader title={t.invites.title} backLabel={t.invites.back} onBack={onBack} />
      <Screen>
        {created && (
          <div className="mb-notice" role="alert">
            <SuccessCheck size={44} />
            <div><strong>{t.invites.created}</strong><span>{created === 'SKIPPED' ? t.invites.emailOff : t.invites.emailSent}</span></div>
          </div>
        )}
        {error && <p className="mb-error-block" role="alert">{error}</p>}
        {inv === undefined && !error && <span className="mb-spinner mb-spinner-page" role="progressbar" aria-label={t.loading} />}
        {inv && (
          <section className="mb-card mb-invite" aria-label={`${inv.firstName} ${inv.lastName}`}>
            <span className="mb-status-big">{t.invites.status[inv.status]}</span>
            <p className="mb-invite-name">{inv.firstName} {inv.lastName}</p>
            {inv.company && <p className="mb-meta">{inv.company}</p>}
            <p className="mb-when">{when}</p>
            <p className="mb-meta">{inv.siteName} · {t.invites.purposes[inv.purpose]}</p>
            <p className="mb-meta">{inv.email}</p>
            {qr && (
              <>
                <div className="mb-qr mb-qr-small"><img src={qr.src} alt={`${t.invites.code} ${qr.code.split('').join(' ')}`} /></div>
                <p className="mb-meta">{t.invites.code}</p>
                <p className="mb-code" translate="no">{qr.code}</p>
              </>
            )}
          </section>
        )}
        {inv && qr && <Button label={t.invites.share} onClick={share} />}
        {note && <p className="mb-small mb-centered" role="status">{note}</p>}
        {inv?.status === 'PENDING' && <Button label={t.invites.cancel} kind="danger" busy={busy} onClick={cancel} />}
      </Screen>
    </>
  );
}
