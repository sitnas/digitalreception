import { useEffect, useState } from 'react';
import { me } from './BadgeInvites';

/**
 * "Tell me when a guest arrives" on the My badge page, with Web Push. Works in Chrome, Edge and
 * Firefox, and on iPhone only once the page is added to the Home Screen (Apple's rule).
 */

type Lang = 'it' | 'es' | 'en';
const STRINGS = {
  it: {
    label: 'Avvisami quando arriva un ospite', hint: 'Una notifica su questo telefono quando un tuo ospite fa check-in al tablet della reception.',
    on: 'Attiva', off: 'Disattiva', test: 'Manda una prova', testSent: 'Prova inviata: arriva tra pochi secondi.',
    denied: 'Il browser blocca le notifiche di questo sito: sbloccale dalle impostazioni del sito, poi riprova.',
    ios: 'Su iPhone le notifiche arrivano solo dalla schermata Home: tocca Condividi → Aggiungi alla schermata Home, apri il badge da lì e attivale.',
    unsupported: 'Questo browser non riceve notifiche dalle pagine web. Prova con Chrome, oppure usa l’app Il mio badge.',
    error: 'Non è andata a buon fine. Riprova tra qualche secondo.',
  },
  es: {
    label: 'Avisarme cuando llegue una visita', hint: 'Una notificación en este teléfono cuando una visita suya se registre en la tableta de recepción.',
    on: 'Activar', off: 'Desactivar', test: 'Enviar una prueba', testSent: 'Prueba enviada: llega en unos segundos.',
    denied: 'El navegador bloquea las notificaciones de este sitio: desbloquéelas en los ajustes del sitio y vuelva a intentarlo.',
    ios: 'En iPhone las notificaciones solo llegan desde la pantalla de inicio: toque Compartir → Añadir a pantalla de inicio, abra la credencial desde ahí y actívelas.',
    unsupported: 'Este navegador no recibe notificaciones de páginas web. Pruebe con Chrome o use la app Mi credencial.',
    error: 'No ha funcionado. Inténtelo de nuevo en unos segundos.',
  },
  en: {
    label: 'Tell me when a guest arrives', hint: 'A notification on this phone when one of your guests checks in at the reception tablet.',
    on: 'Turn on', off: 'Turn off', test: 'Send a test', testSent: 'Test sent: it arrives in a few seconds.',
    denied: 'The browser blocks notifications from this site: unblock them in the site settings, then try again.',
    ios: 'On iPhone notifications only work from the Home Screen: tap Share → Add to Home Screen, open the badge from there and turn them on.',
    unsupported: 'This browser cannot receive notifications from web pages. Try Chrome, or use the My badge app.',
    error: 'That didn’t work. Try again in a few seconds.',
  },
};

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registration() {
  await navigator.serviceWorker.register('/sw.js', { scope: '/badge' });
  return navigator.serviceWorker.ready;
}

async function currentSubscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/badge');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** When the badge leaves this phone: stop the notices here too (best effort, the server forgets it anyway). */
export async function forgetWebPush(token: string | undefined) {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    if (token) await me(token, '/push', { method: 'DELETE', body: JSON.stringify({ kind: 'web', target: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe();
  } catch { /* nothing to undo */ }
}

export function ArrivalNotices({ token, lang }: { token: string; lang: Lang }) {
  const T = STRINGS[lang];
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null), () => setEndpoint(null)); }, []);

  if (!supported()) {
    return <section className="push-card stack" aria-label={T.label}><strong>{T.label}</strong><p className="muted">{isIos() ? T.ios : T.unsupported}</p></section>;
  }
  if (endpoint === undefined) return null;

  const turnOn = async () => {
    setBusy(true); setNote(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setNote(T.denied); return; }
      const reg = await registration();
      const { webPushKey } = await me<{ webPushKey: string }>(token, '/push');
      const options = { userVisibleOnly: true, applicationServerKey: keyBytes(webPushKey) };
      let sub: PushSubscription;
      try { sub = await reg.pushManager.subscribe(options); }
      catch {
        // An old subscription made with another server key: drop it and subscribe again.
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        sub = await reg.pushManager.subscribe(options);
      }
      await me(token, '/push', { method: 'POST', body: JSON.stringify({ kind: 'web', subscription: sub.toJSON(), locale: lang }) });
      setEndpoint(sub.endpoint);
    } catch { setNote(T.error); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true); setNote(null);
    await forgetWebPush(token);
    setEndpoint(null); setBusy(false);
  };
  const test = async () => {
    if (!endpoint) return;
    setBusy(true);
    try {
      const { result } = await me<{ result: string }>(token, '/push/test', { method: 'POST', body: JSON.stringify({ kind: 'web', target: endpoint }) });
      setNote(result === 'OK' ? T.testSent : T.error);
    } catch { setNote(T.error); } finally { setBusy(false); }
  };

  return (
    <section className="push-card stack" aria-label={T.label}>
      <label className="toggle push-toggle">
        <input type="checkbox" role="switch" checked={!!endpoint} disabled={busy} aria-busy={busy} aria-describedby="push-hint" onChange={(e) => (e.target.checked ? turnOn() : turnOff())} />
        <span><strong>{T.label}</strong><small id="push-hint" className="muted">{T.hint}</small></span>
      </label>
      {endpoint && <button type="button" className="btn btn-ghost btn-sm" onClick={test} disabled={busy}>{T.test}</button>}
      <p role="status" aria-live="polite" className="muted" style={{ margin: 0 }}>{note}</p>
    </section>
  );
}
