import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { errorText, useI18n } from '../i18n';
import { ErrorBox, PageHead, useAsync } from '../ui';

interface Org { name: string; slug: string; logo: string | null; usage: { sites: number; devices: number; users: number }; limits: { sites: number | null; devices: number | null; users: number | null } }

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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (org.data) { setName(org.data.name); setLogo(org.data.logo); } }, [org.data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await api.patch('/admin/organisation', { name, logoDataUrl: logo ?? '' }); setMsg({ ok: true, text: t.org.saved }); org.reload(); }
    catch (err) { setMsg({ ok: false, text: errorText(t, err) }); }
  };
  const row = (label: string, used: number, max: number | null) => (
    <tr><td>{label}</td><td className="num"><strong>{used}</strong> / {max ?? t.org.unlimited}</td></tr>
  );

  return (
    <>
      <PageHead title={t.org.title} intro={t.org.intro} />
      <ErrorBox error={org.error} />
      {org.data && (
        <div className="a-grid">
          <form className="a-card stack" onSubmit={save}>
            <div className="field"><label htmlFor="on">{t.org.name}</label><input id="on" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required /></div>
            <div className="field">
              <span className="label">{t.org.logo}</span>
              {logo && <img src={logo} alt="" style={{ maxHeight: 64, maxWidth: 220, objectFit: 'contain', justifySelf: 'start' }} />}
              <div className="inline">
                <input type="file" accept="image/png,image/jpeg" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setLogo(await toLogo(f)); }} />
                {logo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogo(null)}>{t.org.removeLogo}</button>}
              </div>
              <span className="hint">{t.org.logoHint}</span>
            </div>
            {msg && <p className={msg.ok ? 'alert alert-info' : 'alert'} role="status">{msg.text}</p>}
            <div><button className="btn btn-primary">{t.org.save}</button></div>
          </form>
          <div className="a-card">
            <h2>{t.org.plan}</h2>
            <table><tbody>
              {row(t.org.sites, org.data.usage.sites, org.data.limits.sites)}
              {row(t.org.devices, org.data.usage.devices, org.data.limits.devices)}
              {row(t.org.users, org.data.usage.users, org.data.limits.users)}
            </tbody></table>
            <p className="muted" style={{ marginBottom: 0 }}>{t.org.planHint}</p>
            <p className="muted">{t.org.address}: <code>{window.location.host}</code></p>
          </div>
        </div>
      )}
    </>
  );
}
