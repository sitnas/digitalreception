import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Role, Site, UserRow } from '../types';
import { ErrorBox, PageHead, strongPassword, useAsync } from '../ui';

const ROLES: Role[] = ['RECEPTIONIST', 'SITE_MANAGER', 'AUDITOR', 'SUPER_ADMIN'];
interface Form { id?: string; email: string; displayName: string; role: Role; siteIds: string[]; temporaryPassword: string }
const empty: Form = { email: '', displayName: '', role: 'RECEPTIONIST', siteIds: [], temporaryPassword: '' };

export function UsersPage() {
  const { t, intl } = useI18n();
  const me = useMe();
  const users = useAsync(() => api.get<UserRow[]>('/admin/users'), []);
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const needsSites = form && (form.role === 'SITE_MANAGER' || form.role === 'RECEPTIONIST');

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setError(null);
    const siteIds = needsSites ? form.siteIds : [];
    try {
      if (form.id) await api.patch(`/admin/users/${form.id}`, { displayName: form.displayName, role: form.role, siteIds });
      else await api.post('/admin/users', { ...form, siteIds });
      setForm(null); setNotice(t.users.saved); users.reload();
    } catch (err) { setError(errorText(t, err)); }
  };
  const update = async (u: UserRow, body: object) => {
    setError(null);
    try { await api.patch(`/admin/users/${u.id}`, body); users.reload(); } catch (err) { setError(errorText(t, err)); }
  };
  const reset = async (u: UserRow) => {
    const pwd = strongPassword();
    if (!window.confirm(`${t.users.resetPwd}: ${u.email}?`)) return;
    try { await api.post(`/admin/users/${u.id}/reset-password`, { temporaryPassword: pwd }); setNotice(`${t.users.tempPwd} (${u.email}): ${pwd}`); }
    catch (err) { setError(errorText(t, err)); }
  };

  return (
    <>
      <PageHead title={t.users.title} intro={t.users.intro} actions={!form && <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setForm({ ...empty, temporaryPassword: strongPassword() }); }}>{t.users.add}</button>} />
      <ErrorBox error={users.error ?? sites.error} />
      {notice && <p className="alert alert-info" role="status">{notice}</p>}
      {error && <p className="alert" role="alert">{error}</p>}

      {form && (
        <form className="a-card stack" onSubmit={save}>
          <h2>{form.id ? t.users.edit : t.users.add}</h2>
          <div className="a-grid">
            <div className="field"><label htmlFor="un">{t.users.name}</label><input id="un" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} minLength={2} maxLength={120} required /></div>
            <div className="field"><label htmlFor="ue">{t.users.email}</label><input id="ue" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required disabled={!!form.id} /></div>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ fontWeight: 700, marginBottom: 8 }}>{t.users.role}</legend>
            {ROLES.map((r) => (
              <label key={r} className="toggle" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
                <input type="radio" name="role" checked={form.role === r} onChange={() => setForm({ ...form, role: r })} disabled={form.id === me.id} />
                <span><strong>{t.roles[r]}</strong><br /><span className="muted">{t.users.roleHelp[r]}</span></span>
              </label>
            ))}
          </fieldset>
          {needsSites && (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ fontWeight: 700, marginBottom: 8 }}>{t.users.sites}</legend>
              <div className="inline">
                {sites.data?.map((s) => (
                  <label key={s.id} className="toggle"><input type="checkbox" checked={form.siteIds.includes(s.id)}
                    onChange={(e) => setForm({ ...form, siteIds: e.target.checked ? [...form.siteIds, s.id] : form.siteIds.filter((x) => x !== s.id) })} />{s.name}</label>
                ))}
              </div>
            </fieldset>
          )}
          {!form.id && (
            <div className="field"><label htmlFor="up">{t.users.tempPwd}</label>
              <div className="inline"><input id="up" className="input num" style={{ maxWidth: 320 }} value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} minLength={12} required />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, temporaryPassword: strongPassword() })}>{t.users.generate}</button></div>
              <span className="hint">{t.users.tempPwdHint}</span></div>
          )}
          <div className="inline"><button className="btn btn-primary">{t.users.save}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t.users.cancel}</button></div>
        </form>
      )}

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>{t.users.name}</th><th>{t.users.email}</th><th>{t.users.role}</th><th>{t.users.sites}</th><th>{t.users.lastLogin}</th><th></th></tr></thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                <td><strong>{u.displayName}</strong>{!u.active && <> <span className="pill">{t.users.inactive}</span></>}</td><td>{u.email}</td><td>{t.roles[u.role]}</td>
                <td className="wrap">{u.role === 'SUPER_ADMIN' ? t.allSites : u.role === 'AUDITOR' ? '—' : u.sites.map((s) => s.name).join(', ') || '—'}</td>
                <td className="num">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt, intl) : t.users.never}</td>
                <td className="inline">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNotice(null); setForm({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, siteIds: u.sites.map((s) => s.id), temporaryPassword: '' }); }}>{t.users.edit}</button>
                  {u.id !== me.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset(u)}>{t.users.resetPwd}</button>}
                  {u.id !== me.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(u, { active: !u.active })}>{u.active ? t.users.deactivate : t.users.activate}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
