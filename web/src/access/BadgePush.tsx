import { useEffect, useState } from 'react';
import { lang, t } from './badge-strings';
import { Button, Switch } from './badge-ui';
import { me } from './BadgeInvites';

/**
 * "Tell me when a guest arrives" on the My badge page, with Web Push: the same card as in the
 * phone app. Works in Chrome, Edge and Firefox, and on iPhone only once the page is added to the
 * Home Screen (Apple's rule).
 */

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

export function ArrivalNotices({ token }: { token: string }) {
  const P = t.invites.push;
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null), () => setEndpoint(null)); }, []);

  if (!supported()) {
    return (
      <section className="mb-push" aria-label={P.label}>
        <div className="mb-push-row"><span className="mb-row-main"><strong>{P.label}</strong><small>{isIos() ? P.ios : P.unsupported}</small></span></div>
      </section>
    );
  }
  if (endpoint === undefined) return null;

  const turnOn = async () => {
    setBusy(true); setNote(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setNote(P.denied); return; }
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
    } catch { setNote(t.errors.generic); } finally { setBusy(false); }
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
      setNote(result === 'OK' ? P.testSent : t.errors.generic);
    } catch { setNote(t.errors.generic); } finally { setBusy(false); }
  };

  return (
    <section className="mb-push" aria-label={P.label}>
      <div className="mb-push-row">
        <span className="mb-row-main"><strong>{P.label}</strong><small>{P.hint}</small></span>
        <Switch checked={!!endpoint} disabled={busy} label={P.label} onChange={(on) => (on ? turnOn() : turnOff())} />
      </div>
      {endpoint && <Button label={P.test} kind="ghost" busy={busy} onClick={test} />}
      {note && <p className="mb-small" role="status">{note}</p>}
    </section>
  );
}
