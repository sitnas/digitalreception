import { useState } from 'react';
import { api } from '../../lib/api';
import { errorText, useI18n } from '../i18n';
import type { Policy, Site } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

const SUGGESTED_TZ: Record<string, string> = { IT: 'Europe/Rome', ES: 'Europe/Madrid', PE: 'America/Lima', CO: 'America/Bogota', FR: 'Europe/Paris', DE: 'Europe/Berlin', PT: 'Europe/Lisbon', GB: 'Europe/London', MX: 'America/Mexico_City' };

export function SitesPage() {
  const { t } = useI18n();
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const policies = useAsync(() => api.get<Policy[]>('/admin/policies'), []);
  const [f, setF] = useState({ code: '', name: '', countryCode: '', timezone: '' });
  const [error, setError] = useState<string | null>(null);
  const country = f.countryCode || policies.data?.[0]?.countryCode || '';

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      await api.post('/admin/sites', { ...f, countryCode: country, timezone: f.timezone || SUGGESTED_TZ[country] || '' });
      setF({ code: '', name: '', countryCode: '', timezone: '' }); sites.reload();
    } catch (err) { setError(errorText(t, err)); }
  };
  const toggle = async (s: Site) => {
    setError(null);
    try { await api.patch(`/admin/sites/${s.id}`, { active: !s.active }); sites.reload(); } catch (err) { setError(errorText(t, err)); }
  };

  return (
    <>
      <PageHead title={t.sites.title} intro={t.sites.intro} />
      <ErrorBox error={sites.error ?? policies.error} />
      <div className="a-card">
        <h2>{t.sites.add}</h2>
        <form className="inline" style={{ alignItems: 'end' }} onSubmit={create}>
          <div className="field"><label htmlFor="sc">{t.sites.code}</label><input id="sc" className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} pattern="[A-Z0-9\-]{2,16}" placeholder="MI-01" required style={{ width: 120 }} /></div>
          <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="sn">{t.sites.name}</label><input id="sn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={2} maxLength={120} required /></div>
          <div className="field"><label htmlFor="scc">{t.sites.country}</label>
            <select id="scc" className="input" value={country} onChange={(e) => setF({ ...f, countryCode: e.target.value, timezone: '' })}>
              {policies.data?.map((p) => <option key={p.countryCode} value={p.countryCode}>{p.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="stz">{t.sites.timezone}</label><input id="stz" className="input" value={f.timezone || SUGGESTED_TZ[country] || ''} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="Europe/Rome" required /></div>
          <button className="btn btn-primary">{t.sites.save}</button>
        </form>
        {error && <p className="alert" role="alert" style={{ marginTop: 14 }}>{error}</p>}
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>{t.sites.code}</th><th>{t.sites.name}</th><th>{t.sites.country}</th><th>{t.sites.timezone}</th><th>{t.statusLabel}</th><th></th></tr></thead>
          <tbody>
            {sites.data?.map((s) => (
              <tr key={s.id}>
                <td className="num">{s.code}</td><td><strong>{s.name}</strong></td><td>{s.countryCode}</td><td>{s.timezone}</td>
                <td>{s.active ? <span className="pill OPEN">{t.sites.active}</span> : <span className="pill">{t.sites.inactive}</span>}</td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(s)}>{s.active ? t.sites.deactivate : t.sites.activate}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
