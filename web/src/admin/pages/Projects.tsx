import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import { ErrorBox, PageHead, useAsync } from '../ui';

export interface ProjectRow { id: string; code: string; name: string; client: string | null; active: boolean; employees: number }

/** Jobs / contracts ("commesse") the employees work on: kept here or sent by the HR system. */
export function ProjectsPage() {
  const { t } = useI18n();
  const P = t.projects;
  const me = useMe();
  const canEdit = me.role === 'SUPER_ADMIN';
  const navigate = useNavigate();
  const list = useAsync(() => api.get<ProjectRow[]>('/admin/access/projects'), []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ code: '', name: '', client: '' });
  const [editing, setEditing] = useState<{ id: string; name: string; client: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); list.reload(); return true; } catch (e) { setMsg({ ok: false, text: errorText(t, e) }); return false; } finally { setBusy(false); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act(() => api.post('/admin/access/projects', { code: f.code.trim(), name: f.name.trim(), client: f.client.trim() || null }), P.saved)) { setAdding(false); setF({ code: '', name: '', client: '' }); }
  };

  return (
    <>
      <PageHead title={P.title} intro={P.intro}
        actions={canEdit && !adding && <button type="button" className="btn btn-primary" onClick={() => { setAdding(true); setMsg(null); }}>{P.add}</button>} />
      <ErrorBox error={list.error} />
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>
      {adding && (
        <form className="a-card stack" style={{ marginBottom: 16 }} onSubmit={create}>
          <div className="a-grid">
            <div className="field"><label htmlFor="pc">{P.code}</label>
              <input id="pc" className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/[^A-Za-z0-9._/-]/g, '') })} maxLength={40} required spellCheck={false} autoComplete="off" aria-describedby="pc-h" translate="no" />
              <span id="pc-h" className="hint">{P.codeHint}</span></div>
            <div className="field"><label htmlFor="pn">{P.name}</label><input id="pn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required /></div>
            <div className="field"><label htmlFor="pk">{P.client}</label><input id="pk" className="input" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} maxLength={120} /><span className="hint">{P.optional}</span></div>
          </div>
          <div className="inline">
            <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{P.create}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>{P.cancel}</button>
          </div>
        </form>
      )}
      <div className="table-wrap">
        {list.data && list.data.length === 0 ? <p className="empty">{P.none}</p> : (
          <table className="table-cards">
            <thead><tr><th>{P.code}</th><th>{P.name}</th><th>{P.client}</th><th className="num">{P.people}</th><th></th></tr></thead>
            <tbody>
              {(list.data ?? []).map((p) => editing?.id === p.id ? (
                <tr key={p.id}>
                  <td data-label={P.code}><code translate="no">{p.code}</code></td>
                  <td data-label={P.name}><input className="input" aria-label={P.name} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} /></td>
                  <td data-label={P.client}><input className="input" aria-label={P.client} value={editing.client} onChange={(e) => setEditing({ ...editing, client: e.target.value })} maxLength={120} /></td>
                  <td data-label={P.people} className="num">{p.employees}</td>
                  <td className="inline" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy || !editing.name.trim()}
                      onClick={async () => { if (await act(() => api.patch(`/admin/access/projects/${p.id}`, { name: editing.name.trim(), client: editing.client.trim() || null }), P.saved)) setEditing(null); }}>{P.save}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>{P.cancel}</button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.6 }}>
                  <td data-label={P.code}><code translate="no">{p.code}</code>{!p.active && <> <span className="pill">{P.closed}</span></>}</td>
                  <td data-label={P.name}><strong>{p.name}</strong></td>
                  <td data-label={P.client}>{p.client ?? <span className="muted">—</span>}</td>
                  <td data-label={P.people} className="num">
                    {p.employees > 0 ? <button type="button" className="btn-link" onClick={() => navigate(`../employees?project=${p.id}`)}>{p.employees}</button> : 0}
                  </td>
                  <td className="inline" style={{ justifyContent: 'flex-end' }}>
                    {canEdit && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: p.id, name: p.name, client: p.client ?? '' })}>{P.edit}</button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.patch(`/admin/access/projects/${p.id}`, { active: !p.active }), P.saved)}>{p.active ? P.close : P.reopen}</button>
                        <button type="button" className="btn btn-ghost btn-sm is-danger" disabled={busy || p.employees > 0} title={p.employees > 0 ? P.inUseHint : undefined}
                          onClick={() => window.confirm(P.removeConfirm.replace('{code}', p.code)) && act(() => api.del(`/admin/access/projects/${p.id}`), P.deleted)}>{P.remove}</button>
                      </>
                    )}
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
