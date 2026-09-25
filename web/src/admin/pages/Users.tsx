import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Role, Site, UserRow } from '../types';
import { ErrorBox, PageHead, strongPassword, useAsync } from '../ui';

const ROLES: Role[] = ['RECEPTIONIST', 'SITE_MANAGER', 'AUDITOR', 'SUPER_ADMIN'];
const needsSites = (r: Role) => r === 'SITE_MANAGER' || r === 'RECEPTIONIST';
type Filter = 'all' | 'active' | 'inactive';
type Panel = { mode: 'new' } | { mode: 'edit'; user: UserRow };

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

export function UsersPage() {
  const { t, intl } = useI18n();
  const me = useMe();
  const users = useAsync(() => api.get<UserRow[]>('/admin/users'), []);
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');

  const all = users.data ?? [];
  const counts = { all: all.length, active: all.filter((u) => u.active).length, inactive: all.filter((u) => !u.active).length };
  const term = q.trim().toLowerCase();
  const rows = all
    .filter((u) => (filter === 'all' ? true : filter === 'active' ? u.active : !u.active))
    .filter((u) => !term || u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));

  const siteSummary = (u: UserRow) => {
    if (u.role === 'SUPER_ADMIN' || u.role === 'AUDITOR') return t.allSites;
    if (!u.sites.length) return '—';
    const names = u.sites.map((s) => s.name);
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  };

  return (
    <>
      <PageHead title={t.users.title} intro={t.users.intro}
        actions={<button type="button" className="btn btn-primary" onClick={() => setPanel({ mode: 'new' })}>{t.users.add}</button>} />
      <ErrorBox error={users.error ?? sites.error} />

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label={t.statusLabel}>
          {(['active', 'inactive', 'all'] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {t.users.filters[f]} <span className="count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input className="input toolbar-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.users.search} aria-label={t.users.search} />
      </div>

      <div className="table-wrap">
        {users.data && rows.length === 0 ? <p className="empty">{term ? t.users.noResults : t.users.none}</p> : (
          <table className="table-cards">
            <thead><tr><th>{t.users.person}</th><th>{t.users.role}</th><th>{t.users.sites}</th><th>{t.statusLabel}</th><th>{t.users.lastLogin}</th><th><span className="sr-only">{t.users.edit}</span></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="clickable" tabIndex={0} onClick={() => setPanel({ mode: 'edit', user: u })} onKeyDown={(e) => e.key === 'Enter' && setPanel({ mode: 'edit', user: u })}>
                  <td data-label={t.users.person}>
                    <span className="person">
                      <span className="avatar" aria-hidden>{initials(u.displayName)}</span>
                      <span><strong>{u.displayName}{u.id === me.id && <span className="muted"> · {t.users.you}</span>}</strong><small>{u.email}</small></span>
                    </span>
                  </td>
                  <td data-label={t.users.role}>{t.roles[u.role]}</td>
                  <td data-label={t.users.sites} title={u.sites.map((s) => s.name).join(', ')}>{siteSummary(u)}</td>
                  <td data-label={t.statusLabel}><span className={u.active ? 'pill OPEN' : 'pill'}>{u.active ? t.users.active : t.users.inactive}</span></td>
                  <td data-label={t.users.lastLogin} className="num">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt, intl) : <span className="muted">{t.users.never}</span>}</td>
                  <td className="row-action"><button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setPanel({ mode: 'edit', user: u }); }}>{t.users.edit}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {panel && (
        <UserPanel key={panel.mode === 'edit' ? panel.user.id : 'new'} panel={panel} sites={sites.data ?? []} meId={me.id}
          onClose={() => setPanel(null)} onChanged={users.reload} />
      )}
    </>
  );
}

function UserPanel({ panel, sites, meId, onClose, onChanged }: { panel: Panel; sites: Site[]; meId: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const editing = panel.mode === 'edit' ? panel.user : null;
  const self = editing?.id === meId;
  const [f, setF] = useState(() => ({
    displayName: editing?.displayName ?? '', email: editing?.email ?? '', role: (editing?.role ?? 'RECEPTIONIST') as Role,
    siteIds: editing?.sites.map((s) => s.id) ?? [], temporaryPassword: editing ? '' : strongPassword(),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeSites = useMemo(() => sites.filter((s) => s.active || f.siteIds.includes(s.id)), [sites, f.siteIds]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null); setSaved(false);
    try { await fn(); onChanged(); return true; } catch (err) { setError(errorText(t, err)); return false; } finally { setBusy(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const siteIds = needsSites(f.role) ? f.siteIds : [];
    if (needsSites(f.role) && siteIds.length === 0) { setError(t.users.pickSite); return; }
    const ok = await run(() => editing
      ? api.patch(`/admin/users/${editing.id}`, { displayName: f.displayName, role: f.role, siteIds })
      : api.post('/admin/users', { ...f, siteIds }));
    if (ok) { if (editing) setSaved(true); else onClose(); }
  };
  const resetPassword = async () => {
    if (!editing) return;
    const pwd = strongPassword();
    if (await run(() => api.post(`/admin/users/${editing.id}/reset-password`, { temporaryPassword: pwd }))) setNewPassword(pwd);
  };
  const toggleActive = async () => {
    if (!editing) return;
    if (await run(() => api.patch(`/admin/users/${editing.id}`, { active: !editing.active }))) onClose();
  };

  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="user-panel-title">
        <div className="drawer-head">
          <h2 id="user-panel-title">{editing ? editing.displayName : t.users.add}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.detail.close}</button>
        </div>
        {editing && <p className="muted" style={{ margin: '2px 0 0' }}>{editing.email}</p>}

        <form className="stack" style={{ marginTop: 24 }} onSubmit={save}>
          <section className="drawer-section">
            <h3>{t.users.details}</h3>
            <div className="field"><label htmlFor="un">{t.users.name}</label><input id="un" className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} minLength={2} maxLength={120} required autoFocus={!editing} /></div>
            {!editing && <div className="field"><label htmlFor="ue">{t.users.email}</label><input id="ue" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>}
          </section>

          <section className="drawer-section">
            <h3>{t.users.role}</h3>
            {self && <p className="hint" style={{ margin: 0 }}>{t.users.selfRole}</p>}
            <div className="choice-list" role="radiogroup" aria-label={t.users.role}>
              {ROLES.map((r) => (
                <label key={r} className="choice">
                  <input type="radio" name="role" checked={f.role === r} onChange={() => setF({ ...f, role: r })} disabled={self} />
                  <span><strong>{t.roles[r]}</strong><small>{t.users.roleHelp[r]}</small></span>
                </label>
              ))}
            </div>
          </section>

          {needsSites(f.role) && (
            <section className="drawer-section">
              <h3>{t.users.sites}</h3>
              <div className="check-list">
                {activeSites.map((s) => (
                  <label key={s.id} className="toggle"><input type="checkbox" checked={f.siteIds.includes(s.id)}
                    onChange={(e) => setF({ ...f, siteIds: e.target.checked ? [...f.siteIds, s.id] : f.siteIds.filter((x) => x !== s.id) })} />{s.name} <span className="muted">({s.countryCode})</span></label>
                ))}
              </div>
            </section>
          )}

          {!editing && (
            <section className="drawer-section">
              <h3>{t.users.tempPwd}</h3>
              <div className="inline"><input id="up" className="input num" style={{ flex: '1 1 200px' }} value={f.temporaryPassword} onChange={(e) => setF({ ...f, temporaryPassword: e.target.value })} minLength={12} required aria-label={t.users.tempPwd} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, temporaryPassword: strongPassword() })}>{t.users.generate}</button>
                <CopyButton text={f.temporaryPassword} /></div>
              <span className="hint">{t.users.tempPwdHint}</span>
            </section>
          )}

          {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
          {saved && <p className="alert alert-info" role="status" style={{ margin: 0 }}>{t.users.saved}</p>}
          <div className="inline"><button className="btn btn-primary" disabled={busy}>{editing ? t.users.save : t.users.create}</button><button type="button" className="btn btn-ghost" onClick={onClose}>{t.users.cancel}</button></div>
        </form>

        {editing && !self && (
          <section className="drawer-section drawer-danger">
            <h3>{t.users.access}</h3>
            <div className="access-row">
              <div><strong>{t.users.resetPwd}</strong><p className="muted">{t.users.resetHelp}</p></div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetPassword} disabled={busy}>{t.users.resetPwd}</button>
            </div>
            {newPassword && (
              <div className="stack" style={{ gap: 8 }} role="status">
                <div className="inline"><code className="secret">{newPassword}</code><CopyButton text={newPassword} /></div>
                <span className="hint">{t.users.tempPwdHint}</span>
              </div>
            )}
            <div className="access-row">
              <div><strong>{editing.active ? t.users.deactivate : t.users.activate}</strong><p className="muted">{editing.active ? t.users.deactivateHelp : t.users.activateHelp}</p></div>
              {confirmToggle || !editing.active
                ? <button type="button" className={editing.active ? 'btn btn-danger btn-sm' : 'btn btn-ghost btn-sm'} onClick={toggleActive} disabled={busy}>{editing.active ? t.users.confirmDeactivate : t.users.activate}</button>
                : <button type="button" className="btn btn-ghost btn-sm is-danger" onClick={() => setConfirmToggle(true)}>{t.users.deactivate}</button>}
            </div>
          </section>
        )}
      </aside>
    </>
  );
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable: the text stays selectable */ }
  };
  return <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{done ? t.users.copied : t.users.copy}</button>;
}
