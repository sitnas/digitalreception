import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import type { Notice, Policy } from '../types';
import { ErrorBox, PageHead, useAsync } from '../ui';

const LOCALES = ['it', 'es', 'en'] as const;

export function PrivacyPage() {
  const { t } = useI18n();
  const me = useMe();
  const editable = me.role === 'SUPER_ADMIN';
  const policies = useAsync(() => api.get<Policy[]>('/admin/policies'), []);
  const [cc, setCc] = useState('');
  const current = policies.data?.find((p) => p.countryCode === cc) ?? policies.data?.[0];
  useEffect(() => { if (!cc && policies.data?.[0]) setCc(policies.data[0].countryCode); }, [policies.data, cc]);

  return (
    <>
      <PageHead title={t.privacy.title} intro={editable ? t.privacy.intro : `${t.privacy.intro} ${t.privacy.readOnly}`} />
      <ErrorBox error={policies.error} />
      {policies.data && (
        <div className="inline" role="tablist" style={{ marginBottom: 16 }}>
          {policies.data.map((p) => (
            <button key={p.countryCode} type="button" role="tab" aria-selected={p.countryCode === current?.countryCode}
              className={p.countryCode === current?.countryCode ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setCc(p.countryCode)}>{p.name}</button>
          ))}
        </div>
      )}
      {current && <PolicyEditor key={current.countryCode} policy={current} editable={editable} onSaved={policies.reload} />}
      {current && <Notices key={`n-${current.countryCode}`} policy={current} editable={editable} />}
      {editable && <AddCountry onAdded={(code) => { setCc(code); policies.reload(); }} />}
    </>
  );
}

function PolicyEditor({ policy, editable, onSaved }: { policy: Policy; editable: boolean; onSaved: () => void }) {
  const { t } = useI18n();
  const [p, setP] = useState(policy);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const num = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });
  const bool = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.checked });
  // Asking for the document always includes its photo.
  const docPhotoOn = p.documentDataEnabled || p.documentPhotoEnabled;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try {
      // Send only the editable rules: the API rejects unknown fields (id, tenantId, updatedAt...).
      const body = {
        visitRetentionDays: p.visitRetentionDays, locales: p.locales, defaultLocale: p.defaultLocale,
        documentDataEnabled: p.documentDataEnabled, documentPhotoEnabled: docPhotoOn, documentPhotoRetentionDays: p.documentPhotoRetentionDays,
        assetPhotosRequired: p.assetPhotosRequired, assetPhotoRetentionDays: p.assetPhotoRetentionDays,
      };
      await api.patch(`/admin/policies/${policy.countryCode}`, body); setMsg({ ok: true, text: t.privacy.saved }); onSaved();
    } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };
  return (
    <form className="a-card" onSubmit={save}>
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="a-grid">
          <div className="field"><label htmlFor="vr">{t.privacy.retention}</label><input id="vr" type="number" min={1} max={3650} step={1} required className="input" value={p.visitRetentionDays} onChange={num('visitRetentionDays')} /></div>
          <div className="field"><span className="label">{t.privacy.locales}</span>
            <div className="inline">{LOCALES.map((l) => (
              <label key={l} className="toggle"><input type="checkbox" checked={p.locales.includes(l)} onChange={(e) => setP({ ...p, locales: e.target.checked ? [...p.locales, l] : p.locales.filter((x) => x !== l) })} />{l.toUpperCase()}</label>
            ))}</div></div>
          <div className="field"><label htmlFor="dl">{t.privacy.defaultLocale}</label>
            <select id="dl" className="input" value={p.defaultLocale} onChange={(e) => setP({ ...p, defaultLocale: e.target.value })}>{p.locales.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></div>
        </div>
        <label className="toggle"><input type="checkbox" checked={p.documentDataEnabled} onChange={bool('documentDataEnabled')} />{t.privacy.docData}</label>
        <label className="toggle"><input type="checkbox" checked={docPhotoOn} disabled={p.documentDataEnabled} onChange={bool('documentPhotoEnabled')} />{t.privacy.docPhoto}</label>
        {p.documentDataEnabled && <span className="hint" style={{ marginTop: -8 }}>{t.privacy.docPhotoIncluded}</span>}
        {docPhotoOn && (
          <>
            <p className="alert" style={{ margin: 0 }}>{t.privacy.docPhotoWarn}</p>
            <div className="field" style={{ maxWidth: 320 }}><label htmlFor="dr">{t.privacy.docPhotoRet}</label><input id="dr" type="number" min={1} max={365} step={1} required className="input" value={p.documentPhotoRetentionDays} onChange={num('documentPhotoRetentionDays')} /></div>
          </>
        )}
        <label className="toggle"><input type="checkbox" checked={p.assetPhotosRequired} onChange={bool('assetPhotosRequired')} />{t.privacy.asset}</label>
        {p.assetPhotosRequired && <div className="field" style={{ maxWidth: 320 }}><label htmlFor="ar">{t.privacy.assetRet}</label><input id="ar" type="number" min={1} max={3650} step={1} required className="input" value={p.assetPhotoRetentionDays} onChange={num('assetPhotoRetentionDays')} /></div>}
        {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status">{msg.text}</p>}
        {editable && <div><button className="btn btn-primary">{t.privacy.save}</button></div>}
      </fieldset>
    </form>
  );
}

function Notices({ policy, editable }: { policy: Policy; editable: boolean }) {
  const { t, intl } = useI18n();
  const notices = useAsync(() => api.get<Notice[]>(`/admin/notices?countryCode=${policy.countryCode}`), [policy.countryCode]);
  const [locale, setLocale] = useState(policy.defaultLocale);
  const latest = notices.data?.find((n) => n.locale === locale);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setDraft(latest ? { title: latest.title, body: latest.body } : { title: '', body: '' }); }, [latest]);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault(); if (!draft) return; setMsg(null);
    try {
      const n = await api.post<Notice>('/admin/notices', { countryCode: policy.countryCode, locale, ...draft });
      setMsg({ ok: true, text: `${t.privacy.published} ${n.version}.` }); notices.reload();
    } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };
  const unchanged = !!latest && !!draft && draft.title === latest.title && draft.body === latest.body;

  return (
    <form className="a-card" onSubmit={publish}>
      <h2>{t.privacy.notices}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{t.privacy.noticeIntro}</p>
      <div className="inline" style={{ marginBottom: 12 }}>
        {policy.locales.map((l) => <button key={l} type="button" className={l === locale ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setLocale(l)}>{l.toUpperCase()}</button>)}
        {latest && <span className="muted">{t.privacy.version} {latest.version}, {fmtDateTime(latest.createdAt, intl)}</span>}
      </div>
      <ErrorBox error={notices.error} />
      {draft && (
        <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="field"><label htmlFor="nt">{t.privacy.noticeTitle}</label><input id="nt" className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} minLength={3} maxLength={200} required /></div>
          <div className="field"><label htmlFor="nb">{t.privacy.noticeBody}</label><textarea id="nb" className="input" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} minLength={50} maxLength={30000} required /><span className="hint">{t.privacy.placeholderHint}</span></div>
          {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status">{msg.text}</p>}
          {editable && <div><button className="btn btn-primary" disabled={unchanged}>{t.privacy.publish}</button></div>}
        </fieldset>
      )}
    </form>
  );
}

function AddCountry({ onAdded }: { onAdded: (code: string) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ countryCode: '', name: '', locale: 'en' as (typeof LOCALES)[number] });
  const [error, setError] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    const locales = Array.from(new Set([f.locale, 'en']));
    try {
      await api.post('/admin/policies', { countryCode: f.countryCode, name: f.name, locales, defaultLocale: f.locale, visitRetentionDays: 30 });
      onAdded(f.countryCode); setF({ countryCode: '', name: '', locale: 'en' });
    } catch (err) { setError(errorText(t, err)); }
  };
  return (
    <form className="a-card" onSubmit={add}>
      <h2>{t.addCountry.title}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{t.addCountry.hint}</p>
      <div className="inline" style={{ alignItems: 'end' }}>
        <div className="field"><label htmlFor="ac">{t.addCountry.code}</label><input id="ac" className="input" style={{ width: 90 }} value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value.toUpperCase() })} pattern="[A-Z]{2}" maxLength={2} required /></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="an">{t.addCountry.name}</label><input id="an" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={2} maxLength={80} required /></div>
        <div className="field"><label htmlFor="al">{t.privacy.defaultLocale}</label>
          <select id="al" className="input" value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as typeof f.locale })}>{LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></div>
        <button className="btn btn-primary">{t.addCountry.add}</button>
      </div>
      {error && <p className="alert" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    </form>
  );
}
