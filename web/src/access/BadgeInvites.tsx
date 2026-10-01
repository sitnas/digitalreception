import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { ArrivalNotices } from './BadgePush';

/**
 * Invitations on the "My badge" page, for employees who are also people to visit: the same
 * screens as the phone app (list, new invitation, QR and code to forward, cancel).
 */

type Lang = 'it' | 'es' | 'en';
const PURPOSES = ['MEETING', 'INTERVIEW', 'SUPPLIER', 'MAINTENANCE', 'DELIVERY', 'OTHER'] as const;
type Purpose = (typeof PURPOSES)[number];
type Status = 'PENDING' | 'USED' | 'CANCELLED' | 'EXPIRED';
interface Site { id: string; name: string; timezone: string }
export interface Profile { canInvite: boolean; sites: Site[]; organisation: string; firstName: string }
interface Invite { id: string; siteName: string; timezone: string; expectedAt: string; purpose: Purpose; firstName: string; lastName: string; company: string | null; email: string; status: Status; emailStatus: string }

const STRINGS = {
  it: {
    open: 'I miei inviti', title: 'I miei inviti', back: 'Torna al badge', list: 'Torna agli inviti', new: 'Nuovo invito',
    none: 'Nessun ospite atteso. Crea un invito: l’ospite riceve un’email con un QR e alla reception tocca “Ho un invito”.',
    firstName: 'Nome', lastName: 'Cognome', company: 'Azienda (facoltativo)', email: 'Email dell’ospite', site: 'Sede', day: 'Giorno', time: 'Ora', purpose: 'Motivo',
    create: 'Crea invito', created: 'Invito creato.', emailSent: 'L’ospite riceve un’email con il QR. Puoi anche mandargli tu il codice.', emailOff: 'L’invio email non è attivo: manda tu il codice all’ospite.',
    code: 'Codice', share: 'Condividi con l’ospite', copied: 'Testo copiato: incollalo in un messaggio.', cancel: 'Annulla invito', cancelConfirm: 'Annullare l’invito? Il codice smette di funzionare.',
    reactivate: 'Per invitare ospiti da qui rimuovi il badge e attivalo di nuovo: serve una sola volta.',
    status: { PENDING: 'Atteso', USED: 'Arrivato', CANCELLED: 'Annullato', EXPIRED: 'Non arrivato' },
    purposes: { MEETING: 'Riunione', INTERVIEW: 'Colloquio', SUPPLIER: 'Fornitore', MAINTENANCE: 'Manutenzione', DELIVERY: 'Consegna', OTHER: 'Altro' },
    shareText: 'Ciao {firstName}, ti aspetto {when} da {organisation}, sede di {site}. All’arrivo tocca “Ho un invito” sul tablet della reception e mostra il QR dell’email, oppure scrivi il codice {code}. A presto, {host}',
    errors: { INVITATION_IN_PAST: 'Quel giorno è già passato.', INVITATION_TOO_FAR: 'Puoi invitare fino a 90 giorni in anticipo.', NOT_A_HOST: 'Non sei più tra le persone da visitare: chiedi alla reception.', NOT_A_HOST_HERE: 'In questa sede non ricevi visite.', generic: 'Operazione non riuscita. Controlla i dati e riprova.', offline: 'Connessione non disponibile.' },
  },
  es: {
    open: 'Mis invitaciones', title: 'Mis invitaciones', back: 'Volver a la credencial', list: 'Volver a las invitaciones', new: 'Nueva invitación',
    none: 'No espera a nadie. Cree una invitación: el invitado recibe un correo con un QR y en recepción toca «Tengo una invitación».',
    firstName: 'Nombre', lastName: 'Apellidos', company: 'Empresa (opcional)', email: 'Correo del invitado', site: 'Sede', day: 'Día', time: 'Hora', purpose: 'Motivo',
    create: 'Crear invitación', created: 'Invitación creada.', emailSent: 'El invitado recibe un correo con el QR. También puede enviarle usted el código.', emailOff: 'El envío de correo no está activo: envíe usted el código al invitado.',
    code: 'Código', share: 'Compartir con el invitado', copied: 'Texto copiado: péguelo en un mensaje.', cancel: 'Cancelar invitación', cancelConfirm: '¿Cancelar la invitación? El código deja de funcionar.',
    reactivate: 'Para invitar desde aquí, quite la credencial y actívela de nuevo: solo una vez.',
    status: { PENDING: 'Esperado', USED: 'Llegó', CANCELLED: 'Cancelada', EXPIRED: 'No llegó' },
    purposes: { MEETING: 'Reunión', INTERVIEW: 'Entrevista', SUPPLIER: 'Proveedor', MAINTENANCE: 'Mantenimiento', DELIVERY: 'Entrega', OTHER: 'Otro' },
    shareText: 'Hola {firstName}, le espero {when} en {organisation}, sede de {site}. Al llegar toque «Tengo una invitación» en la tableta de recepción y muestre el QR del correo, o escriba el código {code}. Hasta pronto, {host}',
    errors: { INVITATION_IN_PAST: 'Ese día ya ha pasado.', INVITATION_TOO_FAR: 'Puede invitar hasta 90 días antes.', NOT_A_HOST: 'Ya no está entre las personas a visitar: pregunte en recepción.', NOT_A_HOST_HERE: 'En esta sede no recibe visitas.', generic: 'No se pudo completar. Revise los datos e inténtelo de nuevo.', offline: 'Sin conexión.' },
  },
  en: {
    open: 'My invitations', title: 'My invitations', back: 'Back to the badge', list: 'Back to invitations', new: 'New invitation',
    none: 'No guests expected. Create an invitation: the guest receives an email with a QR and taps “I have an invitation” at reception.',
    firstName: 'First name', lastName: 'Last name', company: 'Company (optional)', email: 'Guest’s email', site: 'Site', day: 'Day', time: 'Time', purpose: 'Reason',
    create: 'Create invitation', created: 'Invitation created.', emailSent: 'The guest receives an email with the QR. You can also send them the code yourself.', emailOff: 'Email is not enabled: send the code to your guest yourself.',
    code: 'Code', share: 'Share with the guest', copied: 'Text copied: paste it into a message.', cancel: 'Cancel invitation', cancelConfirm: 'Cancel the invitation? The code stops working.',
    reactivate: 'To invite guests from here, remove the badge and activate it again: only once.',
    status: { PENDING: 'Expected', USED: 'Arrived', CANCELLED: 'Cancelled', EXPIRED: 'Did not come' },
    purposes: { MEETING: 'Meeting', INTERVIEW: 'Interview', SUPPLIER: 'Supplier', MAINTENANCE: 'Maintenance', DELIVERY: 'Delivery', OTHER: 'Other' },
    shareText: 'Hi {firstName}, I’m expecting you {when} at {organisation}, {site} site. When you arrive, tap “I have an invitation” on the reception tablet and show the QR from the email, or type the code {code}. See you soon, {host}',
    errors: { INVITATION_IN_PAST: 'That day has already passed.', INVITATION_TOO_FAR: 'You can invite up to 90 days ahead.', NOT_A_HOST: 'You are no longer among the people to visit: ask reception.', NOT_A_HOST_HERE: 'You do not receive visits at this site.', generic: 'Something went wrong. Check the details and try again.', offline: 'No connection.' },
  },
};

export const inviteStrings = (lang: Lang) => STRINGS[lang];

/** Calls /api/me… with the token issued at activation. */
export async function me<R>(token: string, path = '', init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/me${path}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, Array.isArray(data.message) ? data.message[0] : data.message ?? r.statusText);
  return data as R;
}

const dateIn = (ms: number, timeZone: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string; created?: string };

export function BadgeInvites({ token, profile, lang, onBack }: { token: string; profile: Profile; lang: Lang; onBack: () => void }) {
  const T = STRINGS[lang];
  const locale = lang === 'en' ? 'en-GB' : lang;
  const [view, setView] = useState<View>({ kind: 'list' });
  const [rows, setRows] = useState<Invite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const explain = (e: unknown) => setError(e instanceof ApiError ? (T.errors as Record<string, string>)[e.code] ?? T.errors.generic : T.errors.offline);
  const load = useCallback(async () => {
    try {
      const [up, past] = await Promise.all([me<Invite[]>(token, '/invitations'), me<Invite[]>(token, '/invitations?scope=past')]);
      setRows([...up, ...past.slice(0, 10)]); setError(null);
    } catch (e) { explain(e); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  const when = (r: Invite) => new Intl.DateTimeFormat(locale, { timeZone: r.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(r.expectedAt));

  if (view.kind === 'new') return (
    <NewInvite token={token} profile={profile} T={T} onCancel={() => setView({ kind: 'list' })}
      onCreated={async (id, emailStatus) => { await load(); setView({ kind: 'detail', id, created: emailStatus }); }} />
  );
  if (view.kind === 'detail') {
    const row = rows?.find((r) => r.id === view.id);
    return <InviteDetail token={token} row={row} created={view.created} when={row ? when(row) : ''} profile={profile} T={T} locale={locale}
      onBack={() => setView({ kind: 'list' })} onChanged={load} />;
  }
  return (
    <main className="badge-card stack badge-invites">
      <button type="button" className="btn-link" style={{ justifySelf: 'start' }} onClick={onBack}>‹ {T.back}</button>
      <h1 style={{ margin: 0 }}>{T.title}</h1>
      <button type="button" className="btn btn-primary" onClick={() => setView({ kind: 'new' })}>{T.new}</button>
      <ArrivalNotices token={token} lang={lang} />
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      {rows && rows.length === 0 && <p className="muted" style={{ margin: 0 }}>{T.none}</p>}
      {rows && rows.length > 0 && (
        <ul className="invite-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setView({ kind: 'detail', id: r.id })}>
                <span><strong style={r.status === 'CANCELLED' ? { textDecoration: 'line-through' } : undefined}>{r.firstName} {r.lastName}</strong><small>{when(r)} · {r.siteName}</small></span>
                <span className={`pill ${r.status === 'PENDING' ? 'OPEN' : ''}`}>{T.status[r.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function NewInvite({ token, profile, T, onCancel, onCreated }: { token: string; profile: Profile; T: (typeof STRINGS)['it']; onCancel: () => void; onCreated: (id: string, emailStatus: string) => void }) {
  const first = profile.sites[0];
  const [f, setF] = useState({ siteId: first?.id ?? '', date: first ? dateIn(Date.now(), first.timezone) : '', time: '10:00', firstName: '', lastName: '', company: '', email: '', purpose: 'MEETING' as Purpose });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const site = profile.sites.find((s) => s.id === f.siteId) ?? first;
  const today = site ? dateIn(Date.now(), site.timezone) : '';
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await me<{ id: string; emailStatus: string }>(token, '/invitations', {
        method: 'POST', body: JSON.stringify({ ...f, siteId: site!.id, company: f.company.trim() || undefined, email: f.email.trim(), locale: navigator.language.slice(0, 2) === 'es' ? 'es' : navigator.language.slice(0, 2) === 'en' ? 'en' : 'it' }),
      });
      onCreated(r.id, r.emailStatus);
    } catch (err) {
      setError(err instanceof ApiError ? (T.errors as Record<string, string>)[err.code] ?? T.errors.generic : T.errors.offline);
    } finally { setBusy(false); }
  };

  return (
    <main className="badge-card">
      <form className="stack" onSubmit={submit}>
        <button type="button" className="btn-link" style={{ justifySelf: 'start' }} onClick={onCancel}>‹ {T.list}</button>
        <h1 style={{ margin: 0 }}>{T.new}</h1>
        <div className="field"><label htmlFor="if">{T.firstName}</label><input id="if" className="input" value={f.firstName} onChange={set('firstName')} maxLength={80} required autoComplete="off" /></div>
        <div className="field"><label htmlFor="il">{T.lastName}</label><input id="il" className="input" value={f.lastName} onChange={set('lastName')} maxLength={80} required autoComplete="off" /></div>
        <div className="field"><label htmlFor="ic">{T.company}</label><input id="ic" className="input" value={f.company} onChange={set('company')} maxLength={120} autoComplete="off" /></div>
        <div className="field"><label htmlFor="ie">{T.email}</label><input id="ie" className="input" type="email" value={f.email} onChange={set('email')} maxLength={190} required autoComplete="off" spellCheck={false} /></div>
        {profile.sites.length > 1 && (
          <div className="field"><label htmlFor="is">{T.site}</label>
            <select id="is" className="input" value={f.siteId} onChange={set('siteId')}>{profile.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        )}
        <div className="inline" style={{ gap: 12 }}>
          <div className="field" style={{ flex: '1 1 150px' }}><label htmlFor="id">{T.day}</label><input id="id" className="input" type="date" min={today} value={f.date} onChange={set('date')} required /></div>
          <div className="field" style={{ flex: '1 1 110px' }}><label htmlFor="it">{T.time}</label><input id="it" className="input" type="time" step={300} value={f.time} onChange={set('time')} required /></div>
        </div>
        <div className="field"><label htmlFor="ip">{T.purpose}</label>
          <select id="ip" className="input" value={f.purpose} onChange={set('purpose')}>{PURPOSES.map((p) => <option key={p} value={p}>{T.purposes[p]}</option>)}</select></div>
        {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{T.create}</button>
      </form>
    </main>
  );
}

function InviteDetail({ token, row, created, when, profile, T, onBack, onChanged }: {
  token: string; row: Invite | undefined; created?: string; when: string; profile: Profile; T: (typeof STRINGS)['it']; locale: string; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const [qr, setQr] = useState<{ code: string; src: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setQr(null);
    if (row?.status !== 'PENDING') return;
    let alive = true;
    me<{ code: string; payload: string }>(token, `/invitations/${row.id}/qr`)
      .then(async ({ code, payload }) => {
        const svg = await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        if (alive) setQr({ code, src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [token, row?.id, row?.status]);

  if (!row) return <main className="badge-card stack"><button type="button" className="btn-link" onClick={onBack}>‹ {T.list}</button></main>;
  const text = qr ? T.shareText.replace('{firstName}', row.firstName).replace('{when}', when).replace('{organisation}', profile.organisation)
    .replace('{site}', row.siteName).replace('{code}', qr.code).replace('{host}', profile.firstName) : '';
  const share = async () => {
    setNote(null);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setNote(T.copied); }
    } catch { /* closed by the user */ }
  };
  const cancel = async () => {
    if (!window.confirm(T.cancelConfirm)) return;
    setBusy(true); setError(null);
    try { await me(token, `/invitations/${row.id}/cancel`, { method: 'POST', body: '{}' }); await onChanged(); }
    catch (e) { setError(e instanceof ApiError ? (T.errors as Record<string, string>)[e.code] ?? T.errors.generic : T.errors.offline); }
    finally { setBusy(false); }
  };

  return (
    <main className="badge-card stack" style={{ textAlign: 'center' }}>
      <button type="button" className="btn-link" style={{ justifySelf: 'start' }} onClick={onBack}>‹ {T.list}</button>
      {created && <p className="alert alert-info" role="status" style={{ margin: 0, textAlign: 'left' }}><strong>{T.created}</strong> {created === 'SKIPPED' ? T.emailOff : T.emailSent}</p>}
      <span className={`pill ${row.status === 'PENDING' ? 'OPEN' : ''}`} style={{ justifySelf: 'center' }}>{T.status[row.status]}</span>
      <div className="badge-name">{row.firstName} {row.lastName}</div>
      {row.company && <p className="muted" style={{ margin: 0 }}>{row.company}</p>}
      <p style={{ margin: 0, fontWeight: 700 }}>{when}</p>
      <p className="muted" style={{ margin: 0 }}>{row.siteName} · {T.purposes[row.purpose]} · {row.email}</p>
      {qr && (
        <>
          <div className="badge-qr-box" style={{ maxWidth: 220, justifySelf: 'center' }}><img src={qr.src} alt={`${T.code} ${qr.code}`} /></div>
          <p className="muted" style={{ margin: 0 }}>{T.code}</p>
          <p className="invite-code" translate="no">{qr.code}</p>
          <button type="button" className="btn btn-primary" onClick={share}>{T.share}</button>
          <p role="status" className="hint" style={{ margin: 0 }}>{note ?? ''}</p>
        </>
      )}
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      {row.status === 'PENDING' && <button type="button" className="btn btn-ghost is-danger" onClick={cancel} disabled={busy} aria-busy={busy}>{T.cancel}</button>}
    </main>
  );
}
