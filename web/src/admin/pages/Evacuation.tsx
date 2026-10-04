import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';

const SITE_KEY = 'rs_admin_site';
/** During an evacuation several marshals tick people on their phones: everyone sees the others' ticks within seconds. */
const POLL_RUNNING_MS = 4_000;
const POLL_IDLE_MS = 30_000;

interface Person { kind: 'visit' | 'employee'; id: string; name: string; detail: string | null; since: string; safeAt: string | null }
interface Evac { id: string; siteId: string; startedAt: string; endedAt: string | null; peopleCount: number | null; safeCount: number | null }
interface Current { evacuation: Evac | null; people: Person[]; timezone: string }

export function EvacuationPage() {
  const { t, intl } = useI18n();
  const E = t.evac;
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [siteId, setSiteId] = useState(() => { try { return localStorage.getItem(SITE_KEY) ?? ''; } catch { return ''; } });
  const [filter, setFilter] = useState<'missing' | 'all'>('missing');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Ticks not yet confirmed by the server, so a tap shows at once even on a slow network.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const list = sites.data?.filter((s) => s.active) ?? [];
    if (list.length && !list.some((s) => s.id === siteId)) setSiteId(list[0].id);
  }, [sites.data, siteId]);
  useEffect(() => { try { if (siteId) localStorage.setItem(SITE_KEY, siteId); } catch { /* ignore */ } }, [siteId]);

  const current = useAsync(() => (siteId ? api.get<Current>(`/admin/evacuations/current${qs({ siteId })}`) : Promise.resolve(null)), [siteId]);
  const history = useAsync(() => (siteId ? api.get<Evac[]>(`/admin/evacuations${qs({ siteId })}`) : Promise.resolve([])), [siteId]);
  const running = current.data?.evacuation ?? null;
  useEffect(() => {
    const h = setInterval(() => current.reload(), running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => clearInterval(h);
  }, [running, current.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const site = sites.data?.find((s) => s.id === siteId);
  const people = useMemo(() => (current.data?.people ?? []).map((p) => {
    const key = `${p.kind}:${p.id}`;
    return key in pending ? { ...p, safeAt: pending[key] ? p.safeAt ?? new Date().toISOString() : null } : p;
  }), [current.data, pending]);
  const safe = people.filter((p) => p.safeAt).length;
  const term = q.trim().toLowerCase();
  const shown = people.filter((p) => (filter === 'all' || !p.safeAt || !running) && (!term || `${p.name} ${p.detail ?? ''}`.toLowerCase().includes(term)));
  const guests = shown.filter((p) => p.kind === 'visit'), staff = shown.filter((p) => p.kind === 'employee');
  const time = (iso: string) => new Intl.DateTimeFormat(intl, { timeZone: current.data?.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); } finally { setBusy(false); }
  };
  const start = () => {
    if (!window.confirm(E.startConfirm.replace('{site}', site?.name ?? ''))) return;
    run(async () => { await api.post('/admin/evacuations', { siteId }); setFilter('missing'); await current.reload(); history.reload(); });
  };
  const end = () => {
    if (!running) return;
    const missing = people.length - safe;
    if (!window.confirm(missing ? E.endConfirm.replace('{n}', String(missing)) : E.endConfirmAll)) return;
    run(async () => {
      const r = await api.post<Evac>(`/admin/evacuations/${running.id}/end`);
      setMsg({ ok: true, text: E.ended.replace('{safe}', String(r.safeCount)).replace('{total}', String(r.peopleCount)) });
      setPending({}); await current.reload(); history.reload();
    });
  };
  const toggle = async (p: Person) => {
    if (!running) return;
    const key = `${p.kind}:${p.id}`, next = !p.safeAt;
    setPending((x) => ({ ...x, [key]: next }));
    try {
      await api.post(`/admin/evacuations/${running.id}/checks`, { kind: p.kind, refId: p.id, safe: next });
      await current.reload();
    } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
    setPending((x) => { const { [key]: _, ...rest } = x; return rest; });
  };

  const list = (title: string, rows: Person[], hint?: string) => rows.length > 0 && (
    <section className="evac-group" aria-label={title}>
      <h2>{title} <span className="muted">{rows.length}</span></h2>
      {hint && <p className="hint" style={{ margin: '0 0 8px' }}>{hint}</p>}
      <ul className="evac-list">
        {rows.map((p) => (
          <li key={`${p.kind}:${p.id}`}>
            <label className={`evac-row${p.safeAt ? ' is-safe' : ''}`}>
              {running && <input type="checkbox" checked={!!p.safeAt} onChange={() => toggle(p)} aria-label={`${E.safe}: ${p.name}`} />}
              <span className="evac-name"><strong>{p.name}</strong>{p.detail && <small>{p.detail}</small>}</span>
              <small className="evac-since">{p.safeAt ? `✓ ${time(p.safeAt)}` : E.since.replace('{time}', time(p.since))}</small>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <PageHead title={E.title} intro={E.intro} actions={people.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => window.print()}>{E.print}</button>} />
      <ErrorBox error={sites.error ?? current.error} />
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>
      {sites.data && sites.data.filter((s) => s.active).length > 1 && (
        <div className="a-filters no-print"><SiteSelect sites={sites.data.filter((s) => s.active)} value={siteId} onChange={(v) => { setSiteId(v); setPending({}); }} id="evs" /></div>
      )}

      {current.data && (running ? (
        <div className="evac-banner" role="alert">
          <div>
            <strong>{E.running.replace('{time}', time(running.startedAt))}</strong>
            <span className="evac-count">{E.safeOf.replace('{safe}', String(safe)).replace('{total}', String(people.length))}
              {' · '}{people.length - safe ? E.missing.replace('{n}', String(people.length - safe)) : E.allSafe}</span>
          </div>
          <button type="button" className="btn btn-primary no-print" onClick={end} disabled={busy}>{E.end}</button>
        </div>
      ) : (
        <div className="a-card evac-idle no-print">
          <p style={{ margin: 0 }}>{E.insideNow.replace('{guests}', String(people.filter((p) => p.kind === 'visit').length)).replace('{employees}', String(people.filter((p) => p.kind === 'employee').length))}</p>
          <button type="button" className="btn btn-danger evac-start" onClick={start} disabled={busy || !siteId} aria-busy={busy}>{E.start}</button>
        </div>
      ))}

      {people.length > 0 && (
        <div className="a-filters no-print" style={{ marginTop: 16 }}>
          {running && (
            <div className="segmented" role="group" aria-label={E.filterMissing}>
              <button type="button" aria-pressed={filter === 'missing'} onClick={() => setFilter('missing')}>{E.filterMissing} <span className="count">{people.length - safe}</span></button>
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{E.filterAll} <span className="count">{people.length}</span></button>
            </div>
          )}
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="evq" className="sr-only">{E.search}</label><input id="evq" className="input" placeholder={E.search} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
      )}
      {current.data && people.length === 0 && <p className="empty">{E.nobody}</p>}
      <p data-print-only hidden>{site?.name} · {fmtDateTime(new Date().toISOString(), intl, current.data?.timezone)}</p>
      {list(E.guests, guests)}
      {list(E.employees, staff, E.employeesHint)}

      <section className="no-print" style={{ marginTop: 32 }}>
        <h2>{E.history}</h2>
        {history.data && history.data.length === 0 ? <p className="muted">{E.historyNone}</p> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead><tr><th>{E.started}</th><th>{E.closed}</th><th>{E.people}</th><th>{E.safeCol}</th></tr></thead>
              <tbody>
                {(history.data ?? []).map((h) => (
                  <tr key={h.id}>
                    <td data-label={E.started}>{fmtDateTime(h.startedAt, intl, current.data?.timezone)}</td>
                    <td data-label={E.closed}>{h.endedAt ? fmtDateTime(h.endedAt, intl, current.data?.timezone) : '—'}</td>
                    <td data-label={E.people} className="num">{h.peopleCount ?? '—'}</td>
                    <td data-label={E.safeCol} className="num">{h.safeCount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
