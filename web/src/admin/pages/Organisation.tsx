import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, applyBrand, brandVars, contrast, isHex } from '../../lib/theme';
import { fmtDateTime } from '../../lib/format';
import { SsoLogo, useMe } from '../AdminApp';
import { errorText, useI18n } from '../i18n';
import { ErrorBox, PageHead, useAsync } from '../ui';

type SsoProvider = 'microsoft' | 'google';

interface Org {
  name: string; slug: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null;
  email: { enabled: boolean; from: string | null }; mfaRequired: boolean;
  sso: { available: SsoProvider[]; provider: SsoProvider | null; org: string | null; linkedAt: string | null; enforced: boolean; emergencyAdmin: boolean; signedInWithSso: boolean };
  usage: { sites: number; devices: number; users: number }; limits: { sites: number | null; devices: number | null; users: number | null };
}

const PRIMARY_PRESETS = ['#FFD100', '#F97316', '#DC2626', '#DB2777', '#7C3AED', '#2563EB', '#0E7490', '#16A34A'];
const SECONDARY_PRESETS = ['#111111', '#2B2B2B', '#1F2937', '#0F2A44', '#123524', '#3B1D2E'];

/** Resizes the logo in the browser (max 400 px, PNG) so the stored data URL stays small. */
async function toLogo(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export function OrganisationPage() {
  const { t } = useI18n();
  const org = useAsync(() => api.get<Org>('/admin/organisation'), []);
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
  const [secondary, setSecondary] = useState(DEFAULT_SECONDARY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!org.data) return;
    setName(org.data.name); setLogo(org.data.logo);
    setPrimary(org.data.primaryColor ?? DEFAULT_PRIMARY); setSecondary(org.data.secondaryColor ?? DEFAULT_SECONDARY);
  }, [org.data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    // Defaults are stored as "no choice", so a later change of the product defaults still applies.
    const colors = { primaryColor: primary === DEFAULT_PRIMARY ? '' : primary, secondaryColor: secondary === DEFAULT_SECONDARY ? '' : secondary };
    try {
      await api.patch('/admin/organisation', { name, logoDataUrl: logo ?? '', ...colors });
      applyBrand({ primaryColor: primary, secondaryColor: secondary });
      setMsg({ ok: true, text: t.org.saved }); org.reload();
    } catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };
  const row = (label: string, used: number, max: number | null) => (
    <tr><td>{label}</td><td className="num" style={{ textAlign: 'right' }}><strong>{used}</strong> <span className="muted">/ {max ?? t.org.unlimited}</span></td></tr>
  );
  const tooSimilar = isHex(primary) && isHex(secondary) && contrast(primary, secondary) < 1.8;

  return (
    <>
      <PageHead title={t.org.title} intro={t.org.intro} />
      <ErrorBox error={org.error} />
      {org.data && (
        <div className="a-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
          <form className="stack" onSubmit={save}>
            <section className="a-card stack">
              <h2 style={{ margin: 0 }}>{t.org.identity}</h2>
              <div className="field"><label htmlFor="on">{t.org.name}</label><input id="on" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required /></div>
              <div className="field">
                <span className="label">{t.org.logo}</span>
                {logo && <img src={logo} alt="" style={{ maxHeight: 56, maxWidth: 220, objectFit: 'contain', justifySelf: 'start' }} />}
                <div className="inline">
                  <label className="btn btn-ghost btn-sm file-pick">{logo ? t.org.changeLogo : t.org.uploadLogo}
                    <input type="file" accept="image/png,image/jpeg" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setLogo(await toLogo(f)); }} />
                  </label>
                  {logo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogo(null)}>{t.org.removeLogo}</button>}
                </div>
                <span className="hint">{t.org.logoHint}</span>
              </div>
            </section>

            <section className="a-card stack">
              <div>
                <h2 style={{ margin: 0 }}>{t.org.colors}</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>{t.org.colorsIntro}</p>
              </div>
              <ColorField id="cp" label={t.org.primary} hint={t.org.primaryHint} presets={PRIMARY_PRESETS} value={primary} onChange={setPrimary} customLabel={t.org.custom} />
              <ColorField id="cs" label={t.org.secondary} hint={t.org.secondaryHint} presets={SECONDARY_PRESETS} value={secondary} onChange={setSecondary} customLabel={t.org.custom} />
              {tooSimilar && <p className="alert" role="status" style={{ margin: 0 }}>{t.org.tooSimilar}</p>}
              <div className="field">
                <span className="label">{t.org.preview}</span>
                <BrandPreview primary={primary} secondary={secondary} name={name} t={t} />
              </div>
              <div><button type="button" className="btn-link" onClick={() => { setPrimary(DEFAULT_PRIMARY); setSecondary(DEFAULT_SECONDARY); }}>{t.org.reset}</button></div>
            </section>

            {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status" style={{ margin: 0 }}>{msg.text}</p>}
            <div><button className="btn btn-primary">{t.org.save}</button></div>
          </form>

          <div className="stack">
          <EmailCard email={org.data.email} t={t} />
          <MfaPolicyCard required={org.data.mfaRequired} onChanged={org.reload} t={t} />
          <SsoCard sso={org.data.sso} onChanged={org.reload} />
          <aside className="a-card">
            <h2>{t.org.usage2}</h2>
            <table><tbody>
              {row(t.org.sites, org.data.usage.sites, org.data.limits.sites)}
              {row(t.org.devices, org.data.usage.devices, org.data.limits.devices)}
              {row(t.org.users, org.data.usage.users, org.data.limits.users)}
            </tbody></table>
            <p className="muted" style={{ marginBottom: 0 }}>{t.org.planHint}</p>
            <p className="muted" style={{ marginBottom: 0 }}>{t.org.address}: <code translate="no">{window.location.host}</code></p>
          </aside>
          </div>
        </div>
      )}
    </>
  );
}

/** Organisation-wide requirement: applies from the next request of every user (checked on the server). */
function MfaPolicyCard({ required, onChanged, t }: { required: boolean; onChanged: () => void; t: ReturnType<typeof useI18n>['t'] }) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Optimistic: the box moves at once (the user's choice), falls back to the server value otherwise.
  const [choice, setChoice] = useState<boolean | undefined>(undefined);
  const value = choice ?? required;
  const toggle = async (on: boolean) => {
    setChoice(on); setBusy(true); setError(null); setSaved(false);
    try { await api.patch('/admin/organisation', { mfaRequired: on }); onChanged(); setSaved(true); }
    catch (err) { setChoice(undefined); setError(errorText(t, err)); }
    finally { setBusy(false); }
  };
  return (
    <section className="a-card stack" aria-labelledby="mfa-h" aria-busy={busy}>
      <h2 id="mfa-h" style={{ margin: 0 }}>{t.mfa.orgTitle}</h2>
      <label className="toggle"><input type="checkbox" name="mfa-required" aria-describedby="mfa-hint" checked={value} disabled={busy || (!value && !me.mfaEnabled)} onChange={(e) => toggle(e.target.checked)} />{t.mfa.orgRequire}</label>
      <p id="mfa-hint" className="muted" style={{ margin: 0, fontSize: 13 }}>{t.mfa.orgHint}</p>
      <p role="status" aria-live="polite" className="hint" style={{ margin: 0 }}>{saved && !busy ? t.org.saved : ''}</p>
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}

/**
 * Single sign-on: the SUPER_ADMIN links the company directory by signing in once with it, tries it,
 * then may require it. The server enforces every precondition; the card only explains them.
 */
function SsoCard({ sso, onChanged }: { sso: Org['sso']; onChanged: () => void }) {
  const { t, intl } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [choice, setChoice] = useState<boolean | undefined>(undefined);
  // Back from the provider: "?sso=linked" or "?sso_error=…", shown once.
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const code = p.get('sso_error');
    if (p.get('sso') === 'linked') setNotice(t.sso.linkedOk);
    else if (code) setError(t.sso.errors[code as keyof typeof t.sso.errors] ?? t.sso.errors.generic);
    if (p.has('sso') || code) history.replaceState(null, '', location.pathname);
  }, [t]);

  const name = (p: SsoProvider) => t.sso.providers[p];
  const enforced = choice ?? sso.enforced;
  const canEnforce = sso.signedInWithSso && sso.emergencyAdmin;
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); onChanged(); if (done) setNotice(done); return true; }
    catch (err) { setError(errorText(t, err)); return false; }
    finally { setBusy(false); }
  };
  const toggle = async (on: boolean) => {
    setChoice(on);
    if (!(await run(() => api.patch('/admin/organisation', { ssoEnforced: on }), t.org.saved))) setChoice(undefined);
  };
  const unlink = async () => { if (await run(() => api.post('/admin/organisation/sso/unlink'), t.sso.unlinked)) { setConfirmUnlink(false); setChoice(undefined); } };

  return (
    <section className="a-card stack" aria-labelledby="sso-h" aria-busy={busy}>
      <h2 id="sso-h" style={{ margin: 0 }}>{t.sso.section}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t.sso.intro}</p>
      {sso.provider && sso.linkedAt ? (
        <>
          <p style={{ margin: 0 }}><span className="sso-mark"><SsoLogo provider={sso.provider} /></span>
            {t.sso.linked.replace('{provider}', name(sso.provider)).replace('{org}', sso.org ?? '—').replace('{date}', fmtDateTime(sso.linkedAt, intl))}</p>
          <label className="toggle"><input type="checkbox" name="sso-enforced" aria-describedby="sso-enforce-help" checked={enforced}
            disabled={busy || (!enforced && !canEnforce)} onChange={(e) => toggle(e.target.checked)} />{t.sso.enforce}</label>
          <p id="sso-enforce-help" className="muted" style={{ margin: 0, fontSize: 13 }}>
            {!enforced && !sso.signedInWithSso ? t.sso.enforceNeedsSso.replace('{provider}', name(sso.provider))
              : !enforced && !sso.emergencyAdmin ? t.sso.enforceNeedsEmergency : t.sso.enforceHelp}
          </p>
          <div className="inline">
            {sso.available.includes(sso.provider) && <a className="btn btn-ghost btn-sm" href={`/api/auth/sso/link?provider=${sso.provider}`}>{t.sso.link.replace('{provider}', name(sso.provider))}</a>}
            {confirmUnlink
              ? <button type="button" className="btn btn-danger btn-sm" onClick={unlink} disabled={busy}>{t.sso.unlinkConfirm}</button>
              : <button type="button" className="btn btn-ghost btn-sm is-danger" onClick={() => setConfirmUnlink(true)} disabled={busy}>{t.sso.unlink}</button>}
          </div>
        </>
      ) : sso.available.length ? (
        <>
          <div className="inline">
            {sso.available.map((p) => (
              <a key={p} className={`btn btn-sso btn-sso-${p}`} href={`/api/auth/sso/link?provider=${p}`}><SsoLogo provider={p} />{t.sso.link.replace('{provider}', name(p))}</a>
            ))}
          </div>
          <p className="hint" style={{ margin: 0 }}>{t.sso.linkHelp}</p>
        </>
      ) : <p className="hint" style={{ margin: 0 }}>{t.sso.unavailable}</p>}
      <div role="status" aria-live="polite">{notice && <p className="alert alert-info" style={{ margin: 0 }}>{notice}</p>}</div>
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}

/** Whether the server can send email, with a test message: without SMTP no badge or notice ever leaves. */
function EmailCard({ email, t }: { email: Org['email']; t: ReturnType<typeof useI18n>['t'] }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const test = async () => {
    setBusy(true); setRes(null);
    try {
      const r = await api.post<{ ok: boolean; error?: string; to: string }>('/admin/organisation/test-email', {});
      setRes(r.ok ? { ok: true, text: t.org.emailSent.replace('{to}', r.to) } : { ok: false, text: `${t.org.emailFailed} ${r.error ?? ''}` });
    } catch (err) { setRes({ ok: false, text: errorText(t, err) }); }
    finally { setBusy(false); }
  };
  return (
    <section className="a-card stack" aria-labelledby="email-h">
      <h2 id="email-h" style={{ margin: 0 }}>{t.org.email}</h2>
      <span className={`pill ${email.enabled ? 'OPEN' : 'AUTO_CLOSED'}`}>{email.enabled ? t.org.emailOn : t.org.emailOff}</span>
      {email.enabled
        ? <p className="muted" style={{ margin: 0 }}>{t.org.emailFrom}: <code translate="no">{email.from}</code></p>
        : <p className="muted" style={{ margin: 0 }}>{t.org.emailOffHint}</p>}
      {email.enabled && <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={test} disabled={busy} aria-busy={busy}>{busy ? t.org.emailSending : t.org.emailTest}</button>}
      {res && <p className={res.ok ? 'alert alert-info' : 'alert'} role="status" style={{ margin: 0, overflowWrap: 'anywhere' }}>{res.text}</p>}
    </section>
  );
}

function ColorField({ id, label, hint, presets, value, onChange, customLabel }: {
  id: string; label: string; hint: string; presets: string[]; value: string; onChange: (v: string) => void; customLabel: string;
}) {
  const names: Record<string, string> = useI18n().t.org.colorNames;
  // What the user is typing, remembered only while the colour it was typed against is still current:
  // a swatch click or "reset colours" in the parent simply shows the new value.
  const [draft, setDraft] = useState<{ text: string; for: string } | undefined>(undefined);
  const text = draft && draft.for === value ? draft.text : value;
  return (
    <div className="field">
      <span className="label" id={`${id}-l`}>{label}</span>
      <div className="swatches" role="group" aria-labelledby={`${id}-l`}>
        {presets.map((c) => (
          <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={value.toUpperCase() === c} aria-label={names[c] ?? c} title={names[c] ?? c} onClick={() => onChange(c)} />
        ))}
        <span className="swatch-custom">
          <input type="color" aria-label={`${label} – ${customLabel}`} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
          <input id={id} className="input" value={text} maxLength={7} spellCheck={false} aria-label={`${label} (hex)`}
            onChange={(e) => { const v = e.target.value.trim(); const next = isHex(v) ? v.toUpperCase() : value; setDraft({ text: v, for: next }); if (next !== value) onChange(next); }} />
        </span>
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}

function BrandPreview({ primary, secondary, name, t }: { primary: string; secondary: string; name: string; t: ReturnType<typeof useI18n>['t'] }) {
  const vars = brandVars({ primaryColor: primary, secondaryColor: secondary }) as React.CSSProperties;
  return (
    <div className="brand-preview" style={vars} aria-hidden>
      <div className="bp-side">
        <b>{name || '—'}</b>
        <i className="on">{t.nav.today}</i><i>{t.nav.history}</i><i>{t.nav.sites}</i>
      </div>
      <div className="bp-main">
        <div className="bp-tiles"><div className="bp-tile bp-in">{t.org.previewIn}</div><div className="bp-tile bp-out">{t.org.previewOut}</div></div>
        <span className="bp-btn">{t.org.previewBtn}</span>
      </div>
    </div>
  );
}
