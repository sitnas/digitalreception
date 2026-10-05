import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { applyBrand } from '../lib/theme';
import { intlLocale, lang, t } from './badge-strings';
import { Button, Field, QrRing, Screen, SquaresBand, SuccessCheck } from './badge-ui';
import { InviteDetail, InvitesList, NewInvite, me, type Profile } from './BadgeInvites';
import { forgetWebPush } from './BadgePush';

/**
 * "My badge" on the employee's phone, in the browser: the same screens as the phone app. After a
 * one-time email code (or the company account) the phone keeps a secret and draws a QR that
 * changes every 30 seconds (HMAC of the time step): a screenshot stops working within a minute.
 * Everything is computed on the phone, it works without network at the door.
 */

interface Badge { employeeId: string; secret: string; step: number; organisation: string; firstName: string; lastName: string;
  /** For the employee's own requests (invitations); missing on badges activated before it existed. */
  appToken?: string }
interface Tenant { name: string; primaryColor: string | null; secondaryColor: string | null; sso: { provider: 'microsoft' | 'google' } | null }

const KEY = 'rs_badge';
const VERIFIER_KEY = 'rs_badge_sso';
const load = (): Badge | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const save = (b: Badge | null) => { try { if (b) localStorage.setItem(KEY, JSON.stringify(b)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };
/** Seconds of clock difference with the server beyond which the reader may refuse the QR. */
const CLOCK_TOLERANCE_S = 20;

async function post<R>(path: string, body: unknown): Promise<R> {
  const r = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, Array.isArray(data.message) ? data.message[0] : data.message ?? r.statusText);
  return data as R;
}

/** Same signature the server checks: first 16 hex chars of HMAC-SHA256(secret, "<id>.<step>"). */
async function sign(secretB64: string, message: string): Promise<string> {
  const raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Company account: like the app, a random verifier stays on this phone and only its SHA-256 leaves. */
async function startSso() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const challenge = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(VERIFIER_KEY, verifier); } catch { /* storage unavailable */ }
  window.location.assign(`/api/auth/sso/badge?challenge=${challenge}&return=${encodeURIComponent('/badge')}`);
}

/** Back from the provider: /badge?code=… (or ?error=…). The address is cleaned at once. */
function readSsoReturn(): { code: string; verifier: string | null } | { error: string } | null {
  const q = new URLSearchParams(window.location.search);
  const code = q.get('code'), error = q.get('error');
  if (!code && !error) return null;
  window.history.replaceState(null, '', '/badge');
  let verifier: string | null = null;
  try { verifier = sessionStorage.getItem(VERIFIER_KEY); sessionStorage.removeItem(VERIFIER_KEY); } catch { /* storage unavailable */ }
  return code ? { code, verifier } : { error: error! };
}

/** The page forgets the badge at once; the server is told too (best effort), so nothing issued here keeps working. */
async function removeBadge(token: string | undefined) {
  await forgetWebPush(token);
  if (token) await me(token, '/revoke', { method: 'POST', body: '{}' }).catch(() => undefined);
}

/** A known reason in plain words; otherwise the generic message with status and code for whoever helps. */
function explain(e: unknown): string {
  if (!(e instanceof ApiError)) return t.errors.offline;
  const known = (t.errors as Record<string, string>)[e.code];
  if (known) return known;
  if (e.status === 429) return t.errors.tooMany;
  if (e.status === 400 && /email/i.test(e.code)) return t.errors.invalidEmail;
  return `${t.errors.generic}\n${t.errors.detail}: ${e.status} ${e.code}`;
}

type View = { name: 'badge' } | { name: 'invites' } | { name: 'new' } | { name: 'detail'; id: string; created?: string };

export function BadgeApp() {
  const [badge, setBadge] = useState<Badge | null>(load);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [justActivated, setJustActivated] = useState(false);
  const [view, setViewState] = useState<View>({ name: 'badge' });
  // People who can be visited also invite their guests from here.
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    setProfile(null);
    if (badge?.appToken) me<Profile>(badge.appToken).then(setProfile).catch(() => undefined);
  }, [badge]);
  useEffect(() => {
    // Installs as its own "My badge" app (needed on iPhone for notifications).
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previous = link?.getAttribute('href');
    link?.setAttribute('href', '/manifest-badge.webmanifest');
    document.title = t.title;
    document.documentElement.lang = lang;
    // The organisation's colours and sign-in, also before activation (public endpoint, no personal data).
    fetch('/api/tenant').then((r) => (r.ok ? r.json() : null)).then((b: Tenant | null) => { if (b) { applyBrand(b); setTenant(b); } }).catch(() => undefined);
    return () => { if (previous) link?.setAttribute('href', previous); };
  }, []);

  // Screens are browser history entries, so the phone's back gesture works like in the app.
  const setView = useCallback((v: View) => { window.history.pushState(v, ''); setViewState(v); window.scrollTo(0, 0); }, []);
  useEffect(() => {
    const pop = (e: PopStateEvent) => setViewState((e.state as View | null) ?? { name: 'badge' });
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const back = () => window.history.back();

  const activated = (b: Badge) => { save(b); setBadge(b); setJustActivated(true); };

  if (!badge) return <div className="mb"><Setup tenant={tenant} onDone={activated} /></div>;
  const token = badge.appToken;
  return (
    <div className="mb">
      {view.name === 'invites' && token ? <InvitesList token={token} onBack={back} onNew={() => setView({ name: 'new' })} onOpen={(id) => setView({ name: 'detail', id })} />
        : view.name === 'new' && token && profile ? <NewInvite token={token} profile={profile} onBack={back}
            onCreated={(id, emailStatus) => { window.history.replaceState({ name: 'detail', id, created: emailStatus }, ''); setViewState({ name: 'detail', id, created: emailStatus }); }} />
        : view.name === 'detail' && token ? <InviteDetail token={token} id={view.id} created={view.created} organisation={badge.organisation} host={badge.firstName} onBack={back} />
        : <BadgeScreen badge={badge} justActivated={justActivated} canInvite={!!profile?.canInvite} onInvites={() => setView({ name: 'invites' })}
            onRemove={() => { removeBadge(token); save(null); setBadge(null); setJustActivated(false); }} />}
    </div>
  );
}

/** First run: work email → 6-digit code from the email, or the company account when the organisation has one. */
function Setup({ tenant, onDone }: { tenant: Tenant | null; onDone: (b: Badge) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (step === 'code') codeInput.current?.focus(); }, [step]);

  // Back from Microsoft or Google: redeem the one-time code with the verifier kept on this phone.
  useEffect(() => {
    const back = readSsoReturn();
    if (!back) return;
    if ('error' in back) { setError((t.errors as Record<string, string>)[back.error] ?? t.errors.generic); return; }
    if (!back.verifier) { setError(t.errors.OTHER_APP); return; }
    setBusy(true);
    post<Badge>('auth/sso/badge/redeem', { code: back.code, verifier: back.verifier }).then(onDone, (e) => setError(explain(e))).finally(() => setBusy(false));
  }, [onDone]);

  // Autofill and keyboards can add spaces or invisible characters around the address.
  const cleanEmail = () => email.replace(/[\s​-‍﻿]/g, '');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(explain(e)); } finally { setBusy(false); } };
  const submitEmail = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await post('badge/request', { email: cleanEmail(), locale: lang }); setStep('code'); }); };
  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      try { onDone(await post<Badge>('badge/activate', { email: cleanEmail(), code })); }
      catch (err) { setCode(''); codeInput.current?.focus(); throw err; }
    });
  };
  const sso = tenant?.sso;
  const providerName = sso?.provider === 'microsoft' ? 'Microsoft' : 'Google';

  return (
    <Screen center>
      <h1 className="mb-title">{tenant?.name ?? t.title}</h1>
      <p className="mb-intro">{step === 'code' ? t.sent : t.emailIntro}</p>
      {step === 'email' ? (
        <form className="mb-form" onSubmit={submitEmail} noValidate>
          {sso && (
            <>
              <Button label={t.ssoSignIn.replace('{provider}', providerName)} busy={busy} onClick={startSso} />
              <p className="mb-hint">{t.ssoHint}</p>
              <p className="mb-or">{t.ssoOr}</p>
            </>
          )}
          <Field id="be" label={t.email} error={error} type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            inputMode="email" enterKeyHint="send" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" label={t.send} kind={sso ? 'ghost' : 'primary'} busy={busy} />
        </form>
      ) : (
        <form className="mb-form" onSubmit={submitCode} noValidate>
          <Field id="bc" label={t.code} error={error} inputRef={codeInput} className="mb-code-input" translate="no" inputMode="numeric"
            autoComplete="one-time-code" maxLength={6} enterKeyHint="done" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <Button type="submit" label={t.activate} busy={busy} />
          <Button label={t.changeEmail} kind="ghost" onClick={() => { setStep('email'); setCode(''); setError(null); }} />
        </form>
      )}
    </Screen>
  );
}

interface Parcel { id: string; siteName: string; timezone: string; carrier: string | null; pieces: number; receivedAt: string }

/** When it arrived, in the site's time zone: the time if today, otherwise the day. */
function arrived(r: Parcel) {
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: r.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const at = Date.parse(r.receivedAt);
  return day(at) === day(Date.now())
    ? t.parcels.today.replace('{site}', r.siteName).replace('{time}', new Intl.DateTimeFormat(intlLocale, { timeZone: r.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(at)))
    : t.parcels.day.replace('{site}', r.siteName).replace('{date}', new Intl.DateTimeFormat(intlLocale, { timeZone: r.timezone, day: 'numeric', month: 'long' }).format(new Date(at)));
}

/** Parcels waiting at reception, under the badge card (as in the app): refreshed on return and once a minute. */
function ParcelsCard({ token }: { token: string }) {
  const [rows, setRows] = useState<Parcel[]>([]);
  useEffect(() => {
    const load = () => { if (!document.hidden) me<Parcel[]>(token, '/parcels').then((r) => setRows(Array.isArray(r) ? r : []), () => undefined); };
    load();
    const h = setInterval(load, 60_000);
    document.addEventListener('visibilitychange', load);
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', load); };
  }, [token]);
  if (!rows.length) return null;
  const total = rows.reduce((n, r) => n + r.pieces, 0);
  return (
    <section className="mb-parcels" aria-live="polite">
      <strong>{total > 1 ? t.parcels.many.replace('{n}', String(total)) : t.parcels.one}</strong>
      {rows.map((r) => <span key={r.id}>{[r.carrier, r.pieces > 1 ? t.parcels.pieces.replace('{n}', String(r.pieces)) : null, arrived(r)].filter(Boolean).join(' · ')}</span>)}
    </section>
  );
}

/** Right after activation: a tick and a line that fade away by themselves. */
function Activated() {
  const [gone, setGone] = useState(false);
  useEffect(() => { const h = setTimeout(() => setGone(true), 2600); return () => clearTimeout(h); }, []);
  if (gone) return null;
  return (
    <div className="mb-activated" role="alert">
      <SuccessCheck size={40} />
      <span>{t.activated}</span>
    </div>
  );
}

function BadgeScreen({ badge, justActivated, canInvite, onInvites, onRemove }: { badge: Badge; justActivated: boolean; canInvite: boolean; onInvites: () => void; onRemove: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [svg, setSvg] = useState('');
  const step = Math.floor(now / 1000 / badge.step);
  const left = badge.step - (Math.floor(now / 1000) % badge.step);

  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  // HMAC once per step, not once per second.
  useEffect(() => {
    let alive = true;
    sign(badge.secret, `${badge.employeeId}.${step}`)
      .then((sig) => QRCode.toString(`DRE1:${badge.employeeId}.${step}.${sig}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
      .then((s) => { if (alive) setSvg(s); });
    return () => { alive = false; };
  }, [badge, step]);
  // Keep the screen on while the badge is shown (where the browser allows it), again after coming back.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const take = () => { if (!document.hidden) nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined); };
    take();
    document.addEventListener('visibilitychange', take);
    return () => { document.removeEventListener('visibilitychange', take); lock?.release().catch(() => undefined); };
  }, []);
  // A phone clock off by more than the tolerance makes the reader refuse the QR: say so.
  const [clockOff, setClockOff] = useState(false);
  useEffect(() => {
    const before = Date.now();
    fetch('/api/health', { cache: 'no-store' }).then((r) => {
      const date = r.headers.get('date');
      if (date) setClockOff(Math.abs(Date.parse(date) - (before + Date.now()) / 2) > CLOCK_TOLERANCE_S * 1000);
    }).catch(() => undefined);
  }, []);
  const src = useMemo(() => (svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : ''), [svg]);

  return (
    <Screen center>
      {justActivated && <Activated />}
      <section className="mb-card mb-badge" aria-label={t.title}>
        <SquaresBand />
        <h1 className="mb-org">{badge.organisation}</h1>
        <p className="mb-name">{badge.firstName} {badge.lastName}</p>
        {/* Always black on white with a quiet zone: the reader camera needs contrast, also in dark mode. */}
        <QrRing codeStep={step} left={left} step={badge.step}>
          <div className="mb-qr">{src ? <img src={src} alt={t.hint} /> : <span className="mb-qr-empty" />}</div>
        </QrRing>
        <p className="mb-small" aria-live="off">{t.next.replace('{n}', String(left))}</p>
        <p className="mb-hint-strong">{t.hint}</p>
        {clockOff && <p className="mb-warn" role="alert">{t.clock}</p>}
      </section>
      {badge.appToken && <ParcelsCard token={badge.appToken} />}
      {canInvite && <Button label={t.invites.open} onClick={onInvites} />}
      {!badge.appToken && <p className="mb-small mb-centered">{t.invites.reactivate}</p>}
      <Button label={t.remove} kind="ghost" onClick={() => { if (window.confirm(`${t.removeTitle}\n${t.removeText}`)) onRemove(); }} />
    </Screen>
  );
}
