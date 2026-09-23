import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { VisitDetail } from '../types';
import { ErrorBox, StatusPill, useAsync } from '../ui';

/** Visit detail. Images are fetched only on explicit request, each fetch is audited server-side. */
export function VisitDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, intl } = useI18n();
  const me = useMe();
  const { data: v, error, reload } = useAsync(() => api.get<VisitDetail>(`/admin/visits/${id}`), [id]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [erasing, setErasing] = useState(false);
  const [reason, setReason] = useState<keyof typeof t.detail.reasons>('DATA_SUBJECT_REQUEST');
  const [ticket, setTicket] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const tz = v?.siteTimezone ?? undefined;
  const canErase = me.role === 'SUPER_ADMIN' || me.role === 'SITE_MANAGER';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); Object.values(images).forEach(URL.revokeObjectURL); };
  }, [onClose, images]);

  const show = async (fileId: string) => {
    const blob = await api.blob(`/admin/visits/${id}/files/${fileId}`);
    setImages((m) => ({ ...m, [fileId]: URL.createObjectURL(blob) }));
  };
  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try { await fn(); await reload(); onChanged(); } catch (e) { setActionError(errorText(t, e)); }
  };

  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <h2 id="drawer-title">{t.detail.title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.detail.close}</button>
        </div>
        <ErrorBox error={error} />
        {v && (
          <>
            <p className="muted" style={{ margin: '4px 0 0' }}>{t.detail.audited}</p>
            <dl className="kv">
              <dt>{t.visitor}</dt><dd><strong>{v.anonymized ? '—' : `${v.firstName} ${v.lastName}`}</strong></dd>
              <dt>{t.statusLabel}</dt><dd><StatusPill status={v.status} /></dd>
              <dt>{t.code}</dt><dd className="num">{v.code}</dd>
              <dt>{t.site}</dt><dd>{v.siteName} <span className="muted">({v.siteTimezone})</span></dd>
              <dt>{t.checkIn}</dt><dd>{fmtDateTime(v.checkInAt, intl, tz)}</dd>
              <dt>{t.checkOut}</dt><dd>{fmtDateTime(v.checkOutAt, intl, tz)}</dd>
              {v.checkOutBy && <><dt>{t.detail.checkOutBy}</dt><dd>{v.checkOutBy.replace(/^(device|user|system):/, '')}</dd></>}
              <dt>{t.company}</dt><dd>{v.company ?? '—'}</dd>
              <dt>{t.host}</dt><dd>{v.host ?? '—'}</dd>
              <dt>{t.purpose}</dt><dd>{t.purposes[v.purpose as keyof typeof t.purposes] ?? v.purpose}</dd>
              <dt>{t.distance}</dt><dd>{v.travelDistance ? t.distances[v.travelDistance as keyof typeof t.distances] : '—'}</dd>
              <dt>{t.detail.email}</dt><dd>{v.email ?? '—'}</dd>
              {v.documentType && <><dt>{t.detail.document}</dt><dd>{t.docTypes[v.documentType as keyof typeof t.docTypes]} {v.documentNumber}</dd></>}
              <dt>{t.detail.notice}</dt><dd>v{v.privacyNoticeVersion}, {fmtDateTime(v.privacyAcceptedAt, intl, tz)} ({v.locale.toUpperCase()})</dd>
              <dt>{t.detail.noticeEmail}</dt><dd>{t.emailStatus[v.noticeEmailStatus as keyof typeof t.emailStatus]}</dd>
              <dt>{t.detail.badgeEmail}</dt><dd>{t.emailStatus[v.badgeEmailStatus as keyof typeof t.emailStatus]}</dd>
              {v.anonymizedAt && <><dt>{t.detail.anonymized}</dt><dd>{fmtDateTime(v.anonymizedAt, intl, tz)}</dd></>}
            </dl>

            {v.files.length > 0 && (
              <>
                <h3>{t.detail.files}</h3>
                <div className="photos">
                  {v.files.map((f) => (
                    <figure key={f.id}>
                      {images[f.id] ? <img src={images[f.id]} alt={t.fileKinds[f.kind as keyof typeof t.fileKinds]} /> :
                        <div className="empty" style={{ padding: '44px 8px' }}>
                          {f.viewable ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => show(f.id)}>{t.detail.show}</button> : !f.available ? t.detail.purged : '—'}
                        </div>}
                      <figcaption>{t.fileKinds[f.kind as keyof typeof t.fileKinds]}</figcaption>
                    </figure>
                  ))}
                </div>
              </>
            )}

            {actionError && <p className="alert" role="alert" style={{ marginTop: 16 }}>{actionError}</p>}
            <div className="inline" style={{ marginTop: 24 }}>
              {v.status === 'OPEN' && me.role !== 'AUDITOR' && <button type="button" className="btn btn-primary" onClick={() => act(() => api.post(`/admin/visits/${id}/checkout`))}>{t.today.checkoutNow}</button>}
              {canErase && v.status !== 'ERASED' && !erasing && <button type="button" className="btn btn-ghost" onClick={() => setErasing(true)}>{t.detail.erase}</button>}
            </div>

            {erasing && (
              <div className="a-card" style={{ marginTop: 16, borderColor: 'var(--danger)' }}>
                <h2>{t.detail.eraseTitle}</h2>
                <p>{t.detail.eraseText}</p>
                <div className="stack">
                  <div className="field"><label htmlFor="rs">{t.detail.reason}</label>
                    <select id="rs" className="input" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                      {Object.entries(t.detail.reasons).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></div>
                  <div className="field"><label htmlFor="tk">{t.detail.ticket}</label><input id="tk" className="input" value={ticket} onChange={(e) => setTicket(e.target.value)} maxLength={60} pattern="[A-Za-z0-9_\-#/.]*" /></div>
                  <div className="inline">
                    <button type="button" className="btn btn-danger" onClick={() => act(async () => { await api.del(`/admin/visits/${id}`, { reason, ticket: ticket || undefined }); setErasing(false); })}>{t.detail.confirmErase}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setErasing(false)}>{t.users.cancel}</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
