import { useCallback, useEffect, useRef, useState } from 'react';
import { QrScanner } from '../kiosk/QrScanner';
import { STRINGS } from '../kiosk/strings';
import { ApiError } from '../lib/api';
import { applyBrand } from '../lib/theme';

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
/** A QR string only changes every 30 s: the same one again is the same person still in front of the camera. */
const SAME_QR_MS = 90_000;

interface Config { door: { name: string; active: boolean }; site: { name: string; timezone: string }; organisation: { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null } }
interface Verdict { result: 'GRANTED' | 'DENIED'; reason: string; name: string | null }

const REASONS: Record<string, string> = {
  UNKNOWN_CREDENTIAL: 'Badge non riconosciuto', QR_INVALID: 'QR non valido', QR_EXPIRED: 'QR scaduto: usa il badge sul telefono, non una foto',
  EMPLOYEE_INACTIVE: 'Badge disattivato', NOT_YET_VALID: 'Badge non ancora valido', EXPIRED: 'Badge scaduto', DOOR_INACTIVE: 'Porta disattivata',
  NO_PERMISSION: 'Nessun permesso per questa porta', OUTSIDE_SCHEDULE: 'Fuori dall’orario consentito', OFFLINE: 'Nessuna connessione: riprova',
};

async function call<R>(method: string, path: string, body?: unknown): Promise<R> {
  const t = token.get();
  const r = await fetch(`/api/reader/${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, Array.isArray(data.message) ? data.message[0] : data.message ?? r.statusText);
  return data as R;
}

interface NfcReading { serialNumber: string }
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
  useEffect(() => { if (!paired) return; const h = setInterval(load, offline ? 15_000 : 5 * 60_000); return () => clearInterval(h); }, [paired, offline, load]);

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

  const check = useCallback(async (body: { qr?: string; nfc?: string }) => {
    if (busy.current) return;
    busy.current = true;
    let v: Verdict;
    try { v = await call<Verdict>('POST', 'verify', body); } catch { v = { result: 'DENIED', reason: 'OFFLINE', name: null }; }
    setVerdict(v);
    if (v.result === 'DENIED') navigator.vibrate?.([120, 80, 120]);
    window.setTimeout(() => { setVerdict(null); setRound((r) => r + 1); busy.current = false; }, RESULT_MS);
  }, []);

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

  // Web NFC must be started by a tap (browser rule); after that every badge is read in the background.
  const startNfc = async () => {
    try {
      const r = new window.NDEFReader!();
      r.onreading = (e) => { if (e.serialNumber) onUid(e.serialNumber); };
      r.onreadingerror = () => undefined;
      await r.scan();
      setNfc('on');
    } catch { setNfc('error'); }
  };

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
        <p className="muted">QR sul telefono alla fotocamera{nfc !== 'unsupported' ? ' oppure tessera sul retro' : ''}</p>
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
        <input className="input" aria-label="Codice di associazione" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={9} autoComplete="off" autoCapitalize="characters" spellCheck={false} style={{ letterSpacing: '.2em', fontWeight: 700, fontSize: 24 }} />
        {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" disabled={busy || code.replace(/[^A-Z0-9]/g, '').length !== 8}>Associa</button>
      </form>
    </main></div>
  );
}
