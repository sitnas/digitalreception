import { useState } from 'react';
import { api } from '../../lib/api';
import { dayEnd, dayStart, fmtDateTime, todayIso } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';
import { CopyButton } from './Users';

interface Permission { door: string; site: string; days: number[] | null; from: string | null; to: string | null }
interface EmployeeRow {
  id: string; externalId: string; firstName: string; lastName: string; email: string | null; active: boolean;
  validFrom: string | null; validUntil: string | null; badgeHint: string | null; phoneBadge: boolean; phoneBadgeIssuedAt: string | null; permissions: Permission[];
}
interface ReaderRow { id: string; name: string; lastSeenAt: string | null; createdAt: string }
interface DoorRow { id: string; externalId: string; name: string; active: boolean; siteId: string; siteName: string; readers: ReaderRow[] }
interface EventRow { id: string; at: string; method: 'QR' | 'NFC'; result: 'GRANTED' | 'DENIED'; reason: string; door: string; site: string; timezone: string; employee: string | null; externalId: string | null }
interface KeyRow { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

const origin = () => window.location.origin;

/** Employees as received from the external system: the console reads them, the external system edits them. */
export function EmployeesPage() {
  const { t, intl } = useI18n();
  const me = useMe();
  const list = useAsync(() => api.get<EmployeeRow[]>('/admin/access/employees'), []);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const term = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((e) => !term || [e.firstName, e.lastName, e.externalId, e.email].some((x) => x?.toLowerCase().includes(term)));
  const dayNames = t.access.weekdays;
  const rule = (p: Permission) => `${p.days ? p.days.map((d) => dayNames[d - 1]).join(' ') : t.access.everyDay}${p.from ? ` ${p.from}–${p.to}` : ''}`;
  const revoke = async (e: EmployeeRow) => {
    if (!window.confirm(t.access.revokeConfirm.replace('{name}', `${e.firstName} ${e.lastName}`))) return;
    try { await api.post(`/admin/access/employees/${e.id}/revoke-phone`); setMsg({ ok: true, text: t.access.revoked }); list.reload(); } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };

  return (
    <>
      <PageHead title={t.access.employeesTitle} intro={t.access.employeesIntro} />
      <ErrorBox error={list.error} />
      {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status">{msg.text}</p>}
      <div className="a-card inline" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <span>{t.access.badgePage}: <code>{origin()}/badge</code></span>
        <CopyButton text={`${origin()}/badge`} />
      </div>
      {list.data && list.data.length > 0 && (
        <div className="a-filters"><div className="field" style={{ flex: '1 1 260px' }}><label htmlFor="es">{t.access.search}</label><input id="es" className="input" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      )}
      <div className="table-wrap" style={{ marginTop: 16 }}>
        {list.data && list.data.length === 0 ? <p className="empty">{t.access.noEmployees}</p> : (
          <table>
            <thead><tr><th>{t.access.person}</th><th>{t.access.externalId}</th><th>{t.access.credentials}</th><th>{t.access.doors}</th><th>{t.access.validity}</th><th></th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} style={e.active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{e.lastName} {e.firstName}</strong>{!e.active && <> <span className="pill">{t.access.inactive}</span></>}{e.email && <><br /><span className="muted">{e.email}</span></>}</td>
                  <td className="num">{e.externalId}</td>
                  <td>{e.badgeHint ? <>{t.access.card} ···{e.badgeHint}</> : null}{e.badgeHint && e.phoneBadge ? <br /> : null}{e.phoneBadge ? t.access.phone : null}{!e.badgeHint && !e.phoneBadge && <span className="muted">—</span>}</td>
                  <td className="wrap">{e.permissions.length ? e.permissions.map((p, i) => <div key={i}><strong>{p.door}</strong> <span className="muted">{p.site} · {rule(p)}</span></div>) : <span className="muted">{t.access.noDoors}</span>}</td>
                  <td className="num">{e.validFrom || e.validUntil ? `${e.validFrom ? fmtDateTime(e.validFrom, intl) : '…'} → ${e.validUntil ? fmtDateTime(e.validUntil, intl) : '…'}` : t.access.always}</td>
                  <td>{e.phoneBadge && me.role !== 'AUDITOR' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(e)}>{t.access.revokePhone}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** Doors of each site and the readers installed at them. */
export function DoorsPage() {
  const { t, intl } = useI18n();
  const me = useMe();
  const canEdit = me.role !== 'AUDITOR';
  const doors = useAsync(() => api.get<DoorRow[]>('/admin/access/doors'), []);
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const mySites = (sites.data ?? []).filter((s) => s.active && (me.role === 'SUPER_ADMIN' || me.siteIds.includes(s.id)));
  const [form, setForm] = useState<{ siteId: string; name: string; externalId: string } | null>(null);
  const [code, setCode] = useState<{ door: string; code: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); doors.reload(); return true; } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); return false; }
  };
  const newReader = async (d: DoorRow) => {
    const name = window.prompt(t.access.readerName, `${t.access.reader} ${d.name}`);
    if (!name) return;
    await run(async () => setCode({ door: d.name, ...(await api.post<{ code: string; expiresAt: string }>(`/admin/access/doors/${d.id}/reader-code`, { name })) }));
  };

  return (
    <>
      <PageHead title={t.access.doorsTitle} intro={t.access.doorsIntro}
        actions={canEdit && !form && mySites.length > 0 && <button type="button" className="btn btn-primary" onClick={() => setForm({ siteId: mySites[0].id, name: '', externalId: '' })}>{t.access.addDoor}</button>} />
      <ErrorBox error={doors.error ?? sites.error} />
      {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status">{msg.text}</p>}
      {code && (
        <div className="a-card stack" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{t.access.pairTitle.replace('{door}', code.door)}</h2>
          <div className="codebox num">{code.code}</div>
          <p className="muted" style={{ margin: 0 }}>{t.access.pairHint.replace('{url}', `${origin()}/reader`).replace('{time}', fmtDateTime(code.expiresAt, intl))}</p>
          <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCode(null)}>{t.detail.close}</button></div>
        </div>
      )}
      {form && (
        <form className="a-card stack" style={{ marginBottom: 16 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post('/admin/access/doors', form), t.access.doorSaved)) setForm(null); }}>
          <h2 style={{ margin: 0 }}>{t.access.addDoor}</h2>
          <div className="a-grid">
            {mySites.length > 1 && <SiteSelect sites={mySites} value={form.siteId} onChange={(v) => setForm({ ...form, siteId: v })} id="ds" />}
            <div className="field"><label htmlFor="dn">{t.access.doorName}</label><input id="dn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required /></div>
            <div className="field"><label htmlFor="dx">{t.access.externalId}</label><input id="dx" className="input" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value.replace(/[^A-Za-z0-9._:@-]/g, '') })} maxLength={100} required /><span className="hint">{t.access.externalIdHint}</span></div>
          </div>
          <div className="inline"><button className="btn btn-primary">{t.hosts.save}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t.hosts.cancel}</button></div>
        </form>
      )}
      <div className="table-wrap">
        {doors.data && doors.data.length === 0 ? <p className="empty">{t.access.noDoorsYet}</p> : (
          <table>
            <thead><tr><th>{t.access.door}</th><th>{t.access.externalId}</th><th>{t.invites.site}</th><th>{t.access.readers}</th><th></th></tr></thead>
            <tbody>
              {(doors.data ?? []).map((d) => (
                <tr key={d.id} style={d.active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{d.name}</strong>{!d.active && <> <span className="pill">{t.access.inactive}</span></>}</td>
                  <td className="num">{d.externalId}</td>
                  <td>{d.siteName}</td>
                  <td className="wrap">{d.readers.length ? d.readers.map((r) => (
                    <div key={r.id} className="inline" style={{ gap: 8 }}>
                      <span>{r.name} <span className="muted">· {r.lastSeenAt ? fmtDateTime(r.lastSeenAt, intl) : t.access.never}</span></span>
                      {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm(t.access.revokeReaderConfirm.replace('{name}', r.name))) run(() => api.post(`/admin/access/readers/${r.id}/revoke`), t.access.readerRevoked); }}>{t.access.revokeReader}</button>}
                    </div>
                  )) : <span className="muted">{t.access.noReaders}</span>}</td>
                  <td className="inline" style={{ justifyContent: 'flex-end' }}>
                    {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => newReader(d)}>{t.access.pairReader}</button>}
                    {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(() => api.patch(`/admin/access/doors/${d.id}`, { active: !d.active }))}>{d.active ? t.hosts.deactivate : t.hosts.activate}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** Who passed where and when; kept for a short time only. */
export function AccessLogPage() {
  const { t, intl } = useI18n();
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [siteId, setSiteId] = useState('');
  const [day, setDay] = useState(todayIso());
  const [result, setResult] = useState<'' | 'GRANTED' | 'DENIED'>('');
  const events = useAsync(() => api.get<EventRow[]>(`/admin/access/events?from=${encodeURIComponent(dayStart(day))}&to=${encodeURIComponent(dayEnd(day))}${siteId ? `&siteId=${siteId}` : ''}${result ? `&result=${result}` : ''}`), [day, siteId, result]);
  const reasons = t.access.reasons as Record<string, string>;

  return (
    <>
      <PageHead title={t.access.logTitle} intro={t.access.logIntro} />
      <div className="a-filters">
        <div className="field"><label htmlFor="ld">{t.access.day}</label><input id="ld" type="date" className="input" value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} /></div>
        {sites.data && sites.data.length > 1 && <SiteSelect sites={sites.data} value={siteId} onChange={setSiteId} allowAll />}
        <div className="field">
          <span className="label">{t.access.result}</span>
          <div className="segmented" role="tablist" aria-label={t.access.result}>
            {(['', 'GRANTED', 'DENIED'] as const).map((r) => <button key={r || 'all'} type="button" role="tab" aria-selected={result === r} onClick={() => setResult(r)}>{r ? t.access.results[r] : t.access.all}</button>)}
          </div>
        </div>
      </div>
      <ErrorBox error={events.error ?? sites.error} />
      <div className="table-wrap" style={{ marginTop: 16 }}>
        {events.data && events.data.length === 0 ? <p className="empty">{t.access.noEvents}</p> : (
          <table>
            <thead><tr><th>{t.access.time}</th><th>{t.access.person}</th><th>{t.access.door}</th><th>{t.access.result}</th><th>{t.access.method}</th></tr></thead>
            <tbody>
              {(events.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="num">{fmtDateTime(e.at, intl, e.timezone)}</td>
                  <td>{e.employee ? <strong>{e.employee}</strong> : <span className="muted">{t.access.unknown}</span>}{e.externalId && <span className="muted"> · {e.externalId}</span>}</td>
                  <td>{e.door} <span className="muted">· {e.site}</span></td>
                  <td><span className={`pill ${e.result === 'GRANTED' ? 'OPEN' : 'ERASED'}`}>{t.access.results[e.result]}</span>{e.result === 'DENIED' && <><br /><span className="muted">{reasons[e.reason] ?? e.reason}</span></>}</td>
                  <td>{e.method === 'QR' ? t.access.phone : t.access.card}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** API keys for the external system, with the essentials of the API. */
export function IntegrationPage() {
  const { t, intl } = useI18n();
  const keys = useAsync(() => api.get<KeyRow[]>('/admin/access/api-keys'), []);
  const [created, setCreated] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const base = `${origin()}/api/integration/v1`;
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { setCreated((await api.post<{ key: string }>('/admin/access/api-keys', { name })).key); setName(''); keys.reload(); } catch (err) { setMsg(errorText(t, err)); }
  };
  const example = `curl -X PUT ${base}/employees/E001 \\
  -H "Authorization: Bearer ${created ?? 'drk_…'}" \\
  -H "Content-Type: application/json" \\
  -d '{"firstName":"Mario","lastName":"Rossi","email":"mario.rossi@azienda.it",
       "badgeUid":"04:A2:1B:9C","active":true,
       "permissions":[{"door":"MI-MAIN"},
                      {"door":"MI-LAB","days":[1,2,3,4,5],"from":"08:00","to":"19:00"}]}'`;

  return (
    <>
      <PageHead title={t.access.apiTitle} intro={t.access.apiIntro} />
      <ErrorBox error={keys.error} />
      {msg && <p className="alert" role="alert">{msg}</p>}
      {created && (
        <div className="a-card stack" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{t.access.keyCreated}</h2>
          <p className="muted" style={{ margin: 0 }}>{t.access.keyOnce}</p>
          <div className="inline"><code style={{ wordBreak: 'break-all' }}>{created}</code><CopyButton text={created} /></div>
        </div>
      )}
      <form className="a-card inline" style={{ marginBottom: 16, alignItems: 'flex-end' }} onSubmit={create}>
        <div className="field" style={{ flex: '1 1 260px' }}><label htmlFor="kn">{t.access.keyName}</label><input id="kn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.access.keyNamePh} minLength={2} maxLength={80} required /></div>
        <button className="btn btn-primary">{t.access.newKey}</button>
      </form>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        {keys.data && keys.data.length === 0 ? <p className="empty">{t.access.noKeys}</p> : (
          <table>
            <thead><tr><th>{t.access.keyName}</th><th>{t.access.keyPrefix}</th><th>{t.access.created}</th><th>{t.access.lastUsed}</th><th></th></tr></thead>
            <tbody>
              {(keys.data ?? []).map((k) => (
                <tr key={k.id} style={k.revokedAt ? { opacity: 0.55 } : undefined}>
                  <td><strong>{k.name}</strong>{k.revokedAt && <> <span className="pill">{t.access.revokedKey}</span></>}</td>
                  <td><code>{k.prefix}…</code></td>
                  <td className="num">{fmtDateTime(k.createdAt, intl)}</td>
                  <td className="num">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt, intl) : t.access.never}</td>
                  <td>{!k.revokedAt && <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { if (window.confirm(t.access.revokeKeyConfirm)) { await api.post(`/admin/access/api-keys/${k.id}/revoke`); keys.reload(); } }}>{t.access.revokeKey}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <section className="a-card stack">
        <h2 style={{ margin: 0 }}>{t.access.docsTitle}</h2>
        <p className="muted" style={{ margin: 0 }}>{t.access.docsIntro}</p>
        <table className="api-table">
          <tbody>
            <tr><td><code>PUT</code></td><td><code>/doors/&#123;id&#125;</code></td><td>{t.access.docDoor}</td></tr>
            <tr><td><code>GET</code></td><td><code>/doors</code></td><td>{t.access.docDoors}</td></tr>
            <tr><td><code>PUT</code></td><td><code>/employees/&#123;id&#125;</code></td><td>{t.access.docPut}</td></tr>
            <tr><td><code>DELETE</code></td><td><code>/employees/&#123;id&#125;</code></td><td>{t.access.docDelete}</td></tr>
            <tr><td><code>GET</code></td><td><code>/employees?page=1</code></td><td>{t.access.docList}</td></tr>
            <tr><td><code>GET</code></td><td><code>/events?since=ISO</code></td><td>{t.access.docEvents}</td></tr>
          </tbody>
        </table>
        <p style={{ margin: 0 }}>{t.access.baseUrl}: <code>{base}</code></p>
        <pre className="code-block">{example}</pre>
      </section>
    </>
  );
}
