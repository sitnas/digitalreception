import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import type { Site, VisitStatus } from './types';

/** Arrow keys, Home and End move between tabs of a tablist (one Tab stop for the whole list). */
export function onTabListKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const n = tabs.length;
  const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
  if (next < 0) return;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Drawers, windows and the phone menu (Mortise dashboard): focus moves in, stays inside while Tab
 * goes round, Escape closes, and focus goes back to the control that opened it. The page behind
 * does not scroll meanwhile.
 */
export function useDialog(ref: React.RefObject<HTMLElement>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  // Who had the focus when the dialog was first drawn: it gets it back on closing.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0] ?? el).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus(); };
  }, [ref, opener]);
}

/** The visible X of a drawer or window, with its accessible name. */
export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} aria-label={label}>
      <svg viewBox="-8 -8 16 16" width="16" height="16" aria-hidden><path d="M-6 -6L6 6M6 -6L-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
    </button>
  );
}
