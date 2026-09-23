import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime, fmtTime } from '../../lib/format';
import { errorText, useI18n } from '../i18n';
import type { Device, Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';

export function DevicesPage() {
  const { t, intl } = useI18n();
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const devices = useAsync(() => api.get<Device[]>('/admin/devices'), []);
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeSites = sites.data?.filter((s) => s.active) ?? [];
  const selected = siteId || activeSites[0]?.id || '';

  const generate = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setCode(null);
    try { setCode(await api.post('/admin/devices/pairing-code', { siteId: selected, name })); setName(''); devices.reload(); }
    catch (err) { setError(errorText(t, err)); }
  };
  const revoke = async (id: string) => {
    if (!window.confirm(t.devices.confirmRevoke)) return;
    try { await api.post(`/admin/devices/${id}/revoke`); devices.reload(); } catch (err) { setError(errorText(t, err)); }
  };

  return (
    <>
      <PageHead title={t.devices.title} intro={t.devices.intro} />
      <ErrorBox error={sites.error ?? devices.error} />
      <div className="a-card">
        <h2>{t.devices.pair}</h2>
        <form className="inline" style={{ alignItems: 'end' }} onSubmit={generate}>
          {activeSites.length > 0 && <SiteSelect sites={activeSites} value={selected} onChange={setSiteId} id="dsite" />}
          <div className="field" style={{ flex: '1 1 240px' }}><label htmlFor="dn">{t.devices.name}</label><input id="dn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.devices.namePh} minLength={2} maxLength={80} required /></div>
          <button className="btn btn-primary" disabled={!selected}>{t.devices.generate}</button>
        </form>
        {error && <p className="alert" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        {code && (
          <div className="stack" style={{ marginTop: 18 }} role="status">
            <div className="codebox num">{code.code}</div>
            <p style={{ margin: 0 }}>{t.devices.codeIntro} {t.devices.expires} {fmtTime(code.expiresAt, intl)}.</p>
          </div>
        )}
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        {devices.data && devices.data.length === 0 ? <p className="empty">{t.devices.none}</p> : (
          <table>
            <thead><tr><th>{t.devices.name}</th><th>{t.site}</th><th>{t.devices.paired}</th><th>{t.devices.lastSeen}</th><th>{t.statusLabel}</th><th></th></tr></thead>
            <tbody>
              {devices.data?.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td><td>{d.site?.name}</td>
                  <td className="num">{fmtDateTime(d.createdAt, intl)}</td><td className="num">{fmtDateTime(d.lastSeenAt, intl)}</td>
                  <td>{d.revokedAt ? <span className="pill ERASED">{t.devices.revoked}</span> : <span className="pill OPEN">{t.devices.active}</span>}</td>
                  <td>{!d.revokedAt && <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(d.id)}>{t.devices.revoke}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
