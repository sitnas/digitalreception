import { useState } from 'react';
import { api } from '../../lib/api';
import { dayEnd, dayStart, fmtDateTime, todayIso } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';
import { CopyButton } from './Users';

interface Permission { doorExternalId: string; door: string; site: string; days: number[] | null; from: string | null; to: string | null }
interface EmployeeRow {
  id: string; externalId: string; source: 'API' | 'CONSOLE'; firstName: string; lastName: string; email: string | null; department: string | null; jobTitle: string | null; active: boolean;
  validFrom: string | null; validUntil: string | null; badgeHint: string | null; phoneBadge: boolean; phoneBadgeIssuedAt: string | null; permissions: Permission[];
}
interface ReaderRow { id: string; name: string; lastSeenAt: string | null; createdAt: string }
interface DoorRow { id: string; externalId: string; name: string; active: boolean; siteId: string; siteName: string; readers: ReaderRow[] }
interface EventRow { id: string; at: string; method: 'QR' | 'NFC'; result: 'GRANTED' | 'DENIED'; reason: string; door: string; site: string; timezone: string; employee: string | null; externalId: string | null }
interface KeyRow { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

const origin = () => window.location.origin;

interface PermissionForm { door: string; days: number[]; from: string; to: string }
interface EmployeeForm {
  id: string | null; source: 'API' | 'CONSOLE'; externalId: string; firstName: string; lastName: string; email: string; department: string; jobTitle: string;
  badgeHint: string | null; badgeUid: string; removeBadge: boolean; active: boolean; validFrom: string; validUntil: string; permissions: PermissionForm[];
}
const NAME_PATTERN = "[\\p{L}\\p{M}' .\\-]+";
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const emptyEmployee = (): EmployeeForm => ({
  id: null, source: 'CONSOLE', externalId: '', firstName: '', lastName: '', email: '', department: '', jobTitle: '',
  badgeHint: null, badgeUid: '', removeBadge: false, active: true, validFrom: '', validUntil: '', permissions: [],
});
const toForm = (e: EmployeeRow): EmployeeForm => ({
  id: e.id, source: e.source, externalId: e.externalId, firstName: e.firstName, lastName: e.lastName, email: e.email ?? '', department: e.department ?? '', jobTitle: e.jobTitle ?? '',
  badgeHint: e.badgeHint, badgeUid: '', removeBadge: false, active: e.active,
  // The end of validity is exclusive (midnight after the last day): show the last day included.
  validFrom: e.validFrom ? localDate(new Date(e.validFrom)) : '', validUntil: e.validUntil ? localDate(new Date(new Date(e.validUntil).getTime() - 1)) : '',
  permissions: e.permissions.map((p) => ({ door: p.doorExternalId, days: p.days ?? [], from: p.from ?? '', to: p.to ?? '' })),
});

/** Employees from the external system or added by hand; the administrator edits them here. */
export function EmployeesPage() {
  const { t, intl } = useI18n();
  const me = useMe();
  const canEdit = me.role === 'SUPER_ADMIN';
  const list = useAsync(() => api.get<EmployeeRow[]>('/admin/access/employees'), []);
  const doors = useAsync(() => (canEdit ? api.get<DoorRow[]>('/admin/access/doors') : Promise.resolve([] as DoorRow[])), [canEdit]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<EmployeeForm | null>(null);
  const [busy, setBusy] = useState(false);
  const term = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((e) => !term || [e.firstName, e.lastName, e.externalId, e.email, e.department].some((x) => x?.toLowerCase().includes(term)));
  const dayNames = t.access.weekdays;
  const rule = (p: Permission) => `${p.days ? p.days.map((d) => dayNames[d - 1]).join(' ') : t.access.everyDay}${p.from ? ` ${p.from}–${p.to}` : ''}`;
  const revoke = async (e: EmployeeRow) => {
    if (!window.confirm(t.access.revokeConfirm.replace('{name}', `${e.firstName} ${e.lastName}`))) return;
    try { await api.post(`/admin/access/employees/${e.id}/revoke-phone`); setMsg({ ok: true, text: t.access.revoked }); list.reload(); } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };
  const open = (f: EmployeeForm) => { setMsg(null); setForm(f); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    const body = {
      firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim() || null,
      department: form.department.trim() || null, jobTitle: form.jobTitle.trim() || null, active: form.active,
      validFrom: form.validFrom ? dayStart(form.validFrom) : null, validUntil: form.validUntil ? dayEnd(form.validUntil) : null,
      permissions: form.permissions.filter((p) => p.door).map((p) => ({ door: p.door, ...(p.days.length ? { days: [...p.days].sort() } : {}), ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}) })),
      // On edit an empty field keeps the current card; null removes it.
      ...(form.id ? (form.removeBadge ? { badgeUid: null } : form.badgeUid.trim() ? { badgeUid: form.badgeUid.trim() } : {}) : { badgeUid: form.badgeUid.trim() || null }),
    };
    setBusy(true); setMsg(null);
    try {
      if (form.id) await api.put(`/admin/access/employees/${form.id}`, body);
      else await api.post('/admin/access/employees', { ...body, ...(form.externalId.trim() ? { externalId: form.externalId.trim() } : {}) });
      setForm(null); setMsg({ ok: true, text: t.access.employeeSaved }); list.reload();
    } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!form?.id || !window.confirm(t.access.deleteConfirm.replace('{name}', `${form.firstName} ${form.lastName}`))) return;
    setBusy(true); setMsg(null);
    try { await api.del(`/admin/access/employees/${form.id}`); setForm(null); setMsg({ ok: true, text: t.access.employeeDeleted }); list.reload(); }
    catch (err) { setMsg({ ok: false, text: errorText(t, err) }); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title={t.access.employeesTitle} intro={t.access.employeesIntro}
        actions={canEdit && !form && <button type="button" className="btn btn-primary" onClick={() => open(emptyEmployee())}>{t.access.addEmployee}</button>} />
      <ErrorBox error={list.error ?? doors.error} />
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>
      {form && <EmployeeEditor form={form} setForm={setForm} doors={doors.data ?? []} busy={busy} onSubmit={save} onDelete={remove} />}
      <div className="a-card inline" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <span>{t.access.badgePage}: <code translate="no">{origin()}/badge</code></span>
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
                  <td><strong>{e.lastName} {e.firstName}</strong>{!e.active && <> <span className="pill">{t.access.inactive}</span></>}
                    {e.department && <><br /><span className="muted">{e.department}</span></>}
                    {e.email ? <><br /><span className="muted">{e.email}</span></> : <><br /><span className="error">{t.access.noEmail}</span></>}</td>
                  <td className="num">{e.externalId}{e.source === 'CONSOLE' && <div className="host-tags"><span className="tag">{t.access.manual}</span></div>}</td>
                  <td>{e.badgeHint ? <>{t.access.card} ···{e.badgeHint}</> : null}{e.badgeHint && e.phoneBadge ? <br /> : null}{e.phoneBadge ? t.access.phone : null}{!e.badgeHint && !e.phoneBadge && <span className="muted">—</span>}</td>
                  <td className="wrap">{e.permissions.length ? e.permissions.map((p, i) => <div key={i}><strong>{p.door}</strong> <span className="muted">{p.site} · {rule(p)}</span></div>) : <span className="muted">{t.access.noDoors}</span>}</td>
                  <td className="num">{e.validFrom || e.validUntil ? `${e.validFrom ? fmtDateTime(e.validFrom, intl) : '…'} → ${e.validUntil ? fmtDateTime(e.validUntil, intl) : '…'}` : t.access.always}</td>
                  <td className="inline" style={{ justifyContent: 'flex-end' }}>
                    {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(toForm(e))}>{t.access.edit}</button>}
                    {e.phoneBadge && me.role !== 'AUDITOR' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(e)}>{t.access.revokePhone}</button>}
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

function EmployeeEditor({ form, setForm, doors, busy, onSubmit, onDelete }: {
  form: EmployeeForm; setForm: (f: EmployeeForm | null) => void; doors: DoorRow[]; busy: boolean; onSubmit: (e: React.FormEvent) => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const A = t.access;
  const field = (k: 'firstName' | 'lastName' | 'email' | 'department' | 'jobTitle' | 'externalId' | 'badgeUid' | 'validFrom' | 'validUntil') =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const setPerm = (i: number, p: Partial<PermissionForm>) => setForm({ ...form, permissions: form.permissions.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  // Doors already given stay selectable even if deactivated since.
  const usable = doors.filter((d) => d.active || form.permissions.some((p) => p.door === d.externalId));
  const free = usable.filter((d) => !form.permissions.some((p) => p.door === d.externalId));

  return (
    <form className="a-card stack" style={{ marginBottom: 16 }} onSubmit={onSubmit}>
      <h2 style={{ margin: 0 }}>{form.id ? A.editEmployee : A.addEmployee}</h2>
      {form.id && form.source === 'API' && <p className="alert alert-info" style={{ margin: 0 }}>{A.fromApiWarning}</p>}
      <div className="a-grid">
        <div className="field"><label htmlFor="ef">{A.firstName}</label><input id="ef" className="input" value={form.firstName} onChange={field('firstName')} maxLength={80} pattern={NAME_PATTERN} autoComplete="off" required /></div>
        <div className="field"><label htmlFor="el">{A.lastName}</label><input id="el" className="input" value={form.lastName} onChange={field('lastName')} maxLength={80} pattern={NAME_PATTERN} autoComplete="off" required /></div>
        <div className="field"><label htmlFor="ee">{A.email}</label><input id="ee" className="input" type="email" value={form.email} onChange={field('email')} maxLength={190} autoComplete="off" spellCheck={false} aria-describedby="ee-h" /><span id="ee-h" className="hint">{A.emailHint}</span></div>
        <div className="field"><label htmlFor="ed">{A.department}</label><input id="ed" className="input" value={form.department} onChange={field('department')} maxLength={120} /></div>
        <div className="field"><label htmlFor="ej">{A.jobTitle}</label><input id="ej" className="input" value={form.jobTitle} onChange={field('jobTitle')} maxLength={120} /></div>
        {form.id
          ? <div className="field"><span className="label">{A.externalId}</span><code translate="no" style={{ alignSelf: 'flex-start' }}>{form.externalId}</code></div>
          : <div className="field"><label htmlFor="ex">{A.externalId}</label><input id="ex" className="input" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value.replace(/[^A-Za-z0-9._:@-]/g, '') })} maxLength={100} spellCheck={false} aria-describedby="ex-h" /><span id="ex-h" className="hint">{A.externalIdAuto}</span></div>}
      </div>

      <div className="a-grid">
        {form.badgeHint && (
          <div className="field"><span className="label">{A.currentCard.replace('{hint}', form.badgeHint)}</span>
            <label className="toggle"><input type="checkbox" checked={form.removeBadge} onChange={(e) => setForm({ ...form, removeBadge: e.target.checked, badgeUid: '' })} />{A.removeCard}</label></div>
        )}
        {!form.removeBadge && (
          <div className="field"><label htmlFor="eb">{form.badgeHint ? A.newCard : A.cardUid}</label>
            <input id="eb" className="input num" value={form.badgeUid} onChange={field('badgeUid')} maxLength={40} pattern="[0-9A-Fa-f:\- ]*" spellCheck={false} autoComplete="off" aria-describedby="eb-h" />
            <span id="eb-h" className="hint">{form.badgeHint ? A.newCardHint : A.cardUidHint}</span></div>
        )}
        <div className="field"><label htmlFor="evf">{A.validFrom}</label><input id="evf" className="input" type="date" value={form.validFrom} onChange={field('validFrom')} max={form.validUntil || undefined} aria-describedby="ev-h" /></div>
        <div className="field"><label htmlFor="evu">{A.validUntil}</label><input id="evu" className="input" type="date" value={form.validUntil} onChange={field('validUntil')} min={form.validFrom || undefined} aria-describedby="ev-h" /><span id="ev-h" className="hint">{A.validityHint}</span></div>
      </div>
      <label className="toggle"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{A.activeLabel}</label>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ fontWeight: 700, marginBottom: 8 }}>{A.permissionsTitle}</legend>
        {usable.length === 0 && <p className="muted" style={{ margin: 0 }}>{A.noDoorsToAssign}</p>}
        <div className="stack" style={{ gap: 12 }}>
          {form.permissions.map((p, i) => (
            <div key={i} className="perm-row">
              <div className="field"><label htmlFor={`pd${i}`}>{A.door}</label>
                <select id={`pd${i}`} className="input" value={p.door} onChange={(e) => setPerm(i, { door: e.target.value })} required>
                  <option value="" disabled>—</option>
                  {usable.filter((d) => d.externalId === p.door || !form.permissions.some((x) => x.door === d.externalId)).map((d) => <option key={d.id} value={d.externalId}>{d.name} · {d.siteName}</option>)}
                </select></div>
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="label">{A.days}</legend>
                <div className="segmented" role="group" aria-label={A.days} title={A.daysHint}>
                  {t.access.weekdays.map((name, d) => (
                    <button key={d} type="button" aria-pressed={p.days.includes(d + 1)}
                      onClick={() => setPerm(i, { days: p.days.includes(d + 1) ? p.days.filter((x) => x !== d + 1) : [...p.days, d + 1] })}>{name}</button>
                  ))}
                </div>
                <span className="hint">{p.days.length ? '' : A.daysHint}</span>
              </fieldset>
              <div className="field"><label htmlFor={`pf${i}`}>{A.fromTime}</label><input id={`pf${i}`} className="input" type="time" value={p.from} onChange={(e) => setPerm(i, { from: e.target.value })} required={!!p.to} /></div>
              <div className="field"><label htmlFor={`pt${i}`}>{A.toTime}</label><input id={`pt${i}`} className="input" type="time" value={p.to} onChange={(e) => setPerm(i, { to: e.target.value })} required={!!p.from} />
                {!p.from && !p.to && <span className="hint">{A.timeHint}</span>}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, permissions: form.permissions.filter((_, j) => j !== i) })}>{A.removePermission}</button>
            </div>
          ))}
        </div>
        {free.length > 0 && (
          <div><button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
            onClick={() => setForm({ ...form, permissions: [...form.permissions, { door: free[0].externalId, days: [], from: '', to: '' }] })}>{A.addPermission}</button></div>
        )}
      </fieldset>

      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <div className="inline">
          <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{t.hosts.save}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t.hosts.cancel}</button>
        </div>
        {form.id && <button type="button" className="btn btn-ghost is-danger" onClick={onDelete} disabled={busy}>{A.deleteEmployee}</button>}
      </div>
    </form>
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
                      <span>{r.name} <ReaderStatus lastSeenAt={r.lastSeenAt} /></span>
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
          <div className="segmented" role="group" aria-label={t.access.result}>
            {(['', 'GRANTED', 'DENIED'] as const).map((r) => <button key={r || 'all'} type="button" aria-pressed={result === r} onClick={() => setResult(r)}>{r ? t.access.results[r] : t.access.all}</button>)}
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
          <div className="inline"><code translate="no" style={{ wordBreak: 'break-all' }}>{created}</code><CopyButton text={created} /></div>
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
                  <td><code translate="no">{k.prefix}…</code></td>
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
            <tr><td><code translate="no">PUT</code></td><td><code translate="no">/doors/&#123;id&#125;</code></td><td>{t.access.docDoor}</td></tr>
            <tr><td><code translate="no">PUT</code></td><td><code translate="no">/employees/&#123;id&#125;</code></td><td>{t.access.docPut}</td></tr>
            <tr><td><code translate="no">DELETE</code></td><td><code translate="no">/employees/&#123;id&#125;</code></td><td>{t.access.docDelete}</td></tr>
          </tbody>
        </table>
        <p style={{ margin: 0 }}>{t.access.baseUrl}: <code translate="no">{base}</code></p>
        <pre className="code-block" translate="no">{example}</pre>
      </section>
    </>
  );
}

/** A fixed reader calls in every minute: after 3 minutes of silence it is shown as unreachable. */
const OFFLINE_AFTER_MS = 3 * 60_000;
function ReaderStatus({ lastSeenAt }: { lastSeenAt: string | null }) {
  const { t, intl } = useI18n();
  const online = !!lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < OFFLINE_AFTER_MS;
  return (
    <span className={`pill ${online ? 'OPEN' : 'ERASED'}`} title={lastSeenAt ? fmtDateTime(lastSeenAt, intl) : undefined} style={{ marginLeft: 6 }}>
      {online ? t.access.online : lastSeenAt ? t.access.offlineSince.replace('{time}', fmtDateTime(lastSeenAt, intl)) : t.access.readerNever}
    </span>
  );
}
