import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useMe } from '../AdminApp';
import { DOC_TEMPLATES, type TemplateKind } from '../docTemplates';
import { errorText, useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, onTabListKeyDown, useAsync } from '../ui';

const LOCALES = ['it', 'es', 'en'] as const;
type Locale = (typeof LOCALES)[number];
interface Text { id: string; locale: Locale; version: number; title: string; body: string; createdAt: string }
interface Doc { id: string; name: string; siteId: string | null; active: boolean; texts: Partial<Record<Locale, Text>>; acceptances: number }

export function DocumentsPage() {
  const { t, locale } = useI18n();
  const D = t.docs;
  const me = useMe();
  const editable = me.role === 'SUPER_ADMIN';
  const docs = useAsync(() => api.get<Doc[]>('/admin/documents'), []);
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState<{ name: string; siteId: string; template: TemplateKind | '' }>({ name: '', siteId: '', template: 'safety' });
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const tpl = f.template ? DOC_TEMPLATES[f.template] : null;
      const d = await api.post<Doc>('/admin/documents', { name: f.name.trim() || tpl?.name[locale as Locale] || '', siteId: f.siteId || null });
      // A template starts with its text in every language; the administrator then fills the brackets.
      if (tpl) for (const l of LOCALES) await api.post(`/admin/documents/${d.id}/versions`, { locale: l, ...tpl.texts[l] });
      setMsg({ ok: true, text: D.created }); setAdding(false); setF({ name: '', siteId: '', template: 'safety' });
      docs.reload();
    } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title={D.title} intro={editable ? D.intro : `${D.intro} ${t.privacy.readOnly}`}
        actions={editable && !adding && <button type="button" className="btn btn-primary" onClick={() => { setAdding(true); setMsg(null); }}>{D.add}</button>} />
      <ErrorBox error={docs.error ?? sites.error} />
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'alert alert-info' : 'alert'}>{msg.text}</p>}</div>

      {adding && (
        <form className="a-card stack" onSubmit={create}>
          <div className="field">
            <span className="label" id="tpl-l">{D.template}</span>
            <div className="segmented" role="group" aria-labelledby="tpl-l">
              {(['safety', 'nda', ''] as const).map((k) => (
                <button key={k || 'blank'} type="button" aria-pressed={f.template === k} onClick={() => setF({ ...f, template: k })}>{D.templates[k || 'blank']}</button>
              ))}
            </div>
            {f.template && <span className="hint">{D.templateHint}</span>}
          </div>
          <div className="a-grid">
            <div className="field"><label htmlFor="dn">{D.name}</label>
              <input id="dn" className="input" value={f.name} placeholder={f.template ? DOC_TEMPLATES[f.template].name[locale as Locale] : ''} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={2} maxLength={120} required={!f.template} />
              <span className="hint">{D.nameHint}</span></div>
            <ScopeSelect id="ds" sites={sites.data ?? []} value={f.siteId} onChange={(siteId) => setF({ ...f, siteId })} />
          </div>
          <div className="inline">
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>{t.mfa.cancel}</button>
            <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{D.create}</button>
          </div>
        </form>
      )}

      {docs.data && docs.data.length === 0 && !adding && <p className="empty">{D.none}</p>}
      {docs.data?.map((d) => <DocCard key={d.id} doc={d} sites={sites.data ?? []} editable={editable} onChanged={docs.reload} />)}
    </>
  );
}

function ScopeSelect({ id, sites, value, onChange, disabled }: { id: string; sites: Site[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="field"><label htmlFor={id}>{t.docs.scope}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{t.docs.allSites}</option>
        {sites.filter((s) => s.active || s.id === value).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

function DocCard({ doc, sites, editable, onChanged }: { doc: Doc; sites: Site[]; editable: boolean; onChanged: () => void }) {
  const { t, intl } = useI18n();
  const D = t.docs;
  const [locale, setLocale] = useState<Locale>(() => LOCALES.find((l) => doc.texts[l]) ?? 'it');
  const latest = doc.texts[locale];
  // Unsaved edits per language, so switching tab keeps what was typed.
  const [drafts, setDrafts] = useState<Partial<Record<Locale, { title: string; body: string }>>>({});
  const draft = drafts[locale] ?? (latest ? { title: latest.title, body: latest.body } : { title: '', body: '' });
  const setDraft = (v: { title: string; body: string }) => setDrafts((all) => ({ ...all, [locale]: v }));
  const [meta, setMeta] = useState({ name: doc.name, siteId: doc.siteId ?? '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const unchanged = !!latest && draft.title === latest.title && draft.body === latest.body;
  const metaChanged = meta.name !== doc.name || meta.siteId !== (doc.siteId ?? '');

  const act = async (fn: () => Promise<string>) => {
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); onChanged(); } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };
  const publish = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => {
      const v = await api.post<Text>(`/admin/documents/${doc.id}/versions`, { locale, ...draft });
      setDrafts(({ [locale]: _published, ...rest }) => rest);
      return D.published.replace('{v}', String(v.version));
    });
  };

  return (
    <form className={`a-card stack doc-card${doc.active ? '' : ' is-off'}`} onSubmit={publish} aria-label={doc.name}>
      <div className="doc-head">
        <div>
          <h2 style={{ margin: 0 }}>{doc.name}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            <span className={`tag${doc.active ? ' tag-on' : ''}`}>{doc.active ? D.active : D.inactive}</span>{' '}
            {doc.siteId ? sites.find((s) => s.id === doc.siteId)?.name : D.allSites} · {D.acceptances.replace('{n}', String(doc.acceptances))}
          </p>
        </div>
        {editable && (
          <button type="button" className="btn btn-ghost" onClick={() => act(async () => { await api.patch(`/admin/documents/${doc.id}`, { active: !doc.active }); return D.saved; })}>
            {doc.active ? D.deactivate : D.activate}
          </button>
        )}
      </div>

      {editable && (
        <div className="a-grid doc-meta">
          <div className="field"><label htmlFor={`n-${doc.id}`}>{D.name}</label><input id={`n-${doc.id}`} className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} minLength={2} maxLength={120} /></div>
          <ScopeSelect id={`s-${doc.id}`} sites={sites} value={meta.siteId} onChange={(siteId) => setMeta({ ...meta, siteId })} />
          <div><button type="button" className="btn btn-ghost" disabled={!metaChanged || meta.name.trim().length < 2}
            onClick={() => act(async () => { await api.patch(`/admin/documents/${doc.id}`, { name: meta.name.trim(), siteId: meta.siteId || null }); return D.saved; })}>{D.saveDetails}</button></div>
        </div>
      )}

      <div className="tabs" role="tablist" style={{ alignItems: 'center' }} onKeyDown={onTabListKeyDown}>
        {LOCALES.map((l) => <button key={l} type="button" role="tab" aria-selected={l === locale} tabIndex={l === locale ? 0 : -1} className="tab" onClick={() => setLocale(l)}>{l.toUpperCase()}{!doc.texts[l] && ' ·'}</button>)}
        {latest && <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{D.version.replace('{v}', String(latest.version))} · {fmtDateTime(latest.createdAt, intl)}</span>}
      </div>
      {!latest && <p className="hint" style={{ margin: 0 }}>{D.noText}</p>}
      <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="field"><label htmlFor={`t-${doc.id}`}>{D.docTitle}</label><input id={`t-${doc.id}`} className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} minLength={3} maxLength={200} required /></div>
        <div className="field"><label htmlFor={`b-${doc.id}`}>{D.body}</label><textarea id={`b-${doc.id}`} className="input" rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} minLength={20} maxLength={30000} required /></div>
        {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status">{msg.text}</p>}
        {editable && <div><button className="btn btn-primary" disabled={unchanged}>{D.publish}</button></div>}
      </fieldset>
    </form>
  );
}
