import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n';
import type { Site, VisitStatus } from './types';

export function PageHead({ title, intro, actions }: { title: string; intro?: string; actions?: ReactNode }) {
  return (
    <div className="a-head">
      <div><h1>{title}</h1>{intro && <p>{intro}</p>}</div>
      {actions && <div className="inline no-print">{actions}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: VisitStatus }) {
  const { t } = useI18n();
  return <span className={`pill ${status}`}>{t.status[status]}</span>;
}

export function SiteSelect({ sites, value, onChange, allowAll, id = 'site' }: { sites: Site[]; value: string; onChange: (v: string) => void; allowAll?: boolean; id?: string }) {
  const { t } = useI18n();
  return (
    <div className="field">
      <label htmlFor={id}>{t.site}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">{t.allSites}</option>}
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.countryCode})</option>)}
      </select>
    </div>
  );
}

/** Loads data, exposes reload, keeps the last error. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await run()); setError(null); } catch (e) { setError(e); } finally { setLoading(false); }
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  const code = (error as { code?: string }).code;
  const status = (error as { status?: number }).status;
  const msg = code && code in t.errors ? t.errors[code as keyof typeof t.errors] : status === 403 ? t.errors.forbidden : t.errors.generic;
  return <p className="alert" role="alert">{msg}</p>;
}

export function strongPassword(): string {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => a[x % a.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}
