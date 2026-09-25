import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { applyBrand } from '../lib/theme';
import { ADMIN_STRINGS, AdminLocale, I18nContext, useI18n } from './i18n';
import { AuditPage } from './pages/Audit';
import { DevicesPage } from './pages/Devices';
import { HistoryPage } from './pages/History';
import { InvitationsPage } from './pages/Invitations';
import { AccessLogPage, DoorsPage, EmployeesPage, IntegrationPage } from './pages/Access';
import { HostsPage } from './pages/Hosts';
import { OrganisationPage } from './pages/Organisation';
import { PrivacyPage } from './pages/Privacy';
import { SitesPage } from './pages/Sites';
import { StatsPage } from './pages/Stats';
import { TodayPage } from './pages/Today';
import { UsersPage } from './pages/Users';
import type { Me, Role } from './types';

interface Branding { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null }
const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

const LOCALE_KEY = 'rs_admin_locale';
function initialLocale(): AdminLocale {
  try { const s = localStorage.getItem(LOCALE_KEY); if (s === 'it' || s === 'es') return s; } catch { /* ignore */ }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'it';
}

type NavGroup = keyof typeof ADMIN_STRINGS.it.navGroups;
const NAV: { to: string; key: keyof typeof ADMIN_STRINGS.it.nav; group: NavGroup; roles: Role[] }[] = [
  { to: 'today', key: 'today', group: 'visits', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'invites', key: 'invites', group: 'visits', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'history', key: 'history', group: 'visits', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'stats', key: 'stats', group: 'visits', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'employees', key: 'employees', group: 'access', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'doors', key: 'doors', group: 'access', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'access-log', key: 'accessLog', group: 'access', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'integration', key: 'integration', group: 'access', roles: ['SUPER_ADMIN'] },
  { to: 'sites', key: 'sites', group: 'setup', roles: ['SUPER_ADMIN'] },
  { to: 'devices', key: 'devices', group: 'setup', roles: ['SUPER_ADMIN', 'SITE_MANAGER'] },
  { to: 'hosts', key: 'hosts', group: 'setup', roles: ['SUPER_ADMIN', 'SITE_MANAGER'] },
  { to: 'users', key: 'users', group: 'setup', roles: ['SUPER_ADMIN'] },
  { to: 'privacy', key: 'privacy', group: 'compliance', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'audit', key: 'audit', group: 'compliance', roles: ['SUPER_ADMIN', 'AUDITOR'] },
  { to: 'organisation', key: 'org', group: 'setup', roles: ['SUPER_ADMIN'] },
];

export function AdminApp() {
  const [locale, setLocaleState] = useState<AdminLocale>(initialLocale);
  const setLocale = (l: AdminLocale) => { setLocaleState(l); try { localStorage.setItem(LOCALE_KEY, l); } catch { /* ignore */ } };
  const i18n = useMemo(() => ({ t: ADMIN_STRINGS[locale], locale, intl: locale === 'es' ? 'es-ES' : 'it-IT', setLocale }), [locale]);
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

  useEffect(() => { document.title = branding ? `${ADMIN_STRINGS[locale].appName} · ${branding.name}` : 'Reception'; }, [branding, locale]);

  return (
    <I18nContext.Provider value={i18n}>
      {fatal ? <FatalScreen code={fatal} /> :
        me === null || !branding ? null :
        me === 'anon' ? <LoginScreen branding={branding} onLoggedIn={loadMe} /> :
        me.mustChangePassword ? <ChangePasswordScreen branding={branding} onDone={() => setMe('anon')} /> :
        <MeContext.Provider value={me}><Shell branding={branding} me={me} onLogout={() => setMe('anon')} /></MeContext.Provider>}
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
      <img src={branding.logo ?? '/icon.svg'} alt="" className={branding.logo ? 'logo' : undefined} />
      <span>{branding.name}</span>
    </div>
  );
}

/** Line icons for the menu sections (24px grid, drawn with currentColor). */
function GroupIcon({ group }: { group: NavGroup }) {
  const paths: Record<NavGroup, React.ReactNode> = {
    visits: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></>,
    setup: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2.2" /><circle cx="8" cy="17" r="2.2" /></>,
    access: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><circle cx="15" cy="12.5" r="1.1" /><path d="M9 3v18" /></>,
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
      <select className="input" style={{ height: 32, width: 'auto', fontSize: 13 }} value={locale} onChange={(e) => setLocale(e.target.value as AdminLocale)}>
        <option value="it">Italiano</option><option value="es">Español</option>
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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.post('/auth/login', { email, password }); setPassword(''); onLoggedIn(); }
    catch (err) { setError(err instanceof ApiError && err.status === 401 ? t.login.invalid : err instanceof ApiError && err.status === 429 ? t.login.invalid : t.errors.generic); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout branding={branding}>
      <form onSubmit={submit}>
        <h1>{t.login.title}</h1>
        <div className="field"><label htmlFor="em">{t.login.email}</label><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw">{t.login.password}</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p className="alert" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{t.login.submit}</button>
        <LangSwitch />
      </form>
    </AuthLayout>
  );
}

function ChangePasswordScreen({ branding, onDone }: { branding: Branding; onDone: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (f.next !== f.confirm) { setError(t.pwd.mismatch); return; }
    try { await api.post('/auth/password', { currentPassword: f.current, newPassword: f.next }); setDone(true); setTimeout(onDone, 1500); }
    catch (err) { setError(err instanceof ApiError && err.status === 401 ? t.pwd.wrong : t.errors.generic); }
  };
  return (
    <AuthLayout branding={branding}>
      <form onSubmit={submit}>
        <h1>{t.pwd.title}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.pwd.intro}</p>
        <div className="field"><label htmlFor="c">{t.pwd.current}</label><input id="c" className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></div>
        <div className="field"><label htmlFor="n">{t.pwd.next}</label><input id="n" className="input" type="password" autoComplete="new-password" minLength={12} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /><span className="hint">{t.pwd.hint}</span></div>
        <div className="field"><label htmlFor="r">{t.pwd.confirm}</label><input id="r" className="input" type="password" autoComplete="new-password" minLength={12} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></div>
        {error && <p className="alert" role="alert">{error}</p>}
        {done && <p className="alert alert-info" role="status">{t.pwd.done}</p>}
        <button className="btn btn-primary" disabled={done}>{t.pwd.submit}</button>
      </form>
    </AuthLayout>
  );
}

function Shell({ branding, me, onLogout }: { branding: Branding; me: Me; onLogout: () => void }) {
  const { t } = useI18n();
  const items = NAV.filter((n) => n.roles.includes(me.role));
  const logout = async () => { try { await api.post('/auth/logout'); } finally { onLogout(); } };
  const home = items[0]?.to ?? 'today';
  return (
    <div className="admin">
      <aside className="a-side">
        <Brand branding={branding} />
        <nav className="a-nav" aria-label="Menu">
          {(Object.keys(t.navGroups) as NavGroup[]).map((g) => {
            const group = items.filter((n) => n.group === g);
            return group.length > 0 && (
              <div key={g} className="a-nav a-nav-section" role="group" aria-label={t.navGroups[g]}>
                <span className="a-nav-group" aria-hidden><GroupIcon group={g} />{t.navGroups[g]}</span>
                {group.map((n) => <NavLink key={n.to} to={n.to}>{t.nav[n.key]}</NavLink>)}
              </div>
            );
          })}
        </nav>
        <div className="a-me">
          <strong>{me.displayName}</strong>
          <span>{t.roles[me.role]}</span>
          <LangSwitch />
          <button type="button" className="btn-link" onClick={logout} style={{ justifySelf: 'start' }}>{t.logout}</button>
        </div>
      </aside>
      <main className="a-main">
        <Routes>
          <Route index element={<Navigate to={home} replace />} />
          {items.some((i) => i.to === 'today') && <Route path="today" element={<TodayPage />} />}
          {items.some((i) => i.to === 'invites') && <Route path="invites" element={<InvitationsPage />} />}
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
          {items.some((i) => i.to === 'organisation') && <Route path="organisation" element={<OrganisationPage />} />}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}
