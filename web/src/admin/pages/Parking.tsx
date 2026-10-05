import { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';

const SITE_KEY = 'rs_admin_site';

export interface SpotRow { id: string; siteId: string; code: string; note: string | null; active: boolean; manager: { id: string; name: string } | null }
interface Week {
  monday: string; today: string; days: string[]; spots: SpotRow[];
  bookings: { id: string; spotId: string; date: string; source: 'AUTO' | 'MANUAL'; employeeId: string; name: string }[];
}
interface Person { id: string; externalId: string; active: boolean; role: 'USER' | 'MANAGER'; firstName: string | null; lastName: string | null; spot: { id: string; code: string; siteId: string } | null }

const shift = (iso: string, days: number) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };

/** The Parking app in the console: the week at a site, its spots, who has the benefit. */
export function ParkingPage() {
  const { t, intl } = useI18n();
  const P = t.parking;
  const me = useMe();
  const canManage = me.role === 'SUPER_ADMIN' || me.role === 'SITE_MANAGER';
  const canCancel = me.role !== 'AUDITOR';
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [siteId, setSiteId] = useState(() => { try { return localStorage.getItem(SITE_KEY) ?? ''; } catch { return ''; } });
  const [monday, setMonday] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ code: '', note: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const list = sites.data?.filter((s) => s.active) ?? [];
    if (list.length && !list.some((s) => s.id === siteId)) setSiteId(list[0].id);
  }, [sites.data, siteId]);
  useEffect(() => { try { if (siteId) localStorage.setItem(SITE_KEY, siteId); } catch { /* ignore */ } }, [siteId]);

  const week = useAsync(() => (siteId ? api.get<Week>(`/admin/parking/week${qs({ siteId, monday: monday ?? undefined })}`) : Promise.resolve(null)), [siteId, monday]);
  const people = useAsync(() => (canManage || me.role === 'AUDITOR' ? api.get<Person[]>('/admin/parking/people') : Promise.resolve([] as Person[])), [canManage, me.role]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); week.reload(); people.reload(); return true; } catch (e) { setMsg({ ok: false, text: errorText(t, e) }); return false; } finally { setBusy(false); }
  };
  const dayName = (d: string) => new Intl.DateTimeFormat(intl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const w = week.data;
  const activeSites = sites.data?.filter((s) => s.active) ?? [];

  return (
    <>
      <PageHead title={P.title} intro={P.intro} />
      <ErrorBox error={sites.error ?? week.error} />
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>
      <div className="a-filters">
        {activeSites.length > 1 && <SiteSelect sites={activeSites} value={siteId} onChange={(v) => { setSiteId(v); setMonday(null); }} />}
        {w && (
          <div className="inline" style={{ alignSelf: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonday(shift(w.monday, -7))}>{P.prev}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={monday === null} onClick={() => setMonday(null)}>{P.thisWeek}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonday(shift(w.monday, 7))}>{P.next}</button>
          </div>
        )}
      </div>

      {w && (w.spots.filter((s) => s.active).length === 0 ? <p className="empty">{P.noSpots}</p> : (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <table className="parking-week">
            <thead><tr><th>{P.spot}</th>{w.days.map((d) => <th key={d} className={d === w.today ? 'is-today' : undefined}>{dayName(d)}{d === w.today && <> · {P.today}</>}</th>)}</tr></thead>
            <tbody>
              {w.spots.filter((s) => s.active).map((s) => (
                <tr key={s.id}>
                  <th scope="row"><strong>{s.code}</strong>{s.note && <><br /><span className="muted">{s.note}</span></>}{s.manager && <><br /><span className="tag">{P.manager}: {s.manager.name}</span></>}</th>
                  {w.days.map((d) => {
                    const b = w.bookings.find((x) => x.spotId === s.id && x.date === d);
                    return (
                      <td key={d} data-label={dayName(d)} className={b ? 'is-booked' : 'is-free'}>
                        {b ? (
                          <span className="parking-cell">
                            <span>{b.name}{b.source === 'AUTO' && <span className="muted"> · {P.fixed}</span>}</span>
                            {canCancel && d >= w.today && (
                              <button type="button" className="btn-link" disabled={busy}
                                onClick={() => window.confirm(P.cancelConfirm.replace('{name}', b.name).replace('{day}', dayName(d))) && act(() => api.del(`/admin/parking/bookings/${b.id}`), P.cancelled)}>{P.cancel}</button>
                            )}
                          </span>
                        ) : <span className="muted">{P.free}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {w && (
        <section className="a-card stack" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{P.spotsTitle}</h2>
          {w.spots.length > 0 && (
            <ul className="parking-spots" role="list">
              {w.spots.map((s) => (
                <li key={s.id} className={s.active ? undefined : 'row-off'}>
                  <span><strong>{s.code}</strong>{s.note && <span className="muted"> · {s.note}</span>}{!s.active && <> <span className="pill">{P.off}</span></>}</span>
                  {canManage && (
                    <span className="inline">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => (s.active ? window.confirm(P.offConfirm.replace('{code}', s.code)) : true) && act(() => api.patch(`/admin/parking/spots/${s.id}`, { active: !s.active }), P.saved)}>{s.active ? P.turnOff : P.turnOn}</button>
                      <button type="button" className="btn btn-ghost btn-sm is-danger" disabled={busy}
                        onClick={() => window.confirm(P.removeConfirm.replace('{code}', s.code)) && act(() => api.del(`/admin/parking/spots/${s.id}`), P.deleted)}>{P.remove}</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <form className="inline" style={{ alignItems: 'flex-end' }}
              onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.post('/admin/parking/spots', { siteId, code: form.code.trim(), note: form.note.trim() || null }), P.added)) setForm({ code: '', note: '' }); }}>
              <div className="field"><label htmlFor="pk-code">{P.code}</label>
                <input id="pk-code" className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} maxLength={20} required pattern="[A-Za-z0-9][A-Za-z0-9 ._/\-]{0,19}" aria-describedby="pk-code-h" autoComplete="off" style={{ width: 120 }} /></div>
              <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="pk-note">{P.note}</label>
                <input id="pk-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={120} placeholder={P.notePh} /></div>
              <button className="btn btn-primary" disabled={busy || !form.code.trim()} aria-busy={busy}>{P.add}</button>
              <span id="pk-code-h" className="hint" style={{ flexBasis: '100%' }}>{P.codeHint}</span>
            </form>
          )}
        </section>
      )}

      {(canManage || me.role === 'AUDITOR') && people.data && (
        <section className="a-card stack">
          <h2 style={{ margin: 0 }}>{P.peopleTitle}</h2>
          {people.data.length === 0 ? <p className="muted" style={{ margin: 0 }}>{P.nobody}</p> : (
            <ul className="parking-spots" role="list">
              {people.data.map((p) => (
                <li key={p.id} className={p.active ? undefined : 'row-off'}>
                  <span><strong>{p.lastName} {p.firstName}</strong> <span className="muted">{p.externalId}</span></span>
                  <span><span className="pill">{P.role[p.role]}</span>{p.spot && <> <strong>{p.spot.code}</strong></>}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
