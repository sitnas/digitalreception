import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, applyBrand, brandVars, contrast, isHex } from '../../lib/theme';
import { errorText, useI18n } from '../i18n';
import { ErrorBox, PageHead, useAsync } from '../ui';

interface Org {
  name: string; slug: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null;
  email: { enabled: boolean; from: string | null };
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
          <aside className="a-card">
            <h2>{t.org.usage2}</h2>
            <table><tbody>
              {row(t.org.sites, org.data.usage.sites, org.data.limits.sites)}
              {row(t.org.devices, org.data.usage.devices, org.data.limits.devices)}
              {row(t.org.users, org.data.usage.users, org.data.limits.users)}
            </tbody></table>
            <p className="muted" style={{ marginBottom: 0 }}>{t.org.planHint}</p>
            <p className="muted" style={{ marginBottom: 0 }}>{t.org.address}: <code>{window.location.host}</code></p>
          </aside>
          </div>
        </div>
      )}
    </>
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
        ? <p className="muted" style={{ margin: 0 }}>{t.org.emailFrom}: <code>{email.from}</code></p>
        : <p className="muted" style={{ margin: 0 }}>{t.org.emailOffHint}</p>}
      {email.enabled && <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={test} disabled={busy}>{busy ? t.org.emailSending : t.org.emailTest}</button>}
      {res && <p className={res.ok ? 'alert alert-info' : 'alert'} role="status" style={{ margin: 0, overflowWrap: 'anywhere' }}>{res.text}</p>}
    </section>
  );
}

function ColorField({ id, label, hint, presets, value, onChange, customLabel }: {
  id: string; label: string; hint: string; presets: string[]; value: string; onChange: (v: string) => void; customLabel: string;
}) {
  const names: Record<string, string> = useI18n().t.org.colorNames;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
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
            onChange={(e) => { const v = e.target.value.trim(); setText(v); if (isHex(v)) onChange(v.toUpperCase()); }} />
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
