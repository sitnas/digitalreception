import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { fmtTime } from '../lib/format';
import { PhotoCapture } from './parts';
import type { Locale, Strings } from './strings';
import type { KioskConfig } from './types';

interface Match { id: string; label: string; checkInAt: string; assetPhotoRequired: boolean }

export function CheckOut({ cfg, locale, t, onDone, onCancel }: { cfg: KioskConfig; locale: Locale; t: Strings; onDone: () => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Match[] | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [assetPhoto, setAssetPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    setSelected(null);
    if (term.length < 2) { setResults(null); return; }
    const h = setTimeout(async () => {
      try { setResults(await api.kiosk.get<Match[]>(`/visits/open?q=${encodeURIComponent(term)}`)); setError(null); }
      catch (e) { setError(e instanceof ApiError ? t.errors.generic : t.errors.offline); }
    }, 350);
    return () => clearTimeout(h);
  }, [q, t]);

  const confirm = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await api.kiosk.post(`/visits/${selected.id}/checkout`, { assetPhoto: selected.assetPhotoRequired ? assetPhoto : undefined });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === 'VISIT_ALREADY_CLOSED' ? t.errors.VISIT_ALREADY_CLOSED : t.errors.generic) : t.errors.offline);
    } finally { setBusy(false); }
  };

  const needsPhoto = !!selected?.assetPhotoRequired;
  const loc = locale === 'en' ? 'en-GB' : locale;

  return (
    <div className="stack">
      <div><h1 className="k-h2">{t.outTitle}</h1><p className="muted" style={{ margin: 0 }}>{t.outHint}</p></div>
      <div className="field">
        <label htmlFor="q" className="sr-only">{t.outSearch}</label>
        <input id="q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.outSearch} autoComplete="off" autoCapitalize="none" maxLength={40} autoFocus />
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {results && results.length === 0 && <p className="muted">{t.outNone}</p>}
      {results && results.length > 0 && (
        <div className="k-results" role="listbox" aria-label={t.outTitle}>
          {results.map((r) => (
            <button key={r.id} type="button" className="k-result" role="option" aria-selected={selected?.id === r.id} aria-pressed={selected?.id === r.id} onClick={() => setSelected(r)}>
              <strong>{r.label}</strong><small>{t.inAt} {fmtTime(r.checkInAt, loc, cfg.site.timezone)}</small>
            </button>
          ))}
        </div>
      )}
      {needsPhoto && <PhotoCapture title={t.photoAssetTitle} hint={t.photoAssetHint} value={assetPhoto} onChange={setAssetPhoto} t={t} />}
      <div className="k-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || !selected || (needsPhoto && !assetPhoto)}>{busy ? t.sending : t.outConfirm}</button>
      </div>
    </div>
  );
}
