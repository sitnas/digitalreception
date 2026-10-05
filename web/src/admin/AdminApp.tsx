import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { MortiseMark, Mo } from '../lib/mortise';
import { applyBrand } from '../lib/theme';
import { ADMIN_STRINGS, AdminLocale, I18nContext, useI18n } from './i18n';
import { AccountPage, MfaEnroll, RecoveryCodes } from './pages/Account';
import { AuditPage } from './pages/Audit';
import { DevicesPage } from './pages/Devices';
import { DocumentsPage } from './pages/Documents';
import { ParcelsPage } from './pages/Parcels';
import { ProjectsPage } from './pages/Projects';
import { EvacuationPage } from './pages/Evacuation';
import { HistoryPage } from './pages/History';
import { InvitationsPage } from './pages/Invitations';
import { AccessLogPage, DoorsPage, EmployeesPage, IntegrationPage } from './pages/Access';
import { HostsPage } from './pages/Hosts';
import { OrganisationPage } from './pages/Organisation';
import { WebhooksPage } from './pages/Webhooks';
import { PrivacyPage } from './pages/Privacy';
import { SitesPage } from './pages/Sites';
import { StatsPage } from './pages/Stats';
import { TodayPage } from './pages/Today';
import { UsersPage } from './pages/Users';
import { APP_KEYS, type AppKey, type Me, type Role } from './types';
import { AppsPage } from './pages/Apps';
import { ParkingPage } from './pages/Parking';

interface Branding { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null; sso: { provider: 'microsoft' | 'google'; enforced: boolean } | null }
const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

const LOCALE_KEY = 'rs_admin_locale';
function initialLocale(): AdminLocale {
  try { const s = localStorage.getItem(LOCALE_KEY); if (s === 'it' || s === 'es' || s === 'en') return s; } catch { /* ignore */ }
  const nav = navigator.language.toLowerCase();
  return nav.startsWith('es') ? 'es' : nav.startsWith('it') ? 'it' : 'en';
}

type NavGroup = keyof typeof ADMIN_STRINGS.it.navGroups;
/**
 * The console as a portal: the shared data first (employees, jobs, sites, users), then one group per
 * app, shown only while the organisation has that app on, then settings and oversight.
 */
const NAV: { to: string; key: keyof typeof ADMIN_STRINGS.it.nav; group: NavGroup; roles: Role[]; app?: AppKey }[] = [
  { to: 'employees', key: 'employees', group: 'data', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'projects', key: 'projects', group: 'data', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'sites', key: 'sites', group: 'data', roles: ['SUPER_ADMIN'] },
  { to: 'users', key: 'users', group: 'data', roles: ['SUPER_ADMIN'] },
  { to: 'integration', key: 'integration', group: 'data', roles: ['SUPER_ADMIN'] },
  { to: 'today', key: 'today', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'invites', key: 'invites', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'history', key: 'history', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'evacuation', key: 'evacuation', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST'] },
  { to: 'stats', key: 'stats', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'hosts', key: 'hosts', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER'] },
  { to: 'devices', key: 'devices', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER'] },
  { to: 'documents', key: 'documents', group: 'reception', app: 'reception', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'doors', key: 'doors', group: 'access', app: 'access', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'access-log', key: 'accessLog', group: 'access', app: 'access', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'parcels', key: 'parcels', group: 'parcels', app: 'parcels', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'parking', key: 'parking', group: 'parking', app: 'parking', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'apps', key: 'apps', group: 'settings', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'notifications', key: 'notifications', group: 'settings', roles: ['SUPER_ADMIN'] },
  { to: 'organisation', key: 'org', group: 'settings', roles: ['SUPER_ADMIN'] },
  { to: 'privacy', key: 'privacy', group: 'compliance', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'audit', key: 'audit', group: 'compliance', roles: ['SUPER_ADMIN', 'AUDITOR'] },
];
const APP_GROUPS: NavGroup[] = ['reception', 'access', 'parcels', 'parking'];

/** Reloads the signed-in user (after turning an app on or off, the menu follows). */
const ReloadMeContext = createContext<() => Promise<void>>(async () => {});
export const useReloadMe = () => useContext(ReloadMeContext);

export function AdminApp() {
  const [locale, setLocaleState] = useState<AdminLocale>(initialLocale);
  const setLocale = (l: AdminLocale) => { setLocaleState(l); try { localStorage.setItem(LOCALE_KEY, l); } catch { /* ignore */ } };
  const i18n = useMemo(() => ({ t: ADMIN_STRINGS[locale], locale, intl: locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'it-IT', setLocale }), [locale]);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [me, setMe] = useState<Me | null | 'anon'>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try { setMe(await api.get<Me>('/auth/me')); } catch { setMe('anon'); }
  }, []);

  useEffect(() => {
    api.get<Branding>('/tenant').then((b) => { applyBrand(b); setBranding(b); }).catch((e) => setFatal(e instanceof ApiError ? e.code : 'offline'));
    loadMe();
  }, [loadMe]);

  useEffect(() => { document.title = branding ? `${ADMIN_STRINGS[locale].appName} · ${branding.name}` : 'Mortise'; }, [branding, locale]);

  return (
    <I18nContext.Provider value={i18n}>
      {fatal ? <FatalScreen code={fatal} /> :
        me === null || !branding ? null :
        me === 'anon' ? <LoginScreen branding={branding} onLoggedIn={loadMe} /> :
        me.mustChangePassword ? <ChangePasswordScreen branding={branding} onDone={() => setMe('anon')} /> :
        me.mfaSetupRequired ? <MfaSetupScreen branding={branding} onDone={loadMe} /> :
        <ReloadMeContext.Provider value={loadMe}><MeContext.Provider value={me}><Shell branding={branding} me={me} onLogout={() => setMe('anon')} /></MeContext.Provider></ReloadMeContext.Provider>}
    </I18nContext.Provider>
  );
}

function FatalScreen({ code }: { code: string }) {
  const { t } = useI18n();
  const msg = code === 'TENANT_SUSPENDED' ? t.errors.TENANT_SUSPENDED : t.errors.generic;
  return <div className="login-main" style={{ minHeight: '100dvh' }}><div className="alert" role="alert" style={{ maxWidth: 480 }}>{msg}</div></div>;
}

function Brand({ branding }: { branding: Branding }) {
  return (
    <div className="a-brand">
      {branding.logo ? <img src={branding.logo} alt="" className="logo" /> : <MortiseMark size={32} dark />}
      <span>{branding.name}</span>
    </div>
  );
}

/**
 * On narrow screens every data table becomes a list of cards: each cell gets its column name as a
 * label (from the table header), so nothing is hidden behind a horizontal scroll. Applies to every
 * page, including tables rendered later; the CSS switches layout below 760px only.
 */
function useCardTables(root: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const label = () => {
      frame = 0;
      for (const table of el.querySelectorAll<HTMLTableElement>('.table-wrap > table')) {
        const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
        if (!heads.length) continue;
        table.classList.add('table-cards');
        for (const row of table.tBodies[0]?.rows ?? []) {
          [...row.cells].forEach((cell, i) => {
            if (heads[i]) cell.setAttribute('data-label', heads[i]);
            else if (cell.querySelector('button, a')) cell.classList.add('row-action');
          });
        }
      }
    };
    const obs = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(label); });
    obs.observe(el, { childList: true, subtree: true });
    label();
    return () => { obs.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [root]);
}

/** Line icons for the menu sections (24px grid, drawn with currentColor). */
function GroupIcon({ group }: { group: NavGroup }) {
  const paths: Record<NavGroup, React.ReactNode> = {
    data: <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>,
    reception: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></>,
    access: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><circle cx="15" cy="12.5" r="1.1" /><path d="M9 3v18" /></>,
    parcels: <><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.3l8.4 4.5" /></>,
    parking: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M9.5 17V7h3.2a3 3 0 0 1 0 6H9.5" /></>,
    settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></>,
    compliance: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6L12 3z" /><path d="M8.8 12.2l2.2 2.2 4.3-4.6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[group]}</svg>;
}

/** Two-panel sign-in: the organisation's colours and name on the left, the form on the right. */
function AuthLayout({ branding, children }: { branding: Branding; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="login">
      <aside className="login-aside">
        <Brand branding={branding} />
        <h2>{t.login.tagline}</h2>
        <p>{t.login.footnote}</p>
      </aside>
      <main className="login-main">{children}</main>
    </div>
  );
}

function LangSwitch() {
  const { t, locale, setLocale } = useI18n();
  return (
    <label className="inline" style={{ fontSize: 13 }}>
      <span className="muted">{t.language}</span>
      <select className="input lang-select" value={locale} onChange={(e) => setLocale(e.target.value as AdminLocale)}>
        <option value="it">Italiano</option><option value="es">Español</option><option value="en">English</option>
      </select>
    </label>
  );
}

function LoginScreen({ branding, onLoggedIn }: { branding: Branding; onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Second step: the password was right, the server wants a code before opening a session.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const pwInput = useRef<HTMLInputElement>(null);
  const sso = branding.sso;
  const providerName = sso ? t.sso.providers[sso.provider] : '';
  // Back from Microsoft / Google with an error: shown once, then removed from the address.
  const [ssoError] = useState(() => {
    const code = new URLSearchParams(location.search).get('sso_error');
    return code ? (t.sso.errors[code as keyof typeof t.sso.errors] ?? t.sso.errors.generic) : null;
  });
  useEffect(() => { if (ssoError) history.replaceState(null, '', location.pathname); }, [ssoError]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api.post<{ mfaRequired?: boolean; mfaToken?: string }>('/auth/login', { email, password });
      setPassword('');
      if (r.mfaRequired && r.mfaToken) { setMfaToken(r.mfaToken); setCode(''); setRecovery(false); } else onLoggedIn();
    }
    catch (err) {
      setError(err instanceof ApiError && err.code === 'SSO_REQUIRED' ? t.sso.required.replace('{provider}', providerName)
        : err instanceof ApiError && (err.status === 401 || err.status === 429) ? t.login.invalid : t.errors.generic);
      pwInput.current?.select();
    }
    finally { setBusy(false); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.post('/auth/login/mfa', { mfaToken, code }); onLoggedIn(); }
    catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_SESSION_EXPIRED') { setMfaToken(null); setError(t.mfa.expired); }
      else setError(err instanceof ApiError && (err.status === 401 || err.status === 429) ? t.mfa.invalid : t.errors.generic);
      setCode('');
      codeInput.current?.focus(); // the field stays the place to type, not the button that was pressed
    }
    finally { setBusy(false); }
  };

  if (mfaToken) return (
    <AuthLayout branding={branding}>
      <form onSubmit={verify}>
        <h1>{t.mfa.loginTitle}</h1>
        <p className="muted" style={{ margin: 0 }}>{recovery ? t.mfa.recoveryLoginIntro : t.mfa.loginIntro}</p>
        <div className="field">
          <label htmlFor="otp">{recovery ? t.mfa.recoveryLabel : t.mfa.code}</label>
          {recovery
            ? <input ref={codeInput} id="otp" key="rc" name="recovery-code" className="input mfa-code-input" translate="no" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                maxLength={11} pattern="\s*[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}\s*" placeholder="XXXXX-XXXXX" aria-invalid={!!error} aria-describedby={error ? 'login-err' : undefined}
                value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required autoFocus />
            : <input ref={codeInput} id="otp" key="totp" name="code" className="input mfa-code-input" translate="no" inputMode="numeric" autoComplete="one-time-code" spellCheck={false}
                pattern="\d{6}" title={t.mfa.codeHint} maxLength={6} placeholder="123456" aria-invalid={!!error} aria-describedby={error ? 'login-err' : undefined}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />}
        </div>
        {error && <p id="login-err" className="alert" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{t.mfa.verify}</button>
        <button type="button" className="btn-link" onClick={() => { setRecovery(!recovery); setCode(''); setError(null); }}>{recovery ? t.mfa.useApp : t.mfa.useRecovery}</button>
        <button type="button" className="btn-link" onClick={() => { setMfaToken(null); setError(null); }}>{t.mfa.back}</button>
      </form>
    </AuthLayout>
  );

  return (
    <AuthLayout branding={branding}>
      <form onSubmit={submit}>
        <h1>{t.login.title}</h1>
        {ssoError && <p className="alert" role="alert">{ssoError}</p>}
        {sso && (
          <>
            <a className={`btn btn-sso btn-sso-${sso.provider}`} href={`/api/auth/sso/start${email.includes('@') ? `?email=${encodeURIComponent(email.trim())}` : ''}`}>
              <SsoLogo provider={sso.provider} />{t.sso.signIn.replace('{provider}', providerName)}
            </a>
            {sso.enforced
              ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t.sso.enforcedHint.replace('{provider}', providerName)}</p>
              : <p className="login-or" aria-hidden="true"><span>{t.sso.or}</span></p>}
          </>
        )}
        <div className="field"><label htmlFor="em">{t.login.email}</label><input id="em" name="email" className="input" type="email" autoComplete="username" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw">{t.login.password}</label><input ref={pwInput} id="pw" name="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p className="alert" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{t.login.submit}</button>
        <LangSwitch />
      </form>
    </AuthLayout>
  );
}

/** Provider marks, drawn inline (no third-party request from the login page). */
export function SsoLogo({ provider }: { provider: 'microsoft' | 'google' }) {
  return provider === 'microsoft' ? (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** The organisation requires two-step verification and this user has not set it up yet. */
function MfaSetupScreen({ branding, onDone }: { branding: Branding; onDone: () => void }) {
  const { t } = useI18n();
  const [codes, setCodes] = useState<string[] | null>(null);
  const logout = async () => { try { await api.post('/auth/logout'); } finally { location.reload(); } };
  return (
    <AuthLayout branding={branding}>
      <div className="stack login-wide">
        {codes ? <RecoveryCodes codes={codes} onDone={onDone} /> : (
          <>
            <h1>{t.mfa.forcedTitle}</h1>
            <p className="muted" style={{ margin: 0 }}>{t.mfa.forcedIntro}</p>
            <MfaEnroll onEnabled={setCodes} />
            <button type="button" className="btn-link" style={{ justifySelf: 'start' }} onClick={logout}>{t.logout}</button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

function ChangePasswordScreen({ branding, onDone }: { branding: Branding; onDone: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<{ text: string; field: 'c' | 'r' | null } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // Errors sit under the field they concern, which also receives the focus.
  const fail = (text: string, field: 'c' | 'r' | null) => {
    setError({ text, field });
    if (field) requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>(`#${field}`)?.select());
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (f.next !== f.confirm) { fail(t.pwd.mismatch, 'r'); return; }
    setBusy(true);
    try { await api.post('/auth/password', { currentPassword: f.current, newPassword: f.next }); setDone(true); setTimeout(onDone, 1500); }
    catch (err) { if (err instanceof ApiError && err.status === 401) fail(t.pwd.wrong, 'c'); else fail(t.errors.generic, null); }
    finally { setBusy(false); }
  };
  const errFor = (field: 'c' | 'r') => error?.field === field ? <span id={`${field}-err`} className="field-error" role="alert">{error.text}</span> : null;
  const described = (field: 'c' | 'r', extra?: string) => [error?.field === field ? `${field}-err` : '', extra ?? ''].filter(Boolean).join(' ') || undefined;
  return (
    <AuthLayout branding={branding}>
      <form ref={form} onSubmit={submit}>
        <h1>{t.pwd.title}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.pwd.intro}</p>
        <div className="field"><label htmlFor="c">{t.pwd.current}</label><input id="c" name="current-password" className="input" type="password" autoComplete="current-password" aria-invalid={error?.field === 'c'} aria-describedby={described('c')} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required />{errFor('c')}</div>
        <div className="field"><label htmlFor="n">{t.pwd.next}</label><input id="n" name="new-password" className="input" type="password" autoComplete="new-password" minLength={12} aria-describedby="n-hint" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /><span id="n-hint" className="hint">{t.pwd.hint}</span></div>
        <div className="field"><label htmlFor="r">{t.pwd.confirm}</label><input id="r" name="confirm-password" className="input" type="password" autoComplete="new-password" minLength={12} aria-invalid={error?.field === 'r'} aria-describedby={described('r')} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />{errFor('r')}</div>
        {error && !error.field && <p className="alert" role="alert">{error.text}</p>}
        {done && <p className="alert alert-info" role="status">{t.pwd.done}</p>}
        <button className="btn btn-primary" disabled={done || busy} aria-busy={busy}>{t.pwd.submit}</button>
      </form>
    </AuthLayout>
  );
}

function Shell({ branding, me, onLogout }: { branding: Branding; me: Me; onLogout: () => void }) {
  const { t } = useI18n();
  const items = NAV.filter((n) => n.roles.includes(me.role) && (!n.app || me.apps.includes(n.app)));
  const logout = async () => { try { await api.post('/auth/logout'); } finally { onLogout(); } };
  const { pathname } = useLocation();
  const current = items.find((n) => pathname.startsWith(`/admin/${n.to}`));
  const main = useRef<HTMLElement>(null);
  useCardTables(main);
  // The user menu closes on navigation.
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [pathname]);
  const tabs = current ? items.filter((n) => n.group === current.group) : [];
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <div className="admin">
      <header className="a-bar">
        <button type="button" className="a-menu-btn" aria-expanded={menuOpen} aria-controls="a-sidemenu" onClick={() => setMenuOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          <span className="sr-only">{t.portal.menu}</span>
        </button>
        <NavLink to="" end className="a-bar-brand" aria-label={`${t.portal.home} · ${branding.name}`}>
          {branding.logo ? <img src={branding.logo} alt="" className="logo" /> : <MortiseMark size={30} dark />}
          <span>{branding.name}</span>
        </NavLink>
        <nav className="a-bar-nav" aria-label={t.portal.home}>
          <NavLink to="" end>{t.portal.home}</NavLink>
        </nav>
        <details className="a-user" ref={menu}>
          <summary aria-label={t.portal.account}><span className="a-avatar" aria-hidden>{me.displayName.trim().charAt(0).toUpperCase()}</span><span className="a-user-name">{me.displayName}</span></summary>
          <div className="a-user-pop">
            <strong>{me.displayName}</strong>
            <span className="muted">{me.email} · {t.roles[me.role]}</span>
            <LangSwitch />
            <NavLink to="account" className="btn-link">{t.mfa.nav}</NavLink>
            <button type="button" className="btn-link" onClick={logout}>{t.logout}</button>
          </div>
        </details>
      </header>
      {menuOpen && <SideMenu items={items} onClose={() => setMenuOpen(false)} />}
      {current && (
        <div className="a-section">
          <div className="a-section-in">
            <p className="a-crumb"><NavLink to="">{t.portal.home}</NavLink> <span aria-hidden>›</span> <span className="a-crumb-group"><GroupIcon group={current.group} />{t.navGroups[current.group]}</span></p>
            {tabs.length > 1 && (
              <nav className="a-tabs" aria-label={t.navGroups[current.group]}>
                {tabs.map((n) => <NavLink key={n.to} to={n.to}>{t.nav[n.key]}</NavLink>)}
              </nav>
            )}
          </div>
        </div>
      )}
      <main ref={main} className={`a-main${current ? '' : ' is-home'}`}>
        <Routes>
          <Route index element={<PortalHome me={me} items={items} />} />
          {items.some((i) => i.to === 'today') && <Route path="today" element={<TodayPage />} />}
          {items.some((i) => i.to === 'invites') && <Route path="invites" element={<InvitationsPage />} />}
          {items.some((i) => i.to === 'projects') && <Route path="projects" element={<ProjectsPage />} />}
          {items.some((i) => i.to === 'parcels') && <Route path="parcels" element={<ParcelsPage />} />}
          {items.some((i) => i.to === 'documents') && <Route path="documents" element={<DocumentsPage />} />}
          {items.some((i) => i.to === 'evacuation') && <Route path="evacuation" element={<EvacuationPage />} />}
          {items.some((i) => i.to === 'employees') && <Route path="employees" element={<EmployeesPage />} />}
          {items.some((i) => i.to === 'doors') && <Route path="doors" element={<DoorsPage />} />}
          {items.some((i) => i.to === 'access-log') && <Route path="access-log" element={<AccessLogPage />} />}
          {items.some((i) => i.to === 'integration') && <Route path="integration" element={<IntegrationPage />} />}
          {items.some((i) => i.to === 'history') && <Route path="history" element={<HistoryPage />} />}
          {items.some((i) => i.to === 'stats') && <Route path="stats" element={<StatsPage />} />}
          {items.some((i) => i.to === 'sites') && <Route path="sites" element={<SitesPage />} />}
          {items.some((i) => i.to === 'devices') && <Route path="devices" element={<DevicesPage />} />}
          {items.some((i) => i.to === 'hosts') && <Route path="hosts" element={<HostsPage />} />}
          {items.some((i) => i.to === 'users') && <Route path="users" element={<UsersPage />} />}
          {items.some((i) => i.to === 'privacy') && <Route path="privacy" element={<PrivacyPage />} />}
          {items.some((i) => i.to === 'audit') && <Route path="audit" element={<AuditPage />} />}
          {items.some((i) => i.to === 'notifications') && <Route path="notifications" element={<WebhooksPage />} />}
          {items.some((i) => i.to === 'organisation') && <Route path="organisation" element={<OrganisationPage />} />}
          {items.some((i) => i.to === 'apps') && <Route path="apps" element={<AppsPage />} />}
          {items.some((i) => i.to === 'parking') && <Route path="parking" element={<ParkingPage />} />}
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}

const DATA_GROUPS: NavGroup[] = ['data', 'settings', 'compliance'];

/**
 * The console's menu on a phone (Mortise mobile navigation: six destinations or more). It slides in
 * from the left edge and closes with a visible X, a tap outside or Escape; the active page is a black
 * pill with yellow text. Focus moves in on opening and back to the menu button on closing.
 */
function SideMenu({ items, onClose }: { items: typeof NAV; onClose: () => void }) {
  const { t } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; opener?.focus(); };
  }, [onClose]);
  const groups = [...APP_GROUPS, ...DATA_GROUPS].map((g) => ({ g, pages: items.filter((n) => n.group === g) })).filter((x) => x.pages.length);
  return (
    <div className="a-side-wrap">
      <div className="a-side-scrim" onClick={onClose} aria-hidden />
      <nav id="a-sidemenu" className="a-sidemenu" aria-label={t.portal.menu}>
        <div className="a-sidemenu-head">
          <button ref={close} type="button" className="a-sidemenu-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            <span className="sr-only">{t.portal.close}</span>
          </button>
        </div>
        <NavLink to="" end className="a-sidemenu-link">{t.portal.home}</NavLink>
        {groups.map(({ g, pages }) => (
          <section key={g} aria-labelledby={`sm-${g}`}>
            <h2 id={`sm-${g}`}><GroupIcon group={g} />{t.navGroups[g]}</h2>
            {pages.map((n) => <NavLink key={n.to} to={n.to} className="a-sidemenu-link">{t.nav[n.key]}</NavLink>)}
          </section>
        ))}
      </nav>
    </div>
  );
}

/**
 * The console's home: one card per app the person can open (by role, while the organisation has it
 * on), then the shared data and the settings. Each card opens its section.
 */
function PortalHome({ me, items }: { me: Me; items: typeof NAV }) {
  const { t } = useI18n();
  const P = t.portal;
  const first = me.displayName.trim().split(/\s+/)[0];
  const apps = APP_GROUPS.map((g) => ({ g, pages: items.filter((n) => n.group === g) })).filter((x) => x.pages.length);
  // Apps not in the organisation's service: the last tile of the grid says how to get them.
  const missing = APP_KEYS.filter((a) => !me.apps.includes(a));
  const showAdd = apps.length > 0 && missing.length > 0 && items.some((n) => n.to === 'apps');
  return (
    <div className="portal">
      <section className="portal-hero">
        <div>
          <h1>{P.hello.replace('{name}', first)}</h1>
          <p>{apps.length ? P.intro : P.noApps}</p>
        </div>
        {/* One Mo per screen: when the grid ends with the tile to add an app, Mo lives there. */}
        {!showAdd && <Mo size={112} mood={apps.length ? 'happy' : 'wink'} />}
      </section>
      {apps.length > 0 && (
        <section aria-labelledby="pt-apps">
          <h2 id="pt-apps" className="portal-h">{t.navApps}</h2>
          <ul className="portal-apps" role="list">
            {apps.map(({ g, pages }) => (
              <li key={g} className="portal-app">
                <NavLink to={pages[0].to} className="portal-app-main">
                  <span className="portal-icon" aria-hidden><GroupIcon group={g} /></span>
                  <h3>{t.navGroups[g]}</h3>
                  <p>{P.groupText[g as keyof typeof P.groupText]}</p>
                </NavLink>
                {pages.length > 1 && (
                  <div className="portal-links">
                    {pages.map((n) => <NavLink key={n.to} to={n.to}>{t.nav[n.key]}</NavLink>)}
                  </div>
                )}
              </li>
            ))}
            {showAdd && (
              <li className="portal-app portal-add">
                <NavLink to="apps" className="portal-app-main">
                  <span className="portal-add-icon" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 6v12M6 12h12" /></svg></span>
                  <h3>{P.addApp}</h3>
                  <p>{P.addAppText.replace('{apps}', missing.map((a) => t.apps.items[a].name).join(', '))}</p>
                  <Mo size={56} mood="wink" />
                </NavLink>
              </li>
            )}
          </ul>
        </section>
      )}
      {DATA_GROUPS.map((g) => {
        const pages = items.filter((n) => n.group === g);
        return pages.length > 0 && (
          <section key={g} aria-labelledby={`pt-${g}`}>
            <h2 id={`pt-${g}`} className="portal-h">{t.navGroups[g]}</h2>
            <ul className="portal-pages" role="list">
              {pages.map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} className="portal-page">
                    <strong>{t.nav[n.key]}</strong>
                    <span>{P.pageText[n.key as keyof typeof P.pageText]}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
