import { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { dayEnd, dayStart, fmtDateTime, fmtTime, todayIso } from '../../lib/format';
import { useI18n } from '../i18n';
import type { Paged, Site, VisitRow } from '../types';
import { ErrorBox, PageHead, SiteSelect, StatusPill, useAsync } from '../ui';
import { VisitDrawer } from './VisitDrawer';

const SITE_KEY = 'rs_admin_site';

export function TodayPage() {
  const { t, intl } = useI18n();
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [siteId, setSiteId] = useState(() => { try { return localStorage.getItem(SITE_KEY) ?? ''; } catch { return ''; } });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const list = sites.data?.filter((s) => s.active) ?? [];
    if (list.length && !list.some((s) => s.id === siteId)) setSiteId(list[0].id);
  }, [sites.data, siteId]);
  useEffect(() => { try { if (siteId) localStorage.setItem(SITE_KEY, siteId); } catch { /* ignore */ } }, [siteId]);

  const present = useAsync(() => (siteId ? api.get<VisitRow[]>(`/admin/visits/present${qs({ siteId })}`) : Promise.resolve([])), [siteId]);
  const today = todayIso();
  const arrivals = useAsync(() => (siteId ? api.get<Paged<VisitRow>>(`/admin/visits${qs({ siteId, from: dayStart(today), to: dayEnd(today) })}`) : Promise.resolve(null)), [siteId, today]);
  const site = sites.data?.find((s) => s.id === siteId);

  // Keep the emergency list fresh while the page is open.
  useEffect(() => {
    const h = setInterval(() => { present.reload(); arrivals.reload(); }, 60_000);
    return () => clearInterval(h);
  }, [present.reload, arrivals.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { present.reload(); arrivals.reload(); };

  return (
    <>
      <PageHead title={t.today.title} intro={t.today.intro} actions={<button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!present.data?.length}>{t.today.printList}</button>} />
      <ErrorBox error={sites.error ?? present.error ?? arrivals.error} />
      {sites.data && sites.data.length > 1 && (
        <div className="a-filters"><SiteSelect sites={sites.data.filter((s) => s.active)} value={siteId} onChange={setSiteId} /></div>
      )}
      {!siteId ? <p className="empty">{t.today.pickSite}</p> : (
        <>
          <section className="print-area">
            <h2 style={{ fontSize: 20, margin: '8px 0 10px' }}>{t.today.present} {site && <span className="muted">{site.name}</span>} <span className="num muted">({present.data?.length ?? 0})</span></h2>
            <p className="muted" style={{ display: 'none' }} data-print-only>{t.today.printedAt} {fmtDateTime(new Date().toISOString(), intl)}</p>
            <div className="table-wrap">
              {present.data && present.data.length === 0 ? <p className="empty">{t.today.noneInside}</p> : (
                <table>
                  <thead><tr><th>{t.visitor}</th><th>{t.company}</th><th>{t.host}</th><th>{t.checkIn}</th><th className="no-print"></th></tr></thead>
                  <tbody>
                    {present.data?.map((v) => (
                      <tr key={v.id}>
                        <td><strong>{v.firstName} {v.lastName}</strong></td><td>{v.company ?? '—'}</td><td>{v.host}</td>
                        <td className="num">{fmtTime(v.checkInAt, intl, site?.timezone)}</td>
                        <td className="no-print"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(v.id)}>{t.detail.show}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="no-print" style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 20, margin: '0 0 10px' }}>{t.today.arrivals} <span className="num muted">({arrivals.data?.total ?? 0})</span></h2>
            <div className="table-wrap">
              {arrivals.data && arrivals.data.items.length === 0 ? <p className="empty">{t.today.noArrivals}</p> : (
                <table>
                  <thead><tr><th>{t.checkIn}</th><th>{t.visitor}</th><th>{t.company}</th><th>{t.host}</th><th>{t.checkOut}</th><th>{t.statusLabel}</th></tr></thead>
                  <tbody>
                    {arrivals.data?.items.map((v) => (
                      <tr key={v.id} className="clickable" onClick={() => setOpen(v.id)}>
                        <td className="num">{fmtTime(v.checkInAt, intl, site?.timezone)}</td>
                        <td>{v.anonymized ? '—' : `${v.firstName} ${v.lastName}`}</td><td>{v.company ?? '—'}</td><td>{v.host ?? '—'}</td>
                        <td className="num">{fmtTime(v.checkOutAt, intl, site?.timezone)}</td><td><StatusPill status={v.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
      {open && <VisitDrawer id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  );
}
