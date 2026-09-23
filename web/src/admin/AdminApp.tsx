import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { ADMIN_STRINGS, AdminLocale, I18nContext, useI18n } from './i18n';
import { AuditPage } from './pages/Audit';
import { DevicesPage } from './pages/Devices';
import { HistoryPage } from './pages/History';
import { HostsPage } from './pages/Hosts';
import { OrganisationPage } from './pages/Organisation';
import { PrivacyPage } from './pages/Privacy';
import { SitesPage } from './pages/Sites';
import { TodayPage } from './pages/Today';
import { UsersPage } from './pages/Users';
import type { Me, Role } from './types';

interface Branding { name: string; logo: string | null }
const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

const LOCALE_KEY = 'rs_admin_locale';
function initialLocale(): AdminLocale {
  try { const s = localStorage.getItem(LOCALE_KEY); if (s === 'it' || s === 'es') return s; } catch { /* ignore */ }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'it';
}

const NAV: { to: string; key: keyof typeof ADMIN_STRINGS.it.nav; roles: Role[] }[] = [
  { to: 'today', key: 'today', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'history', key: 'history', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'RECEPTIONIST', 'AUDITOR'] },
  { to: 'sites', key: 'sites', roles: ['SUPER_ADMIN'] },
  { to: 'devices', key: 'devices', roles: ['SUPER_ADMIN', 'SITE_MANAGER'] },
  { to: 'hosts', key: 'hosts', roles: ['SUPER_ADMIN', 'SITE_MANAGER'] },
  { to: 'users', key: 'users', roles: ['SUPER_ADMIN'] },
  { to: 'privacy', key: 'privacy', roles: ['SUPER_ADMIN', 'SITE_MANAGER', 'AUDITOR'] },
  { to: 'audit', key: 'audit', roles: ['SUPER_ADMIN', 'AUDITOR'] },
  { to: 'organisation', key: 'org', roles: ['SUPER_ADMIN'] },
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
    api.get<Branding>('/tenant').then(setBranding).catch((e) => setFatal(e instanceof ApiError ? e.code : 'offline'));
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
  return <div className="login"><div className="alert" role="alert" style={{ maxWidth: 480 }}>{msg}</div></div>;
}

function Brand({ branding }: { branding: Branding }) {
  return (
    <div className="a-brand">
      {branding.logo ? <img src={branding.logo} alt="" /> : <img src="/icon.svg" alt="" />}
      <span>{branding.name}</span>
    </div>
  );
}

function LangSwitch() {
  const { t, locale, setLocale } = useI18n();
  return (
    <label className="inline" style={{ fontSize: 13 }}>
      <span className="muted">{t.language}</span>
      <select className="input" style={{ minHeight: 32, width: 'auto', padding: '2px 8px', borderWidth: 1 }} value={locale} onChange={(e) => setLocale(e.target.value as AdminLocale)}>
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
    <div className="login">
      <form onSubmit={submit}>
        <Brand branding={branding} />
        <h1>{t.login.title}</h1>
        <div className="field"><label htmlFor="em">{t.login.email}</label><input id="em" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw">{t.login.password}</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p className="alert" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{t.login.submit}</button>
        <LangSwitch />
      </form>
    </div>
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
    <div className="login">
      <form onSubmit={submit}>
        <Brand branding={branding} />
        <h1>{t.pwd.title}</h1>
        <p className="muted" style={{ margin: 0 }}>{t.pwd.intro}</p>
        <div className="field"><label htmlFor="c">{t.pwd.current}</label><input id="c" className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></div>
        <div className="field"><label htmlFor="n">{t.pwd.next}</label><input id="n" className="input" type="password" autoComplete="new-password" minLength={12} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /><span className="hint">{t.pwd.hint}</span></div>
        <div className="field"><label htmlFor="r">{t.pwd.confirm}</label><input id="r" className="input" type="password" autoComplete="new-password" minLength={12} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></div>
        {error && <p className="alert" role="alert">{error}</p>}
        {done && <p className="alert alert-info" role="status">{t.pwd.done}</p>}
        <button className="btn btn-primary" disabled={done}>{t.pwd.submit}</button>
      </form>
    </div>
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
          {items.map((n) => <NavLink key={n.to} to={n.to}>{t.nav[n.key]}</NavLink>)}
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
          {items.some((i) => i.to === 'history') && <Route path="history" element={<HistoryPage />} />}
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
