import { useState } from 'react';
import { api } from '../../lib/api';
import { useMe, useReloadMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import { APP_KEYS, type AppKey } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

/** The portal's apps: each one on or off for the whole organisation. The shared data stays either way. */
export function AppsPage() {
  const { t } = useI18n();
  const P = t.apps;
  const me = useMe();
  const reloadMe = useReloadMe();
  const canEdit = me.role === 'SUPER_ADMIN';
  const state = useAsync(() => api.get<{ apps: AppKey[] }>('/admin/apps'), []);
  const [busy, setBusy] = useState<AppKey | null>(null);
  // The switches follow the click at once; they go back if the server refuses.
  const [local, setLocal] = useState<AppKey[] | null>(null);
  const current = local ?? state.data?.apps ?? [];
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = async (app: AppKey, on: boolean) => {
    const before = current;
    const next = on ? [...before, app] : before.filter((a) => a !== app);
    setLocal(next); setBusy(app); setMsg(null);
    try {
      await api.put('/admin/apps', { apps: next });
      setMsg({ ok: true, text: P.saved }); await reloadMe(); // the menu follows
    } catch (e) { setLocal(before); setMsg({ ok: false, text: errorText(t, e) }); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHead title={P.title} intro={P.intro} />
      <ErrorBox error={state.error} />
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>
      {!canEdit && <p className="muted">{P.readOnly}</p>}
      {state.data && (
        <ul className="app-tiles" role="list">
          {APP_KEYS.map((app) => {
            const on = current.includes(app);
            return (
              <li key={app} className={`a-card app-tile${on ? ' is-on' : ''}`}>
                <div className="app-tile-head">
                  <h2>{P.items[app].name}</h2>
                  <span className={`pill${on ? ' pill-on' : ''}`}>{on ? P.on : P.off}</span>
                </div>
                <p>{P.items[app].text}</p>
                <label className="toggle"><input type="checkbox" name={`app-${app}`} checked={on} disabled={!canEdit || busy !== null}
                  onChange={(e) => toggle(app, e.target.checked)} />{P.items[app].name}</label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="hint">{P.perPerson}</p>
    </>
  );
}
