import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtTime } from '../../lib/format';
import { MARK_OUT_REASONS, canConfirm, emptyState, filterPeople, isNotInside, type InsideList, type InsidePerson, type MarkOutReason } from '../../lib/inside';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { CloseButton, ErrorBox, PageHead, SiteSelect, useAsync, useDialog } from '../ui';

const SITE_KEY = 'rs_admin_site';

/**
 * Employees the readers still count as inside a site today, with "Mark as left" for whoever went out
 * without badging: otherwise anti-passback keeps them out until midnight. One site at a time.
 */
export function InsidePage() {
  const { t, intl } = useI18n();
  const I = t.access.inside;
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const active = (sites.data ?? []).filter((s) => s.active);
  const [siteId, setSiteId] = useState(() => { try { return localStorage.getItem(SITE_KEY) ?? ''; } catch { return ''; } });
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [target, setTarget] = useState<InsidePerson | null>(null);
  const msgRef = useRef<HTMLParagraphElement>(null);

  // The site remembered from another page, if this user can still see it; otherwise the first one.
  useEffect(() => {
    if (active.length && !active.some((s) => s.id === siteId)) setSiteId(active[0].id);
  }, [sites.data, siteId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { if (siteId) localStorage.setItem(SITE_KEY, siteId); } catch { /* ignore */ } }, [siteId]);
  const ready = !!siteId && active.some((s) => s.id === siteId);

  // Each answer keeps the site it is for: right after a change of site the old rows are not shown.
  const list = useAsync(() => (ready ? api.get<InsideList>(`/admin/access/inside${qs({ siteId })}`).then((r) => ({ ...r, siteId })) : Promise.resolve(null)), [siteId, ready]);
  const data = list.data?.siteId === siteId ? list.data : null;
  const people = data?.people ?? [];
  const shown = filterPeople(people, q);
  const empty = emptyState(data ? people.length : null, shown.length);

  // After the dialog closes the row is gone: focus goes to the message, which says what happened.
  const report = async (m: { ok: boolean; text: string }) => {
    setTarget(null);
    setMsg(m);
    await list.reload();
    msgRef.current?.focus();
  };

  return (
    <>
      <PageHead title={I.title} intro={I.intro}
        actions={ready && <button type="button" className="btn btn-ghost" onClick={() => { setMsg(null); list.reload(); }} disabled={list.loading} aria-busy={list.loading}>{I.refresh}</button>} />
      <ErrorBox error={sites.error ?? list.error} />
      <div role="status" aria-live="polite">{msg && <p ref={msgRef} tabIndex={-1} className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>
      {(active.length > 1 || people.length > 0) && (
        <div className="a-filters">
          {active.length > 1 && <SiteSelect sites={active} value={siteId} onChange={(v) => { setSiteId(v); setQ(''); setMsg(null); }} id="ins-site" />}
          {people.length > 0 && (
            <div className="field" style={{ flex: '1 1 240px' }}>
              <label htmlFor="ins-q">{I.search}</label>
              <input id="ins-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
          )}
        </div>
      )}
      <div className="table-wrap">
        {empty === 'none' ? <p className="empty">{I.none}</p>
          : empty === 'noMatch' ? <p className="empty" role="status">{I.noMatch}</p>
          : data && (
            <table>
              <thead><tr><th>{t.access.person}</th><th>{t.access.department}</th><th>{I.since}</th><th>{t.access.door}</th><th></th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.employeeId}>
                    <td className="wrap"><strong>{p.name}</strong></td>
                    <td className="wrap">{p.department ?? <span className="muted">—</span>}</td>
                    <td className="num">{fmtTime(p.since, intl, data.timezone)}</td>
                    <td className="wrap">{p.door}</td>
                    <td className="row-action">
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={`${I.markOut}: ${p.name}`} aria-haspopup="dialog"
                        onClick={() => { setMsg(null); setTarget(p); }}>{I.markOut}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      {target && (
        <MarkOutDialog person={target} siteId={siteId} onClose={() => setTarget(null)}
          onDone={() => report({ ok: true, text: I.done.replace('{name}', () => target.name) })}
          onGone={() => report({ ok: true, text: t.errors.NOT_INSIDE })} />
      )}
    </>
  );
}

/** Confirmation with the reason: a closed list, no free text, and the button stays off until one is chosen. */
function MarkOutDialog({ person, siteId, onClose, onDone, onGone }: {
  person: InsidePerson; siteId: string; onClose: () => void; onDone: () => void; onGone: () => void;
}) {
  const { t } = useI18n();
  const I = t.access.inside;
  const [reason, setReason] = useState<MarkOutReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dlg = useRef<HTMLElement>(null);
  // Escape and the backdrop do nothing while the request runs: the answer decides what happens next.
  const close = () => { if (!busy) onClose(); };
  useDialog(dlg, close);
  const ok = canConfirm(reason, busy);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || !reason) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/access/employees/${encodeURIComponent(person.employeeId)}/mark-out`, { siteId, reason });
      onDone();
    } catch (err) {
      if (isNotInside(err)) { onGone(); return; }
      setError(errorText(t, err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-back" onClick={close} />
      <aside ref={dlg} className="drawer" role="dialog" aria-modal="true" aria-labelledby="mo-title" aria-describedby="mo-text">
        <div className="drawer-head">
          <h2 id="mo-title">{I.dialogTitle.replace('{name}', () => person.name)}</h2>
          <CloseButton label={t.detail.close} onClick={close} />
        </div>
        <p id="mo-text" className="muted" style={{ margin: '8px 0 0' }}>{I.dialogText}</p>
        <form className="stack" style={{ marginTop: 24 }} onSubmit={submit}>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-describedby={reason ? undefined : 'mo-hint'}>
            <legend className="label" style={{ fontWeight: 700, padding: 0, marginBottom: 8 }}>{I.reason}</legend>
            <div className="choice-list">
              {MARK_OUT_REASONS.map((r, i) => (
                <label key={r} className="choice">
                  <input type="radio" name="mark-out-reason" value={r} checked={reason === r} onChange={() => setReason(r)} required disabled={busy} {...(i === 0 ? { 'data-autofocus': true } : {})} />
                  <span><strong>{I.reasons[r]}</strong></span>
                </label>
              ))}
            </div>
            {!reason && <span id="mo-hint" className="hint">{I.reasonHint}</span>}
          </fieldset>
          {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div className="inline">
            <button className="btn btn-primary" disabled={!ok} aria-busy={busy}>{I.markOut}</button>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>{t.hosts.cancel}</button>
          </div>
        </form>
      </aside>
    </>
  );
}
