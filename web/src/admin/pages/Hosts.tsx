import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { HostCandidate, HostRow, Site } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

interface Form { id?: string; firstName: string; lastName: string; department: string; jobTitle: string; email: string; phone: string; siteIds: string[]; employeeId: string | null }
const empty: Form = { firstName: '', lastName: '', department: '', jobTitle: '', email: '', phone: '', siteIds: [], employeeId: null };

/** Directory of people who can be visited: the tablet lets the visitor pick one of them. */
export function HostsPage() {
  const { t } = useI18n();
  const me = useMe();
  const hosts = useAsync(() => api.get<HostRow[]>('/admin/hosts'), []);
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mySites = (sites.data ?? []).filter((s) => s.active && (me.role === 'SUPER_ADMIN' || me.siteIds.includes(s.id)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setError(null);
    const { id, employeeId, ...fields } = form;
    // A linked person's name and email come from the employee record (the server enforces it too).
    const body = employeeId ? { ...fields, email: undefined, employeeId } : { ...fields, ...(id ? { employeeId: null } : {}) };
    try {
      if (id) await api.patch(`/admin/hosts/${id}`, body);
      else await api.post('/admin/hosts', body);
      setForm(null); setNotice(t.hosts.saved); hosts.reload();
    } catch (err) { setError(errorText(t, err)); }
  };
  const toggle = async (h: HostRow) => {
    setError(null);
    try { await api.patch(`/admin/hosts/${h.id}`, { active: !h.active }); hosts.reload(); } catch (err) { setError(errorText(t, err)); }
  };
  const edit = (h: HostRow) => {
    setNotice(null);
    setForm({ id: h.id, firstName: h.firstName, lastName: h.lastName, department: h.department ?? '', jobTitle: h.jobTitle ?? '', email: h.email ?? '', phone: h.phone ?? '', siteIds: h.sites.filter((s) => mySites.some((m) => m.id === s.id)).map((s) => s.id), employeeId: h.employeeId });
  };

  const term = filter.trim().toLowerCase();
  const rows = (hosts.data ?? []).filter((h) => !term || [h.firstName, h.lastName, h.department, h.jobTitle].some((x) => x?.toLowerCase().includes(term)));
  const field = (k: keyof Omit<Form, 'id' | 'siteIds'>) => (e: React.ChangeEvent<HTMLInputElement>) => form && setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHead title={t.hosts.title} intro={t.hosts.intro}
        actions={!form && <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setForm({ ...empty, siteIds: mySites.length === 1 ? [mySites[0].id] : [] }); }}>{t.hosts.add}</button>} />
      <ErrorBox error={hosts.error ?? sites.error} />
      {notice && <p className="alert alert-info" role="status">{notice}</p>}
      {error && <p className="alert" role="alert">{error}</p>}

      {form && (
        <form className="a-card stack" onSubmit={save}>
          <h2>{form.id ? t.hosts.edit : t.hosts.add}</h2>
          <EmployeePicker form={form} onPick={(c) => setForm({
            ...form, employeeId: c.id, firstName: c.firstName ?? '', lastName: c.lastName ?? '', email: c.email ?? '',
            department: form.department || c.department || '', jobTitle: form.jobTitle || c.jobTitle || '',
          })} onUnlink={() => setForm({ ...form, employeeId: null })} />
          <div className="a-grid">
            <div className="field"><label htmlFor="hf">{t.hosts.firstName}</label><input id="hf" className="input" value={form.firstName} onChange={field('firstName')} maxLength={80} required readOnly={!!form.employeeId} /></div>
            <div className="field"><label htmlFor="hl">{t.hosts.lastName}</label><input id="hl" className="input" value={form.lastName} onChange={field('lastName')} maxLength={80} required readOnly={!!form.employeeId} /></div>
            <div className="field"><label htmlFor="hd">{t.hosts.department}</label><input id="hd" className="input" value={form.department} onChange={field('department')} maxLength={120} /></div>
            <div className="field"><label htmlFor="hj">{t.hosts.jobTitle}</label><input id="hj" className="input" value={form.jobTitle} onChange={field('jobTitle')} maxLength={120} /></div>
            <div className="field"><label htmlFor="he">{t.hosts.email}</label><input id="he" className="input" type="email" value={form.email} onChange={field('email')} maxLength={190} readOnly={!!form.employeeId} /></div>
            <div className="field"><label htmlFor="hp">{t.hosts.phone}</label><input id="hp" className="input" type="tel" value={form.phone} onChange={field('phone')} maxLength={40} pattern="[0-9 +().\-/]*" /></div>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ fontWeight: 700, marginBottom: 8 }}>{t.hosts.sites}</legend>
            <div className="inline">
              {mySites.map((s) => (
                <label key={s.id} className="toggle"><input type="checkbox" checked={form.siteIds.includes(s.id)}
                  onChange={(e) => setForm({ ...form, siteIds: e.target.checked ? [...form.siteIds, s.id] : form.siteIds.filter((x) => x !== s.id) })} />{s.name}</label>
              ))}
            </div>
          </fieldset>
          <div className="inline"><button className="btn btn-primary">{t.hosts.save}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t.hosts.cancel}</button></div>
        </form>
      )}

      {hosts.data && hosts.data.length > 0 && (
        <div className="a-filters">
          <div className="field" style={{ flex: '1 1 260px' }}><label htmlFor="hs">{t.hosts.search}</label><input id="hs" className="input" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        </div>
      )}
      <div className="table-wrap" style={{ marginTop: 16 }}>
        {hosts.data && hosts.data.length === 0 ? <p className="empty">{t.hosts.none}</p> : (
          <table>
            <thead><tr><th>{t.users.name}</th><th>{t.hosts.department}</th><th>{t.hosts.jobTitle}</th><th>{t.hosts.email}</th><th>{t.hosts.phone}</th><th>{t.users.sites}</th><th></th></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} className={h.active ? undefined : 'row-off'}>
                  <td>
                    <strong>{h.lastName} {h.firstName}</strong>{!h.active && <> <span className="pill">{t.hosts.inactive}</span></>}
                    {h.employeeId && <div className="host-tags"><span className="tag">{t.hosts.employee}</span>{h.appInvites && <span className="tag tag-pos" title={t.hosts.appInvitesHelp}>{t.hosts.appInvites}</span>}</div>}
                  </td>
                  <td>{h.department ?? '—'}</td><td>{h.jobTitle ?? '—'}</td><td>{h.email ?? '—'}</td><td className="num">{h.phone ?? '—'}</td>
                  <td className="wrap">{h.sites.map((s) => s.name).join(', ') || '—'}</td>
                  <td className="inline">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(h)}>{t.hosts.edit}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(h)}>{h.active ? t.hosts.deactivate : t.hosts.activate}</button>
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

/**
 * Picks the person among the employees sent by the external system. Loaded only when the form is
 * open; filtered here (names are stored encrypted, the server cannot search them).
 */
function EmployeePicker({ form, onPick, onUnlink }: { form: Form; onPick: (c: HostCandidate) => void; onUnlink: () => void }) {
  const { t } = useI18n();
  const list = useAsync(() => api.get<HostCandidate[]>('/admin/hosts/employees'), []);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const matches = useMemo(() => !term ? [] : (list.data ?? [])
    .filter((c) => [c.firstName, c.lastName, `${c.firstName} ${c.lastName}`, c.email, c.department, c.externalId].some((x) => x?.toLowerCase().includes(term)))
    .slice(0, 8), [list.data, term]);
  const linked = form.employeeId ? list.data?.find((c) => c.id === form.employeeId) : null;

  if (form.employeeId) return (
    <div className="linked-employee" role="group" aria-label={t.hosts.fromEmployee}>
      <div>
        <strong>{t.hosts.linkedTo.replace('{name}', linked ? `${linked.firstName} ${linked.lastName}` : `${form.firstName} ${form.lastName}`)}</strong>
        {linked && <span className="muted"> · <code translate="no">{linked.externalId}</code></span>}
        <p className="hint" style={{ margin: '4px 0 0' }}>{t.hosts.linkedHint}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onUnlink}>{t.hosts.unlink}</button>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ErrorBox error={list.error} />
      <div className="field">
        <label htmlFor="emp-q">{t.hosts.fromEmployee}</label>
        <input id="emp-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.hosts.searchEmployees}
          autoComplete="off" spellCheck={false} aria-describedby="emp-hint" aria-controls="emp-results" disabled={!list.data?.length} />
      </div>
      {list.data && !list.data.length && <p id="emp-hint" className="hint" style={{ margin: 0 }}>{t.hosts.noEmployees}</p>}
      {term && (
        <ul id="emp-results" className="pick-list" aria-live="polite">
          {matches.length === 0 && <li className="muted">{t.hosts.noMatch}</li>}
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onPick(c); setQ(''); }} disabled={!!c.hostId && c.hostId !== form.id}>
                <strong>{c.lastName} {c.firstName}</strong>
                <small>{[c.department, c.email].filter(Boolean).join(' · ')}{c.hostId && c.hostId !== form.id ? ` · ${t.hosts.alreadyHost}` : ''}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.length > 0 && <p id="emp-hint" className="hint" style={{ margin: 0 }}>{t.hosts.orManual}</p>}
    </div>
  );
}
