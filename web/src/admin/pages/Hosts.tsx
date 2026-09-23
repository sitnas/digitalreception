import { useState } from 'react';
import { api } from '../../lib/api';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { HostRow, Site } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

interface Form { id?: string; firstName: string; lastName: string; department: string; jobTitle: string; email: string; phone: string; siteIds: string[] }
const empty: Form = { firstName: '', lastName: '', department: '', jobTitle: '', email: '', phone: '', siteIds: [] };

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
    const { id, ...body } = form;
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
    setForm({ id: h.id, firstName: h.firstName, lastName: h.lastName, department: h.department ?? '', jobTitle: h.jobTitle ?? '', email: h.email ?? '', phone: h.phone ?? '', siteIds: h.sites.filter((s) => mySites.some((m) => m.id === s.id)).map((s) => s.id) });
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
          <div className="a-grid">
            <div className="field"><label htmlFor="hf">{t.hosts.firstName}</label><input id="hf" className="input" value={form.firstName} onChange={field('firstName')} maxLength={80} required /></div>
            <div className="field"><label htmlFor="hl">{t.hosts.lastName}</label><input id="hl" className="input" value={form.lastName} onChange={field('lastName')} maxLength={80} required /></div>
            <div className="field"><label htmlFor="hd">{t.hosts.department}</label><input id="hd" className="input" value={form.department} onChange={field('department')} maxLength={120} /></div>
            <div className="field"><label htmlFor="hj">{t.hosts.jobTitle}</label><input id="hj" className="input" value={form.jobTitle} onChange={field('jobTitle')} maxLength={120} /></div>
            <div className="field"><label htmlFor="he">{t.hosts.email}</label><input id="he" className="input" type="email" value={form.email} onChange={field('email')} maxLength={190} /></div>
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
                <tr key={h.id} style={h.active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{h.lastName} {h.firstName}</strong>{!h.active && <> <span className="pill">{t.hosts.inactive}</span></>}</td>
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
