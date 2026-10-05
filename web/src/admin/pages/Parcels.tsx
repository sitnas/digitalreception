import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { compressPhoto } from '../../lib/image';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';

const SITE_KEY = 'rs_admin_site';
const CARRIERS = ['DHL', 'UPS', 'FEDEX', 'TNT', 'GLS', 'BRT', 'SDA', 'POSTE', 'AMAZON', 'SEUR', 'CORREOS', 'OTHER'] as const;
type Carrier = (typeof CARRIERS)[number];
const POLL_MS = 30_000;

interface Recipient { id: string; firstName: string; lastName: string; department: string | null }
interface ParcelRow {
  id: string; carrier: Carrier; pieces: number; status: 'WAITING' | 'COLLECTED'; receivedAt: string; collectedAt: string | null; emailStatus: string;
  tracking: string | null; note: string | null; hasPhoto: boolean; recipient: Recipient | null;
}

/** "3 minutes ago", "yesterday": how long a parcel has been waiting, at a glance. */
function ago(iso: string, intl: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(intl, { numeric: 'auto' });
  for (const [unit, size] of [['day', 86_400], ['hour', 3_600], ['minute', 60]] as const) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  return rtf.format(0, 'minute');
}

export function ParcelsPage() {
  const { t, intl } = useI18n();
  const P = t.parcels;
  const me = useMe();
  const canEdit = me.role !== 'AUDITOR';
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [siteId, setSiteId] = useState(() => { try { return localStorage.getItem(SITE_KEY) ?? ''; } catch { return ''; } });
  const [tab, setTab] = useState<'WAITING' | 'COLLECTED'>('WAITING');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const list = sites.data?.filter((s) => s.active) ?? [];
    if (list.length && !list.some((s) => s.id === siteId)) setSiteId(list[0].id);
  }, [sites.data, siteId]);
  useEffect(() => { try { if (siteId) localStorage.setItem(SITE_KEY, siteId); } catch { /* ignore */ } }, [siteId]);

  const rows = useAsync(() => (siteId ? api.get<ParcelRow[]>(`/admin/parcels${qs({ siteId, status: tab })}`) : Promise.resolve([])), [siteId, tab]);
  const waitingCount = useAsync(() => (siteId ? api.get<ParcelRow[]>(`/admin/parcels${qs({ siteId, status: 'WAITING' })}`).then((r) => r.length) : Promise.resolve(0)), [siteId, rows.data]);
  useEffect(() => { const h = setInterval(() => rows.reload(), POLL_MS); return () => clearInterval(h); }, [rows.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); rows.reload(); } catch (e) { setMsg({ ok: false, text: errorText(t, e) }); }
  };
  const openPhoto = async (id: string) => {
    try {
      const blob = await api.blob(`/admin/parcels/${id}/photo`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setMsg({ ok: false, text: errorText(t, e) }); }
  };

  return (
    <>
      <PageHead title={P.title} intro={P.intro} />
      <ErrorBox error={sites.error ?? rows.error} />
      {sites.data && sites.data.filter((s) => s.active).length > 1 && (
        <div className="a-filters"><SiteSelect sites={sites.data.filter((s) => s.active)} value={siteId} onChange={setSiteId} id="ps" /></div>
      )}
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>
      {canEdit && siteId && <NewParcel siteId={siteId} onSaved={(text) => { setMsg({ ok: true, text }); setTab('WAITING'); rows.reload(); }} />}

      <div className="segmented" role="group" aria-label={P.title} style={{ margin: '20px 0 12px' }}>
        <button type="button" aria-pressed={tab === 'WAITING'} onClick={() => setTab('WAITING')}>{P.waiting} <span className="count">{waitingCount.data ?? ''}</span></button>
        <button type="button" aria-pressed={tab === 'COLLECTED'} onClick={() => setTab('COLLECTED')}>{P.collected}</button>
      </div>
      {rows.data && rows.data.length === 0 && <p className="empty">{tab === 'WAITING' ? P.none : P.noneCollected}</p>}
      <ul className="parcel-list">
        {rows.data?.map((r) => (
          <li key={r.id} className="parcel-row">
            <div className="parcel-main">
              <strong>{r.recipient ? `${r.recipient.firstName} ${r.recipient.lastName}` : '—'}</strong>
              <span className="muted">{[r.recipient?.department, P.carriers[r.carrier], r.pieces > 1 ? P.piecesN.replace('{n}', String(r.pieces)) : null].filter(Boolean).join(' · ')}</span>
              {(r.note || r.tracking) && <span className="parcel-note">{[r.note, r.tracking].filter(Boolean).join(' · ')}</span>}
              <span className="parcel-when" title={fmtDateTime(r.status === 'WAITING' ? r.receivedAt : r.collectedAt!, intl)}>
                {r.status === 'WAITING' ? P.since.replace('{when}', ago(r.receivedAt, intl)) : P.collectedAt.replace('{when}', ago(r.collectedAt!, intl))}
              </span>
            </div>
            <div className="parcel-actions">
              {r.hasPhoto && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPhoto(r.id)}>{P.viewPhoto}</button>}
              {canEdit && r.status === 'WAITING' && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm is-danger" onClick={() => window.confirm(P.removeConfirm) && act(() => api.del(`/admin/parcels/${r.id}`))}>{P.remove}</button>
                  <button type="button" className="btn btn-primary" onClick={() => act(() => api.post(`/admin/parcels/${r.id}/collect`))}>{P.collect}</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function NewParcel({ siteId, onSaved }: { siteId: string; onSaved: (text: string) => void }) {
  const { t } = useI18n();
  const P = t.parcels;
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Recipient[] | null>(null);
  const [who, setWho] = useState<Recipient | null>(null);
  const [carrier, setCarrier] = useState<Carrier>('DHL');
  const [pieces, setPieces] = useState(1);
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (who || q.trim().length < 2) { setFound(null); return; }
    const h = setTimeout(() => { api.get<Recipient[]>(`/admin/parcels/recipients${qs({ q: q.trim() })}`).then(setFound, () => setFound([])); }, 200);
    return () => clearTimeout(h);
  }, [q, who]);

  const reset = () => { setQ(''); setWho(null); setFound(null); setPieces(1); setTracking(''); setNote(''); setPhoto(null); setTimeout(() => search.current?.focus(), 0); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who) { setError(P.recipientHint); search.current?.focus(); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ pushQueued: boolean; emailStatus: string }>('/admin/parcels', {
        siteId, employeeId: who.id, carrier, pieces, tracking: tracking || undefined, note: note || undefined, photo: photo ?? undefined,
      });
      const told = [r.pushQueued && P.toldPush, r.emailStatus === 'PENDING' && P.toldEmail].filter(Boolean);
      onSaved(`${P.saved.replace('{name}', `${who.firstName} ${who.lastName}`)} ${told.length ? told.join(' ') : P.toldNone}`);
      reset();
    } catch (err) { setError(errorText(t, err)); } finally { setBusy(false); }
  };

  return (
    <form className="a-card stack" onSubmit={save} noValidate>
      <h2 style={{ margin: 0 }}>{P.newTitle}</h2>
      <div className="field">
        <label htmlFor="pr">{P.recipient}</label>
        {who ? (
          <div className="parcel-who">
            <span><strong>{who.firstName} {who.lastName}</strong>{who.department && <span className="muted"> · {who.department}</span>}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>{P.change}</button>
          </div>
        ) : (
          <>
            <input id="pr" ref={search} className="input" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" role="combobox" aria-expanded={!!found?.length} aria-controls="pr-list" aria-describedby="pr-hint" />
            <span id="pr-hint" className="hint">{P.recipientHint}</span>
            {found && (found.length ? (
              <ul id="pr-list" className="parcel-results" role="listbox">
                {found.map((r) => (
                  <li key={r.id} role="option" aria-selected={false}>
                    <button type="button" onClick={() => { setWho(r); setError(null); }}><strong>{r.firstName} {r.lastName}</strong>{r.department && <span className="muted"> · {r.department}</span>}</button>
                  </li>
                ))}
              </ul>
            ) : <span className="hint">{P.noMatch}</span>)}
          </>
        )}
      </div>
      <div className="field">
        <span className="label" id="pc-l">{P.carrier}</span>
        <div className="parcel-carriers" role="radiogroup" aria-labelledby="pc-l">
          {CARRIERS.map((c) => <button key={c} type="button" role="radio" aria-checked={carrier === c} className="parcel-chip" onClick={() => setCarrier(c)}>{P.carriers[c]}</button>)}
        </div>
      </div>
      <div className="a-grid">
        <div className="field"><label htmlFor="pp">{P.pieces}</label><input id="pp" className="input" type="number" min={1} max={50} value={pieces} onChange={(e) => setPieces(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></div>
        <div className="field"><label htmlFor="pt">{P.tracking}</label><input id="pt" className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={80} autoComplete="off" /><span className="hint">{P.optional}</span></div>
      </div>
      <div className="field"><label htmlFor="pn">{P.note}</label><input id="pn" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={P.notePlaceholder} /></div>
      <div className="field">
        <span className="label">{P.photo}</span>
        <div className="inline">
          {photo && <img src={photo} alt={P.photo} className="parcel-thumb" />}
          <input ref={file} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1}
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPhoto(await compressPhoto(f, 1280, 0.75)); }} />
          <button type="button" className="btn btn-ghost" onClick={() => file.current?.click()}>{photo ? P.retake : P.takePhoto}</button>
          {photo && <button type="button" className="btn-link" onClick={() => setPhoto(null)}>{P.removePhoto}</button>}
          <span className="hint">{P.optional}</span>
        </div>
      </div>
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div><button className="btn btn-primary" disabled={busy} aria-busy={busy}>{P.save}</button></div>
    </form>
  );
}
