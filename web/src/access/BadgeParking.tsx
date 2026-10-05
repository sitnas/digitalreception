import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { intlLocale, t } from './badge-strings';
import { Button, Chip, Screen, ScreenHeader } from './badge-ui';
import { me } from './BadgeInvites';
import type { ParkingDay, ParkingView } from './invites';

const P = t.parking;
/** "giovedì 8 ottobre", in the language of the app (written as the language writes it). */
const longDay = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd, 12)));
};
const explain = (e: unknown) => (e instanceof ApiError ? (P.errors as Record<string, string>)[e.code] ?? t.errors.generic : t.errors.offline);

/** The Parking app on /badge, the same screen as in the phone app. */
export function ParkingScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [view, setView] = useState<ParkingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (siteId?: string) => {
    try { setView(await me<ParkingView>(token, `/parking${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`)); setError(null); }
    catch (e) { setError(explain(e)); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const today = view?.days[0]?.date;
  const label = (d: string) => {
    if (d === today) return P.today;
    const tomorrow = today && new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 1)).toISOString().slice(0, 10);
    if (d === tomorrow) return P.tomorrow;
    const text = longDay(d);
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const run = async (day: ParkingDay, fn: () => Promise<unknown>, ok?: (r: unknown) => string) => {
    setBusy(day.date); setError(null); setNotice(null);
    try { const r = await fn(); if (ok) setNotice(ok(r)); } catch (e) { setError(explain(e)); } finally { await load(view?.site?.id); setBusy(null); }
  };
  const book = (day: ParkingDay) => run(day, () => me(token, '/parking', { method: 'POST', body: JSON.stringify({ siteId: view!.site!.id, date: day.date }) }),
    (r) => P.booked.replace('{spot}', (r as { spot: string }).spot));
  const release = (day: ParkingDay) => {
    if (!window.confirm(`${P.releaseTitle}\n${P.releaseText}`)) return;
    run(day, () => me(token, `/parking/${day.booking!.id}`, { method: 'DELETE' }));
  };

  return (
    <>
      <ScreenHeader title={P.title} backLabel={t.settings.back} onBack={onBack} />
      <Screen>
        {!view && !error && <p className="mb-small">{t.loading}</p>}
        {view && !view.site && <p className="mb-text">{P.none}</p>}
        {view?.site && (
          <div className="mb-row-card">
            {view.fixedSpot ? <>
              <strong>{P.fixed.replace('{spot}', view.fixedSpot.code)}</strong>
              {view.fixedSpot.note && <span>{view.fixedSpot.note}</span>}
              <span>{P.fixedHint}</span>
            </> : <>
              <span>{P.userHint.replace('{n}', String(view.maxActive ?? 4))}</span>
              {view.maxActive && <strong>{P.active.replace('{n}', String(view.active)).replace('{max}', String(view.maxActive))}</strong>}
            </>}
            {view.opensOn && <span>{P.opens.replace('{date}', longDay(view.opensOn))}</span>}
          </div>
        )}
        {view && view.sites.length > 1 && (
          <div className="mb-chips" role="radiogroup">{view.sites.map((s) => <Chip key={s.id} label={s.name} selected={view.site?.id === s.id} onClick={() => load(s.id)} />)}</div>
        )}
        <div role="status" aria-live="polite">{notice && <p className="mb-notice">{notice}</p>}</div>
        {error && <p className="mb-error-block" role="alert">{error}</p>}
        {view?.days.map((d) => (
          <div key={d.date} className={`mb-park-day${d.booking ? ' is-booked' : ''}`}>
            <div>
              <strong>{label(d.date)}</strong>
              <span>{d.booking ? `${P.spot.replace('{spot}', d.booking.spot)}${d.booking.source === 'AUTO' ? ` · ${P.auto}` : ''}`
                : !d.bookable ? P.notOpen : d.free > 0 ? P.free.replace('{n}', String(d.free)) : P.full}</span>
            </div>
            {d.booking ? <Button label={d.booking.source === 'AUTO' ? P.release : P.cancel} kind="ghost" busy={busy === d.date} onClick={() => release(d)} />
              : d.bookable && d.free > 0 ? <Button label={P.book} busy={busy === d.date} disabled={busy !== null} onClick={() => book(d)} /> : null}
          </div>
        ))}
      </Screen>
    </>
  );
}
