import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

type Kind = 'teams' | 'slack' | 'generic';
type Event = 'visit.arrived' | 'access.denied' | 'evacuation.started';
const EVENTS: Event[] = ['visit.arrived', 'access.denied', 'evacuation.started'];
interface Hook { id: string; name: string; kind: Kind; urlHost: string; events: Event[]; siteId: string | null; includeNames: boolean; active: boolean; lastResult: string | null; lastAt: string | null }
const empty = { name: '', kind: 'teams' as Kind, url: '', events: ['visit.arrived'] as Event[], siteId: '', includeNames: false };

/** Teams / Slack / HTTPS notifications. The address is write-only: the list shows only its host. */
export function WebhooksPage() {
  const { t, intl } = useI18n();
  const W = t.webhooks;
  const hooks = useAsync(() => api.get<Hook[]>('/admin/webhooks'), []);
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const siteName = (id: string | null) => (id ? sites.data?.find((s) => s.id === id)?.name ?? '—' : W.allSites);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null); setNotice(null);
    try { await fn(); } catch (err) { setError(errorText(t, err)); } finally { setBusy(null); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    run('save', async () => {
      const r = await api.post<Hook & { secret: string | null }>('/admin/webhooks', { ...form, siteId: form.siteId || null });
      setForm(null); setSecret(r.secret); setNotice(W.saved); hooks.reload();
    });
  };
  const test = (h: Hook) => run(`test:${h.id}`, async () => {
    const { result } = await api.post<{ result: string }>(`/admin/webhooks/${h.id}/test`);
    if (result === 'OK') setNotice(W.testOk); else setError(W.testFailed.replace('{result}', result));
    hooks.reload();
  });
  const toggle = (h: Hook) => run(`toggle:${h.id}`, async () => { await api.patch(`/admin/webhooks/${h.id}`, { active: !h.active }); hooks.reload(); });
  const remove = (h: Hook) => {
    if (!window.confirm(W.removeConfirm.replace('{name}', h.name))) return;
    run(`remove:${h.id}`, async () => { await api.del(`/admin/webhooks/${h.id}`); hooks.reload(); });
  };

  return (
    <>
      <PageHead title={W.title} intro={W.intro}
        actions={!form && <button type="button" className="btn btn-primary" onClick={() => { setForm({ ...empty }); setSecret(null); setNotice(null); }}>{W.add}</button>} />
      <ErrorBox error={hooks.error ?? sites.error} />
      <div role="status" aria-live="polite">{notice && <p className="alert alert-info">{notice}</p>}</div>
      {error && <p className="alert" role="alert">{error}</p>}

      {secret && (
        <section className="a-card stack" aria-labelledby="secret-h">
          <h2 id="secret-h" style={{ margin: 0 }}>{W.secretTitle}</h2>
          <p className="muted" style={{ margin: 0 }}>{W.secretHint}</p>
          <div className="inline">
            <code translate="no" className="secret">{secret}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { /* select by hand */ } }}>{copied ? W.copied : W.copy}</button>
          </div>
        </section>
      )}

      {form && (
        <form className="a-card stack" onSubmit={save}>
          <h2 style={{ margin: 0 }}>{W.add}</h2>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ fontWeight: 700, marginBottom: 8 }}>{W.kind}</legend>
            <div className="segmented" role="group" aria-label={W.kind}>
              {(['teams', 'slack', 'generic'] as Kind[]).map((k) => (
                <button key={k} type="button" aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{W.kinds[k]}</button>
              ))}
            </div>
          </fieldset>
          <div className="a-grid">
            <div className="field"><label htmlFor="wn">{W.name}</label><input id="wn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={W.namePh} minLength={2} maxLength={80} required /></div>
            <div className="field"><label htmlFor="ws">{W.site}</label>
              <select id="ws" className="input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                <option value="">{W.allSites}</option>
                {(sites.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="wu">{W.url}</label>
            <input id="wu" className="input" type="url" inputMode="url" spellCheck={false} autoComplete="off" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" required aria-describedby="wu-help" />
            <span id="wu-help" className="hint">{W.urlHelp[form.kind]}</span>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ fontWeight: 700, marginBottom: 8 }}>{W.events}</legend>
            <div className="inline">
              {EVENTS.map((ev) => (
                <label key={ev} className="toggle"><input type="checkbox" checked={form.events.includes(ev)}
                  onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev) })} />{W.eventNames[ev]}</label>
              ))}
            </div>
          </fieldset>
          <label className="toggle"><input type="checkbox" checked={form.includeNames} aria-describedby="wi-help" onChange={(e) => setForm({ ...form, includeNames: e.target.checked })} />{W.includeNames}</label>
          <span id="wi-help" className="hint" style={{ marginTop: -8 }}>{W.includeNamesHelp}</span>
          <div className="inline">
            <button className="btn btn-primary" disabled={busy === 'save' || !form.events.length} aria-busy={busy === 'save'}>{W.save}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{W.cancel}</button>
          </div>
        </form>
      )}

      <div className="table-wrap" style={{ marginTop: 16 }}>
        {hooks.data && hooks.data.length === 0 ? <p className="empty">{W.none}</p> : (
          <table className="table-cards">
            <thead><tr><th>{W.name}</th><th>{W.destination}</th><th>{W.events}</th><th>{W.site}</th><th>{W.names}</th><th>{W.lastResult}</th><th><span className="sr-only">{W.test}</span></th></tr></thead>
            <tbody>
              {(hooks.data ?? []).map((h) => (
                <tr key={h.id} style={h.active ? undefined : { opacity: 0.55 }}>
                  <td data-label={W.name}><strong>{h.name}</strong>{!h.active && <> <span className="pill">{W.inactive}</span></>}<div className="host-tags"><span className="tag">{W.kinds[h.kind]}</span></div></td>
                  <td data-label={W.destination}><code translate="no">{h.urlHost}</code></td>
                  <td data-label={W.events} className="wrap">{h.events.map((ev) => W.eventNames[ev]).join(', ')}</td>
                  <td data-label={W.site}>{siteName(h.siteId)}</td>
                  <td data-label={W.names}>{h.includeNames ? W.yes : W.no}</td>
                  <td data-label={W.lastResult}>{h.lastAt
                    ? <><span className={h.lastResult === 'OK' ? 'pill OPEN' : 'pill AUTO_CLOSED'}>{h.lastResult === 'OK' ? W.ok : h.lastResult}</span> <small className="muted">{fmtDateTime(h.lastAt, intl)}</small></>
                    : <span className="muted">{W.never}</span>}</td>
                  <td className="row-action inline">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => test(h)} disabled={!!busy || !h.active} aria-busy={busy === `test:${h.id}`}>{W.test}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(h)} disabled={!!busy}>{h.active ? W.deactivate : W.activate}</button>
                    <button type="button" className="btn btn-ghost btn-sm is-danger" onClick={() => remove(h)} disabled={!!busy}>{W.remove}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PushSettings />
    </>
  );
}

/** "Your guest has arrived" on the employee's phone: whether the lock screen shows the guest's name. */
function PushSettings() {
  const { t } = useI18n();
  const W = t.webhooks;
  const settings = useAsync(() => api.get<{ includeNames: boolean; devices: number }>('/admin/push-settings'), []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const change = async (includeNames: boolean) => {
    setMsg(null);
    try { await api.patch('/admin/push-settings', { includeNames }); settings.reload(); setMsg({ ok: true, text: W.pushSaved }); }
    catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };
  if (!settings.data) return <ErrorBox error={settings.error} />;
  return (
    <section className="a-card stack" style={{ marginTop: 24 }} aria-labelledby="push-h">
      <h2 id="push-h" style={{ margin: 0 }}>{W.pushTitle}</h2>
      <p className="muted" style={{ margin: 0 }}>{W.pushIntro}</p>
      <label className="toggle"><input type="checkbox" checked={settings.data.includeNames} aria-describedby="pn-help" onChange={(e) => change(e.target.checked)} />{W.pushNames}</label>
      <span id="pn-help" className="hint" style={{ marginTop: -8 }}>{W.pushNamesHelp}</span>
      <p className="muted" style={{ margin: 0 }}>{W.pushDevices.replace('{n}', String(settings.data.devices))}</p>
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} style={{ margin: 0 }}>{msg.text}</p>}</div>
    </section>
  );
}
