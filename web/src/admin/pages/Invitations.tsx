import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime, todayIso } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';

const PURPOSES = ['MEETING', 'INTERVIEW', 'SUPPLIER', 'MAINTENANCE', 'DELIVERY', 'OTHER'] as const;
type Status = 'PENDING' | 'USED' | 'CANCELLED' | 'EXPIRED';
interface Row {
  id: string; siteId: string; siteName: string; timezone: string; hostName: string; expectedAt: string; purpose: string;
  firstName: string; lastName: string; company: string | null; email: string; status: Status; emailStatus: string;
}
interface HostOption { id: string; firstName: string; lastName: string; department: string | null }
interface Form { siteId: string; hostId: string; date: string; time: string; firstName: string; lastName: string; company: string; email: string; purpose: string }

/** Pre-registered visits: the guest gets a QR by email and confirms on the tablet in a few seconds. */
export function InvitationsPage() {
  const { t, intl } = useI18n();
  const me = useMe();
  const canEdit = me.role !== 'AUDITOR';
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [siteId, setSiteId] = useState('');
  const list = useAsync(() => api.get<Row[]>(`/admin/invitations?scope=${scope}${siteId ? `&siteId=${siteId}` : ''}`), [scope, siteId]);
  const [form, setForm] = useState<Form | null>(null);
  const [qr, setQr] = useState<{ row: Row; code: string; qrSvg: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const activeSites = (sites.data ?? []).filter((s) => s.active);
  const multiSite = activeSites.length > 1;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); list.reload(); return true; } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); return false; }
  };
  const showQr = async (row: Row) => {
    setMsg(null);
    try { setQr({ row, ...(await api.get<{ code: string; qrSvg: string }>(`/admin/invitations/${row.id}/qr`)) }); }
    catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };

  return (
    <>
      <PageHead title={t.invites.title} intro={t.invites.intro}
        actions={canEdit && !form && activeSites.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => { setMsg(null); setForm({ siteId: activeSites.length === 1 ? activeSites[0].id : siteId, hostId: '', date: todayIso(), time: '10:00', firstName: '', lastName: '', company: '', email: '', purpose: 'MEETING' }); }}>{t.invites.add}</button>
        )} />
      <ErrorBox error={list.error ?? sites.error} />
      {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status">{msg.text}</p>}

      {form && <InviteForm form={form} setForm={setForm} sites={activeSites}
        onSaved={(emailSent) => { setForm(null); setMsg({ ok: true, text: emailSent ? t.invites.created : t.invites.createdNoEmail }); list.reload(); }} />}

      <div className="a-filters">
        <div className="field">
          <span className="label">{t.invites.show}</span>
          <div className="segmented" role="tablist" aria-label={t.invites.show}>
            <button type="button" role="tab" aria-selected={scope === 'upcoming'} onClick={() => setScope('upcoming')}>{t.invites.upcoming}</button>
            <button type="button" role="tab" aria-selected={scope === 'past'} onClick={() => setScope('past')}>{t.invites.past}</button>
          </div>
        </div>
        {multiSite && <SiteSelect sites={activeSites} value={siteId} onChange={setSiteId} allowAll />}
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        {list.data && list.data.length === 0 ? <p className="empty">{scope === 'upcoming' ? t.invites.noneUpcoming : t.invites.nonePast}</p> : (
          <table>
            <thead><tr><th>{t.invites.when}</th><th>{t.invites.guest}</th><th>{t.invites.host}</th>{multiSite && <th>{t.invites.site}</th>}<th>{t.invites.status}</th><th>{t.invites.emailCol}</th><th></th></tr></thead>
            <tbody>
              {(list.data ?? []).map((r) => (
                <tr key={r.id} style={r.status === 'CANCELLED' || r.status === 'EXPIRED' ? { opacity: 0.6 } : undefined}>
                  <td className="num">{fmtDateTime(r.expectedAt, intl, r.timezone)}</td>
                  <td><strong>{r.lastName} {r.firstName}</strong>{r.company && <><br /><span className="muted">{r.company}</span></>}</td>
                  <td>{r.hostName}</td>
                  {multiSite && <td>{r.siteName}</td>}
                  <td><span className={`pill ${r.status === 'PENDING' ? 'OPEN' : r.status === 'USED' ? '' : 'AUTO_CLOSED'}`}>{t.invites.statuses[r.status]}</span></td>
                  <td className="muted">{t.invites.emailStatuses[r.emailStatus as keyof typeof t.invites.emailStatuses] ?? r.emailStatus}</td>
                  <td className="inline" style={{ justifyContent: 'flex-end' }}>
                    {canEdit && r.status === 'PENDING' && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => showQr(r)}>{t.invites.showQr}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(() => api.post(`/admin/invitations/${r.id}/resend`), t.invites.resent.replace('{email}', r.email))}>{t.invites.resend}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm(t.invites.cancelConfirm.replace('{name}', `${r.firstName} ${r.lastName}`))) run(() => api.post(`/admin/invitations/${r.id}/cancel`), t.invites.cancelled); }}>{t.invites.cancel}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {qr && (
        <>
          <div className="drawer-back" onClick={() => setQr(null)} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="qr-title">
            <div className="drawer-head">
              <h2 id="qr-title">{qr.row.firstName} {qr.row.lastName}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQr(null)}>{t.detail.close}</button>
            </div>
            <p className="muted" style={{ margin: '2px 0 0' }}>{fmtDateTime(qr.row.expectedAt, intl, qr.row.timezone)} · {qr.row.hostName}</p>
            <div className="invite-qr">
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.qrSvg)}`} alt={`QR ${qr.code}`} />
              <code>{qr.code}</code>
            </div>
            <p className="hint">{t.invites.qrHint}</p>
          </aside>
        </>
      )}
    </>
  );
}

function InviteForm({ form, setForm, sites, onSaved }: { form: Form; setForm: (f: Form | null) => void; sites: Site[]; onSaved: (emailSent: boolean) => void }) {
  const { t } = useI18n();
  const [hosts, setHosts] = useState<HostOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setHosts(null);
    if (!form.siteId) return;
    api.get<HostOption[]>(`/admin/invitations/hosts?siteId=${form.siteId}`).then(setHosts).catch((e) => setError(errorText(t, e)));
  }, [form.siteId, t]);
  const siteTz = sites.find((s) => s.id === form.siteId)?.timezone;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      // Day and time are the site's local ones: the server converts them with the site's time zone.
      const r = await api.post<{ emailStatus: string }>('/admin/invitations', {
        siteId: form.siteId, hostId: form.hostId, date: form.date, time: form.time,
        firstName: form.firstName, lastName: form.lastName, company: form.company, email: form.email, purpose: form.purpose,
      });
      onSaved(r.emailStatus === 'PENDING');
    } catch (err) { setError(errorText(t, err)); } finally { setBusy(false); }
  };

  return (
    <form className="a-card stack" onSubmit={save} style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0 }}>{t.invites.add}</h2>
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="a-grid">
        {sites.length > 1 && <SiteSelect sites={sites} value={form.siteId} onChange={(v) => setForm({ ...form, siteId: v, hostId: '' })} id="is" />}
        <div className="field">
          <label htmlFor="ih">{t.invites.host}</label>
          <select id="ih" className="input" value={form.hostId} onChange={set('hostId')} required disabled={!hosts}>
            <option value="">{hosts && hosts.length === 0 ? t.invites.noHosts : t.invites.pickHost}</option>
            {(hosts ?? []).map((h) => <option key={h.id} value={h.id}>{h.lastName} {h.firstName}{h.department ? ` — ${h.department}` : ''}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="id">{t.invites.date}</label><input id="id" type="date" className="input" value={form.date} min={todayIso()} onChange={set('date')} required /></div>
        <div className="field"><label htmlFor="it">{t.invites.time}</label><input id="it" type="time" className="input" value={form.time} onChange={set('time')} required />{siteTz && <span className="hint">{t.invites.timeHint.replace('{tz}', siteTz)}</span>}</div>
      </div>
      <h3 style={{ margin: '8px 0 0', fontSize: 15 }}>{t.invites.guest}</h3>
      <div className="a-grid">
        <div className="field"><label htmlFor="ifn">{t.hosts.firstName}</label><input id="ifn" className="input" value={form.firstName} onChange={set('firstName')} maxLength={80} required /></div>
        <div className="field"><label htmlFor="iln">{t.hosts.lastName}</label><input id="iln" className="input" value={form.lastName} onChange={set('lastName')} maxLength={80} required /></div>
        <div className="field"><label htmlFor="ico">{t.invites.company}</label><input id="ico" className="input" value={form.company} onChange={set('company')} maxLength={120} /></div>
        <div className="field"><label htmlFor="iem">{t.hosts.email}</label><input id="iem" type="email" className="input" value={form.email} onChange={set('email')} maxLength={190} required /><span className="hint">{t.invites.emailHint}</span></div>
        <div className="field">
          <label htmlFor="ip">{t.invites.purpose}</label>
          <select id="ip" className="input" value={form.purpose} onChange={set('purpose')}>
            {PURPOSES.map((p) => <option key={p} value={p}>{t.purposes[p]}</option>)}
          </select>
        </div>
      </div>
      <div className="inline">
        <button className="btn btn-primary" disabled={busy || !form.siteId}>{busy ? '…' : t.invites.send}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t.hosts.cancel}</button>
      </div>
    </form>
  );
}
