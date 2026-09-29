import { useCallback, useEffect, useRef, useState } from 'react';
import { QrScanner } from '../kiosk/QrScanner';
import { STRINGS } from '../kiosk/strings';
import { ApiError } from '../lib/api';
import { applyBrand } from '../lib/theme';
import { phoneBadgeCode, type NfcRecord } from './nfc-record';

/**
 * Door reader (Android tablet or phone at the door). Reads the phone badge QR with the camera and
 * NFC badges with Web NFC (Chrome on Android) or a USB reader that types the UID. Shows green or
 * red: opening a lock is out of scope for now.
 */

const TOKEN_KEY = 'rs_reader_token';
const token = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};
const BADGE_QR = /^(DRE1:[0-9a-f-]{36}\.\d{1,12}\.[0-9a-f]{16})$/;
const RESULT_MS = 3500;
const HEARTBEAT_MS = 60_000;
/** Fixed devices run for weeks: reload once a day (at night, when idle) to pick up new versions. */
const DAILY_RELOAD_HOUR = 3;

/**
 * Settings for a device fixed at a door: installs as its own full-screen app (/reader manifest),
 * keeps the screen on, and reloads once a day at night so it always runs the current version.
 */
function useUnattendedDevice() {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previous = link?.getAttribute('href');
    link?.setAttribute('href', '/manifest-reader.webmanifest');

    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const keepAwake = () => { if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined); };
    keepAwake();
    document.addEventListener('visibilitychange', keepAwake); // the lock is dropped when the page is hidden

    const started = Date.now();
    const daily = window.setInterval(() => {
      if (Date.now() - started > 20 * 3_600_000 && new Date().getHours() === DAILY_RELOAD_HOUR && !document.querySelector('.reader-verdict')) window.location.reload();
    }, 10 * 60_000);

    return () => {
      if (previous) link?.setAttribute('href', previous);
      document.removeEventListener('visibilitychange', keepAwake);
      lock?.release().catch(() => undefined);
      window.clearInterval(daily);
    };
  }, []);
}
/** A QR string only changes every 30 s: the same one again is the same person still in front of the camera. */
const SAME_QR_MS = 90_000;

interface Config { door: { name: string; active: boolean }; site: { name: string; timezone: string }; organisation: { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null } }
interface Verdict { result: 'GRANTED' | 'DENIED'; reason: string; name: string | null }

const REASONS: Record<string, string> = {
  UNKNOWN_CREDENTIAL: 'Badge non riconosciuto', QR_INVALID: 'QR non valido', QR_EXPIRED: 'QR scaduto: usa il badge sul telefono, non una foto',
  EMPLOYEE_INACTIVE: 'Badge disattivato', NOT_YET_VALID: 'Badge non ancora valido', EXPIRED: 'Badge scaduto', DOOR_INACTIVE: 'Porta disattivata',
  NO_PERMISSION: 'Nessun permesso per questa porta', OUTSIDE_SCHEDULE: 'Fuori dall’orario consentito', OFFLINE: 'Nessuna connessione: riprova',
  NFC_UNREADABLE: 'Tessera rilevata ma non leggibile da questo lettore: usa il QR sul telefono',
};

async function call<R>(method: string, path: string, body?: unknown): Promise<R> {
  const t = token.get();
  const r = await fetch(`/api/reader/${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, Array.isArray(data.message) ? data.message[0] : data.message ?? r.statusText);
  return data as R;
}

interface NfcReading { serialNumber: string; message?: { records: readonly NfcRecord[] } }
interface NfcPermissions { query: (d: { name: 'nfc' }) => Promise<{ state: string }> }
interface NfcReader { scan: (o?: { signal?: AbortSignal }) => Promise<void>; onreading: ((e: NfcReading) => void) | null; onreadingerror: (() => void) | null }
declare global { interface Window { NDEFReader?: new () => NfcReader } }

export function ReaderApp() {
  const [paired, setPaired] = useState(!!token.get());
  const [cfg, setCfg] = useState<Config | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try { const c = await call<Config>('GET', 'config'); applyBrand(c.organisation); setCfg(c); setOffline(false); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { token.clear(); setPaired(false); } else setOffline(true); }
  }, []);
  useEffect(() => { document.title = 'Lettore'; if (paired) load(); }, [paired, load]);
  // Heartbeat: the console shows a reader as offline when it stops calling in.
  useEffect(() => { if (!paired) return; const h = setInterval(load, offline ? 15_000 : HEARTBEAT_MS); return () => clearInterval(h); }, [paired, offline, load]);
  useUnattendedDevice();

  if (!paired) return <Pair onPaired={() => setPaired(true)} />;
  if (!cfg) return <div className="reader"><p className="reader-wait">{offline ? REASONS.OFFLINE : '…'}</p></div>;
  return <ReaderScreen cfg={cfg} />;
}

function ReaderScreen({ cfg }: { cfg: Config }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [round, setRound] = useState(0);
  const [nfc, setNfc] = useState<'unsupported' | 'off' | 'on' | 'error'>(() => (window.NDEFReader ? 'off' : 'unsupported'));
  const busy = useRef(false);
  const lastNfc = useRef({ uid: '', at: 0 });
  const lastQr = useRef({ qr: '', at: 0 });

  const [nfcNote, setNfcNote] = useState<string | null>(() => (window.NDEFReader ? null : 'Questo browser non legge le tessere NFC: serve Chrome su Android, oppure un lettore NFC USB collegato al dispositivo.'));

  const show = useCallback((v: Verdict) => {
    setVerdict(v);
    if (v.result === 'DENIED') navigator.vibrate?.([120, 80, 120]);
    window.setTimeout(() => { setVerdict(null); setRound((r) => r + 1); busy.current = false; }, RESULT_MS);
  }, []);

  const check = useCallback(async (body: { qr?: string; nfc?: string }) => {
    if (busy.current) return;
    busy.current = true;
    let v: Verdict;
    try { v = await call<Verdict>('POST', 'verify', body); } catch { v = { result: 'DENIED', reason: 'OFFLINE', name: null }; }
    show(v);
  }, [show]);

  const onUid = useCallback((uid: string) => {
    const now = Date.now();
    if (uid === lastNfc.current.uid && now - lastNfc.current.at < RESULT_MS + 1000) return; // badge left on the reader
    lastNfc.current = { uid, at: now };
    check({ nfc: uid });
  }, [check]);

  const onQr = useCallback((qr: string) => {
    const now = Date.now();
    if (qr === lastQr.current.qr && now - lastQr.current.at < SAME_QR_MS) {
      window.setTimeout(() => setRound((r) => r + 1), 700); // keep scanning, do not log the same passage twice
      return;
    }
    lastQr.current = { qr, at: now };
    check({ qr });
  }, [check]);

  // Web NFC must be started by a tap the first time (browser rule); once allowed it starts by itself.
  const startNfc = useCallback(async () => {
    try {
      const r = new window.NDEFReader!();
      r.onreading = (e) => {
        // A phone with the badge app carries the same rotating code as its QR: check it as a QR.
        const phone = phoneBadgeCode(e.message?.records);
        if (phone) onQr(phone);
        else if (e.serialNumber) onUid(e.serialNumber);
      };
      // Many access cards (MIFARE Classic, DESFire…) are not NDEF: the browser sees them but gives no UID.
      r.onreadingerror = () => { if (!busy.current) { busy.current = true; show({ result: 'DENIED', reason: 'NFC_UNREADABLE', name: null }); } };
      await r.scan();
      setNfc('on'); setNfcNote(null);
    } catch (e) {
      const name = (e as Error)?.name;
      setNfc('error');
      setNfcNote(name === 'NotAllowedError' ? 'Permesso NFC negato: consentilo dal lucchetto accanto all’indirizzo, poi ricarica la pagina.'
        : name === 'NotReadableError' || name === 'NotSupportedError' ? 'NFC spento o assente: attivalo nelle impostazioni del telefono (Connessioni → NFC), poi ricarica.'
        : 'NFC non disponibile su questo dispositivo.');
    }
  }, [onUid, onQr, show]);
  useEffect(() => {
    if (!window.NDEFReader) return;
    (navigator as Navigator & { permissions?: NfcPermissions }).permissions?.query({ name: 'nfc' })
      .then((p) => { if (p.state === 'granted') startNfc(); }).catch(() => undefined);
  }, [startNfc]);

  // USB NFC readers act as a keyboard: hex UID followed by Enter.
  useEffect(() => {
    let buf = '', last = 0;
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - last > 300) buf = '';
      last = now;
      if (e.key === 'Enter') { if (/^[0-9A-Fa-f:]{8,40}$/.test(buf)) onUid(buf); buf = ''; }
      else if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUid]);

  // Simulation (?simula=1): type a card UID instead of tapping a real card. Same verification and log.
  const demo = new URLSearchParams(window.location.search).has('simula');
  const [demoUid, setDemoUid] = useState('');

  const t = { ...STRINGS.it, scanTitle: 'Lettore QR', scanHint: 'Mostra il QR del badge sul telefono', scanWrong: 'Questo QR non è un badge dipendente', scanNoCamera: 'Fotocamera non disponibile: usa la tessera' };

  return (
    <div className="reader">
      <header className="reader-head">
        <div><strong>{cfg.door.name}</strong><span>{cfg.site.name} · {cfg.organisation.name}</span></div>
        {nfc === 'off' && <button type="button" className="btn btn-ghost btn-sm" onClick={startNfc}>Attiva tessere NFC</button>}
        {nfc === 'on' && <span className="reader-nfc">NFC attivo</span>}
        {nfc === 'error' && <span className="reader-nfc off">NFC non disponibile</span>}
      </header>
      <main className="reader-main">
        {!cfg.door.active && <p className="alert" role="alert">Porta disattivata dalla console</p>}
        <h1>Avvicina il badge</h1>
        <p className="muted">QR sul telefono alla fotocamera{nfc === 'on' ? ' oppure tessera sul retro del dispositivo' : ''}</p>
        {nfcNote && !demo && <p className="reader-note" role="status">{nfcNote}</p>}
        {demo && (
          <form className="reader-demo" onSubmit={(e) => { e.preventDefault(); const uid = demoUid.replace(/[^0-9A-Fa-f]/g, ''); if (uid.length >= 4) { lastNfc.current = { uid: '', at: 0 }; onUid(uid); } }}>
            <span className="reader-demo-tag">Simulazione</span>
            <label htmlFor="demo-uid">Codice della tessera (UID)</label>
            <div className="reader-demo-row">
              <input id="demo-uid" className="input" value={demoUid} onChange={(e) => setDemoUid(e.target.value.toUpperCase())} placeholder="es. 04A21B9C" maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
              <button className="btn btn-primary" disabled={demoUid.replace(/[^0-9A-Fa-f]/g, '').length < 4}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17" /></svg>
                Avvicina tessera
              </button>
            </div>
            <span className="muted">Usa lo stesso codice inviato con l’API nel campo badgeUid del dipendente. Un codice sconosciuto dà “Badge non riconosciuto”.</span>
          </form>
        )}
        <div style={{ visibility: verdict ? 'hidden' : 'visible' }}>
          <QrScanner key={round} onCode={onQr} t={t} accept={BADGE_QR} />
        </div>
      </main>
      {verdict && (
        <div className={`reader-verdict ${verdict.result === 'GRANTED' ? 'ok' : 'ko'}`} role="alert">
          <div className="reader-icon" aria-hidden>{verdict.result === 'GRANTED' ? '✓' : '✕'}</div>
          <div className="reader-title">{verdict.result === 'GRANTED' ? 'Accesso consentito' : 'Accesso negato'}</div>
          {verdict.name && <div className="reader-who">{verdict.name}</div>}
          {verdict.result === 'DENIED' && <div className="reader-why">{REASONS[verdict.reason] ?? verdict.reason}</div>}
        </div>
      )}
    </div>
  );
}

function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { token.set((await call<{ readerToken: string }>('POST', 'pair', { code })).readerToken); onPaired(); }
    catch (err) { setError(err instanceof ApiError && err.status === 401 ? 'Codice non valido o scaduto.' : 'Connessione non disponibile.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="reader"><main className="reader-main reader-pair">
      <h1>Associa questo lettore</h1>
      <p className="muted">Inserisci il codice di 8 caratteri generato in console (Porte e lettori → Associa lettore).</p>
      <form className="stack" onSubmit={submit}>
        <input className="input" name="pairing-code" translate="no" aria-label="Codice di associazione" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={9} pattern="[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}" required autoComplete="off" autoCapitalize="characters" spellCheck={false} style={{ letterSpacing: '.2em', fontWeight: 700, fontSize: 24 }} />
        {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>Associa</button>
      </form>
    </main></div>
  );
}
