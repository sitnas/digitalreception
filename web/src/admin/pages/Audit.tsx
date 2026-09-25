import { useState } from 'react';
import { api, qs } from '../../lib/api';
import { dayEnd, dayStart, fmtDateTime, todayIso } from '../../lib/format';
import { errorText, useI18n } from '../i18n';
import type { AuditRow, Paged } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

const ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'VISIT_CHECK_IN', 'VISIT_CHECK_OUT', 'VISIT_LIST', 'VISIT_VIEW', 'FILE_VIEW', 'VISIT_EXPORT', 'VISIT_ERASED', 'PRESENT_LIST',
  'DEVICE_PAIRED', 'DEVICE_REVOKED', 'USER_CREATED', 'USER_UPDATED', 'USER_PASSWORD_RESET', 'POLICY_UPDATED', 'NOTICE_PUBLISHED', 'HOST_CREATED', 'HOST_UPDATED', 'STATS_VIEW', 'EMAIL_TEST', 'INVITATION_CREATED', 'INVITATION_CANCELLED', 'INVITATION_RESENT', 'API_KEY_CREATED', 'API_KEY_REVOKED', 'API_EMPLOYEE_UPSERT', 'API_EMPLOYEE_DELETE', 'API_DOOR_UPSERT', 'DOOR_CREATED', 'DOOR_UPDATED', 'READER_PAIRED', 'READER_REVOKED', 'PHONE_BADGE_ACTIVATED', 'PHONE_BADGE_REVOKED', 'EMPLOYEES_VIEW', 'ACCESS_LOG_VIEW', 'RETENTION_RUN', 'AUDIT_VIEW', 'AUDIT_EXPORT'];

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

export function AuditPage() {
  const { t, intl } = useI18n();
  const [draft, setDraft] = useState({ from: daysAgo(7), to: todayIso(), action: '', actor: '' });
  const [f, setF] = useState(draft);
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get<Paged<AuditRow>>(`/admin/audit${qs({ from: dayStart(f.from), to: dayEnd(f.to), action: f.action, actor: f.actor, page })}`), [f, page]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const [exportError, setExportError] = useState<string | null>(null);
  const doExport = async () => {
    setExportError(null);
    try {
      const blob = await api.blob(`/admin/audit/export.csv${qs({ from: dayStart(f.from), to: dayEnd(f.to), action: f.action, actor: f.actor })}`);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `registro-accessi-${todayIso()}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch (e) { setExportError(errorText(t, e)); }
  };
  return (
    <>
      <PageHead title={t.audit.title} intro={t.audit.intro} actions={<button type="button" className="btn btn-ghost" onClick={doExport}>{t.audit.export}</button>} />
      {exportError && <p className="alert" role="alert">{exportError}</p>}
      <form className="a-filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setF({ ...draft }); }}>
        <div className="field"><label htmlFor="af">{t.from}</label><input id="af" type="date" className="input" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
        <div className="field"><label htmlFor="at">{t.to}</label><input id="at" type="date" className="input" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></div>
        <div className="field"><label htmlFor="aa">{t.audit.filterAction}</label>
          <select id="aa" className="input" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}><option value="">{t.any}</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="au">{t.audit.filterActor}</label><input id="au" className="input" value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} maxLength={190} /></div>
        <button className="btn btn-primary btn-sm" style={{ minHeight: 40 }}>{t.history.apply}</button>
      </form>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t.audit.when}</th><th>{t.audit.actor}</th><th>{t.audit.action}</th><th>{t.audit.target}</th><th>{t.audit.ip}</th><th>{t.audit.details}</th></tr></thead>
          <tbody>
            {list.data?.items.map((r) => (
              <tr key={r.id}>
                <td className="num">{fmtDateTime(r.at, intl)}</td>
                <td>{r.actorLabel ?? <span className="muted">{r.actorType.toLowerCase()}</span>}</td>
                <td><code>{r.action}</code></td>
                <td className="muted">{r.entityType ? `${r.entityType} ${r.entityId?.slice(0, 8) ?? ''}` : '—'}</td>
                <td className="num muted">{r.ip ?? '—'}</td>
                <td className="wrap muted" style={{ fontSize: 13, maxWidth: 420 }}>{r.details ? JSON.stringify(r.details) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && list.data.total > list.data.pageSize && (
        <div className="pager">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.history.prev}</button>
          <span className="num">{page} / {pages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.history.next}</button>
        </div>
      )}
    </>
  );
}
