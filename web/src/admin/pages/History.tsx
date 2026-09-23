import { useState } from 'react';
import { api, qs } from '../../lib/api';
import { dayEnd, dayStart, fmtDateTime, todayIso } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Paged, Site, VisitRow } from '../types';
import { ErrorBox, PageHead, SiteSelect, StatusPill, useAsync } from '../ui';
import { VisitDrawer } from './VisitDrawer';

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

export function HistoryPage() {
  const { t, intl } = useI18n();
  const me = useMe();
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [draft, setDraft] = useState({ siteId: '', from: daysAgo(me.role === 'RECEPTIONIST' ? 7 : 30), to: todayIso(), status: '', q: '' });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const params = () => ({ siteId: filters.siteId, from: filters.from && dayStart(filters.from), to: filters.to && dayEnd(filters.to), status: filters.status, q: filters.q.trim() || undefined });
  const list = useAsync(() => api.get<Paged<VisitRow>>(`/admin/visits${qs({ ...params(), page })}`), [filters, page]);
  const canExport = me.role === 'SUPER_ADMIN' || me.role === 'SITE_MANAGER';

  const doExport = async () => {
    setExportError(null);
    try {
      const blob = await api.blob(`/admin/visits/export.csv${qs(params())}`);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `visite-${todayIso()}.csv` });
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setExportError(errorText(t, e)); }
  };

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <>
      <PageHead title={t.history.title} intro={me.role === 'RECEPTIONIST' ? `${t.history.intro} ${t.history.receptionistNote}` : t.history.intro}
        actions={canExport && <button type="button" className="btn btn-ghost" onClick={doExport}>{t.history.export}</button>} />
      <form className="a-filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setFilters({ ...draft }); }}>
        {sites.data && <SiteSelect sites={sites.data} value={draft.siteId} onChange={(siteId) => setDraft({ ...draft, siteId })} allowAll />}
        <div className="field"><label htmlFor="f">{t.from}</label><input id="f" type="date" className="input" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
        <div className="field"><label htmlFor="to">{t.to}</label><input id="to" type="date" className="input" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></div>
        <div className="field"><label htmlFor="st">{t.statusLabel}</label>
          <select id="st" className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">{t.any}</option>{Object.entries(t.status).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="q">{t.search}</label><input id="q" className="input" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} maxLength={190} /></div>
        <button className="btn btn-primary btn-sm" style={{ minHeight: 40 }}>{t.history.apply}</button>
      </form>
      {exportError && <p className="alert" role="alert">{exportError}</p>}
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        {list.data && list.data.items.length === 0 ? <p className="empty">{t.history.empty}</p> : (
          <table>
            <thead><tr><th>{t.checkIn}</th><th>{t.site}</th><th>{t.visitor}</th><th>{t.company}</th><th>{t.host}</th><th>{t.purpose}</th><th>{t.checkOut}</th><th>{t.statusLabel}</th></tr></thead>
            <tbody>
              {list.data?.items.map((v) => (
                <tr key={v.id} className="clickable" onClick={() => setOpen(v.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(v.id)}>
                  <td className="num">{fmtDateTime(v.checkInAt, intl, v.siteTimezone ?? undefined)}</td><td>{v.siteName}</td>
                  <td>{v.anonymized ? <span className="muted">—</span> : `${v.firstName} ${v.lastName}`}</td>
                  <td>{v.company ?? '—'}</td><td>{v.host ?? '—'}</td><td>{t.purposes[v.purpose as keyof typeof t.purposes]}</td>
                  <td className="num">{fmtDateTime(v.checkOutAt, intl, v.siteTimezone ?? undefined)}</td><td><StatusPill status={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data && list.data.total > 0 && (
        <div className="pager">
          <span className="num">{list.data.total} {t.history.results}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.history.prev}</button>
          <span className="num">{page} / {pages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.history.next}</button>
        </div>
      )}
      {open && <VisitDrawer id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}
