import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, deviceToken } from '../lib/api';
import { applyBrand } from '../lib/theme';
import { CheckIn, CheckInResult } from './CheckIn';
import { CheckOut } from './CheckOut';
import { LOCALE_NAMES, Locale, STRINGS } from './strings';
import type { KioskConfig } from './types';

type Screen = { name: 'welcome' } | { name: 'checkin' } | { name: 'checkout' } | { name: 'done'; result: CheckInResult } | { name: 'outdone' };

const IDLE_MS = 90_000;        // abandoned form: wipe everything typed so far
const DONE_MS = 20_000;        // confirmation screens return home by themselves
const REFRESH_MS = 10 * 60_000; // pick up new notice versions and device revocation

export function KioskApp() {
  const [paired, setPaired] = useState(!!deviceToken.get());
  const [cfg, setCfg] = useState<KioskConfig | null>(null);
  const [offline, setOffline] = useState(false);
  const [locale, setLocale] = useState<Locale>('it');
  const [screen, setScreen] = useState<Screen>({ name: 'welcome' });
  const [session, setSession] = useState(0); // bump to remount flows = discard their state

  const loadConfig = useCallback(async () => {
    try {
      const c = await api.kiosk.get<KioskConfig>('/config');
      applyBrand(c.organisation); setCfg(c); setOffline(false);
      return c;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { deviceToken.clear(); setPaired(false); setCfg(null); }
      else setOffline(true);
      return null;
    }
  }, []);

  const goHome = useCallback(() => {
    setScreen({ name: 'welcome' });
    setSession((s) => s + 1);
    if (cfg) setLocale(cfg.policy.defaultLocale);
  }, [cfg]);

  useEffect(() => {
    if (!paired) return;
    loadConfig().then((c) => c && setLocale(c.policy.defaultLocale));
  }, [paired, loadConfig]);

  // Periodic refresh while idle on the welcome screen; retry quickly when offline.
  useEffect(() => {
    if (!paired || screen.name !== 'welcome') return;
    const h = setInterval(loadConfig, offline ? 15_000 : REFRESH_MS);
    return () => clearInterval(h);
  }, [paired, screen.name, offline, loadConfig]);

  // Inactivity reset: personal data never stays on an unattended screen.
  const idleTimer = useRef<number>();
  useEffect(() => {
    if (screen.name === 'welcome') return;
    const ms = screen.name === 'done' || screen.name === 'outdone' ? DONE_MS : IDLE_MS;
    const arm = () => { window.clearTimeout(idleTimer.current); idleTimer.current = window.setTimeout(goHome, ms); };
    arm();
    const events = ['pointerdown', 'keydown', 'input', 'scroll'] as const;
    events.forEach((ev) => window.addEventListener(ev, arm, { capture: true, passive: true }));
    return () => { window.clearTimeout(idleTimer.current); events.forEach((ev) => window.removeEventListener(ev, arm, { capture: true })); };
  }, [screen.name, goHome]);

  if (!paired) return <PairScreen onPaired={() => setPaired(true)} />;
  const t = STRINGS[locale];

  if (!cfg) {
    return (
      <div className="kiosk"><div /><main className="k-main">
        {offline ? <p className="alert" role="alert">{t.errors.offline}</p> : <p className="muted">…</p>}
      </main><div /></div>
    );
  }

  const langs = cfg.policy.locales;
  return (
    <div className="kiosk" lang={locale}>
      <header className="k-top">
        <span className="k-site">
          {cfg.organisation.logo ? <img src={cfg.organisation.logo} alt={cfg.organisation.name} className="k-logo" /> : <span className="k-org">{cfg.organisation.name}</span>}
          <span className="k-place">{cfg.site.name}</span>
        </span>
        {screen.name === 'welcome' && (
          <div className="k-right">
            {langs.length > 1 && (
              <nav className="k-langs" aria-label="Language">
                {langs.map((l) => <button key={l} type="button" className="k-lang" aria-pressed={l === locale} onClick={() => setLocale(l)} lang={l}>{LOCALE_NAMES[l]}</button>)}
              </nav>
            )}
            <Clock timezone={cfg.site.timezone} locale={locale} />
          </div>
        )}
      </header>

      <main className="k-main" key={session}>
        {offline && <p className="alert" role="alert">{t.errors.offline}</p>}

        {screen.name === 'welcome' && (
          <>
            <h1 className="k-title">{t.welcome}</h1>
            <p className="k-sub">{t.welcomeSub}</p>
            <div className="k-choices">
              <button type="button" className="k-choice in" onClick={() => setScreen({ name: 'checkin' })} disabled={!cfg.notices[locale]}>
                <span className="glyph" aria-hidden><Arrow dir="in" /></span><strong>{t.checkIn}</strong><span>{t.checkInSub}</span>
              </button>
              <button type="button" className="k-choice" onClick={() => setScreen({ name: 'checkout' })}>
                <span className="glyph" aria-hidden><Arrow dir="out" /></span><strong>{t.checkOut}</strong><span>{t.checkOutSub}</span>
              </button>
            </div>
          </>
        )}

        {screen.name === 'checkin' && (
          <CheckIn cfg={cfg} locale={locale} t={t} onCancel={goHome}
            onReloadConfig={async () => { await loadConfig(); }}
            onDone={(result) => setScreen({ name: 'done', result })} />
        )}

        {screen.name === 'checkout' && <CheckOut cfg={cfg} locale={locale} t={t} onCancel={goHome} onDone={() => setScreen({ name: 'outdone' })} />}

        {screen.name === 'done' && (
          <div className="k-done">
            <h1 className="k-h2">{t.doneTitle}</h1>
            <div className="badge-wrap" aria-live="polite">
              <div className="lanyard" aria-hidden />
              <div className="badge">
                <div className="slot" aria-hidden />
                <div className="who">{screen.result.label}</div>
                <div className="code-label" style={{ marginTop: 22 }}>{t.doneCode}</div>
                <div className="code">{screen.result.code}</div>
                <div className="site">{cfg.site.name}</div>
              </div>
            </div>
            <p style={{ maxWidth: 560, margin: 0 }}>{t.doneHint}</p>
            {screen.result.badgeEmailQueued && <p className="muted" style={{ margin: 0 }}>{t.doneBadgeEmail}</p>}
            {screen.result.emailQueued && <p className="muted" style={{ margin: 0 }}>{t.doneEmail}</p>}
            <button type="button" className="btn btn-primary" onClick={goHome}>{t.finish}</button>
          </div>
        )}

        {screen.name === 'outdone' && (
          <div className="k-done">
            <h1 className="k-title" style={{ fontSize: 44 }}>{t.outDone}</h1>
            <button type="button" className="btn btn-primary" onClick={goHome}>{t.finish}</button>
          </div>
        )}
      </main>

      <footer className="k-foot">{t.privacyFooter}</footer>
    </div>
  );
}

function Arrow({ dir }: { dir: 'in' | 'out' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'in' ? <path d="M5 12h13M13 6l6 6-6 6" /> : <path d="M19 12H6M11 6l-6 6 6 6" />}
    </svg>
  );
}

/** Local time of the site: a kiosk on a wall is also a clock people glance at. */
function Clock({ timezone, locale }: { timezone: string; locale: Locale }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(h); }, []);
  const loc = locale === 'en' ? 'en-GB' : locale;
  return (
    <div className="k-clock" aria-hidden>
      <strong>{new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(now)}</strong>
      <span>{new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(now)}</span>
    </div>
  );
}

/** One-time enrolment: an admin generates the code for this site from the console. */
function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api.kiosk.post<{ deviceToken: string }>('/pair', { code });
      deviceToken.set(r.deviceToken);
      onPaired();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Codice non valido o scaduto. / Código no válido o caducado.' : 'Connessione non disponibile. / Sin conexión.');
    } finally { setBusy(false); }
  };
  return (
    <div className="kiosk"><div />
      <main className="k-main k-pair">
        <h1 className="k-h2">Associa questo tablet</h1>
        <p className="muted" lang="es">Asocie esta tableta con la sede.</p>
        <p>Inserisci il codice di 8 caratteri generato dalla console di amministrazione (Tablet → Associa tablet).</p>
        <form className="k-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="pc">Codice di associazione</label>
            <input id="pc" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={9} autoComplete="off" autoCapitalize="characters" spellCheck={false} style={{ letterSpacing: '.2em', fontWeight: 700 }} />
          </div>
          {error && <p className="alert" role="alert">{error}</p>}
          <div><button className="btn btn-primary" disabled={busy || code.replace(/[^A-Z0-9]/g, '').length !== 8}>Associa</button></div>
        </form>
      </main><div />
    </div>
  );
}
