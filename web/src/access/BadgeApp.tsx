import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../lib/api';
import { applyBrand } from '../lib/theme';

/**
 * "My badge" on the employee's phone. After a one-time email code the phone keeps a secret and
 * draws a QR that changes every 30 seconds (HMAC of the time step): a screenshot stops working
 * within a minute. Everything is computed on the phone, it works without network at the door.
 */

interface Badge { employeeId: string; secret: string; step: number; organisation: string; firstName: string; lastName: string }
const KEY = 'rs_badge';
const load = (): Badge | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const save = (b: Badge | null) => { try { if (b) localStorage.setItem(KEY, JSON.stringify(b)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };

type Lang = 'it' | 'es' | 'en';
const lang: Lang = (['it', 'es', 'en'] as const).find((l) => navigator.language.toLowerCase().startsWith(l)) ?? 'en';
const T = {
  it: { title: 'Il mio badge', intro: 'Attiva il badge sul telefono con la tua email di lavoro: ti mandiamo un codice.', email: 'Email di lavoro', send: 'Inviami il codice', sent: 'Se l’indirizzo è registrato, riceverai un codice di 6 cifre entro un minuto. Controlla anche lo spam.', code: 'Codice ricevuto', activate: 'Attiva il badge', back: 'Cambia email', hint: 'Mostra il QR al lettore della porta. Cambia ogni 30 secondi: foto e screenshot non funzionano.', remove: 'Rimuovi il badge da questo telefono', removeConfirm: 'Rimuovere il badge da questo telefono? Per usarlo di nuovo dovrai chiedere un nuovo codice.', next: 'Nuovo codice tra', errors: { CODE_INVALID: 'Codice non valido o scaduto. Chiedine uno nuovo.', generic: 'Operazione non riuscita. Riprova.', offline: 'Connessione non disponibile.' } },
  es: { title: 'Mi credencial', intro: 'Active la credencial en el teléfono con su correo de trabajo: le enviamos un código.', email: 'Correo de trabajo', send: 'Enviarme el código', sent: 'Si la dirección está registrada, recibirá un código de 6 cifras en un minuto. Revise también el spam.', code: 'Código recibido', activate: 'Activar la credencial', back: 'Cambiar correo', hint: 'Muestre el QR al lector de la puerta. Cambia cada 30 segundos: fotos y capturas no funcionan.', remove: 'Quitar la credencial de este teléfono', removeConfirm: '¿Quitar la credencial de este teléfono? Para usarla de nuevo tendrá que pedir un código nuevo.', next: 'Nuevo código en', errors: { CODE_INVALID: 'Código no válido o caducado. Pida uno nuevo.', generic: 'No se pudo completar. Inténtelo de nuevo.', offline: 'Sin conexión.' } },
  en: { title: 'My badge', intro: 'Activate the badge on your phone with your work email: we will send you a code.', email: 'Work email', send: 'Send me the code', sent: 'If the address is registered, you will receive a 6-digit code within a minute. Check your spam folder too.', code: 'Code received', activate: 'Activate badge', back: 'Change email', hint: 'Show the QR to the door reader. It changes every 30 seconds: photos and screenshots do not work.', remove: 'Remove the badge from this phone', removeConfirm: 'Remove the badge from this phone? To use it again you will need a new code.', next: 'New code in', errors: { CODE_INVALID: 'Invalid or expired code. Ask for a new one.', generic: 'Something went wrong. Try again.', offline: 'No connection.' } },
}[lang];

async function post<R>(path: string, body: unknown): Promise<R> {
  const r = await fetch(`/api/badge/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
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

export function BadgeApp() {
  const [badge, setBadge] = useState<Badge | null>(load);
  useEffect(() => {
    document.title = T.title;
    // The organisation's colours, also before activation (public endpoint, no personal data).
    fetch('/api/tenant').then((r) => (r.ok ? r.json() : null)).then((b) => b && applyBrand(b)).catch(() => undefined);
  }, []);
  return (
    <div className="badge-app">
      {badge ? <BadgeView badge={badge} onRemove={() => { save(null); setBadge(null); }} /> : <Activate onDone={(b) => { save(b); setBadge(b); }} />}
    </div>
  );
}

function Activate({ onDone }: { onDone: (b: Badge) => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof ApiError ? (T.errors as Record<string, string>)[e.code] ?? T.errors.generic : T.errors.offline);

  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await post('request', { email: email.trim(), locale: lang }); setSent(true); } catch (err) { fail(err); } finally { setBusy(false); }
  };
  const activate = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onDone(await post<Badge>('activate', { email: email.trim(), code })); } catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <main className="badge-card stack">
      <h1>{T.title}</h1>
      <p className="muted" style={{ margin: 0 }}>{sent ? T.sent : T.intro}</p>
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      {!sent ? (
        <form className="stack" onSubmit={request}>
          <div className="field"><label htmlFor="be">{T.email}</label><input id="be" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <button className="btn btn-primary" disabled={busy}>{busy ? '…' : T.send}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={activate}>
          <div className="field"><label htmlFor="bc">{T.code}</label><input id="bc" className="input badge-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></div>
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? '…' : T.activate}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setSent(false); setCode(''); setError(null); }}>{T.back}</button>
        </form>
      )}
    </main>
  );
}

function BadgeView({ badge, onRemove }: { badge: Badge; onRemove: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [svg, setSvg] = useState('');
  const step = Math.floor(now / 1000 / badge.step);
  const left = badge.step - (Math.floor(now / 1000) % badge.step);

  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  useEffect(() => {
    let alive = true;
    sign(badge.secret, `${badge.employeeId}.${step}`)
      .then((sig) => QRCode.toString(`DRE1:${badge.employeeId}.${step}.${sig}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }))
      .then((s) => { if (alive) setSvg(s); });
    return () => { alive = false; };
  }, [badge, step]);
  // Keep the screen on while the badge is shown (where the browser allows it).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    return () => { lock?.release().catch(() => undefined); };
  }, []);
  const src = useMemo(() => (svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : ''), [svg]);

  return (
    <main className="badge-card badge-live">
      <div className="badge-org">{badge.organisation}</div>
      <div className="badge-name">{badge.firstName} {badge.lastName}</div>
      <div className="badge-qr-box">{src && <img src={src} alt="QR" />}</div>
      <div className="badge-timer" aria-live="off">
        <span className="badge-timer-bar" style={{ width: `${(left / badge.step) * 100}%` }} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>{T.next} {left}s</p>
      <p style={{ margin: 0 }}>{T.hint}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm(T.removeConfirm)) onRemove(); }}>{T.remove}</button>
    </main>
  );
}
