import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { intlLocale, t } from './badge-strings';
import { Button, Chip, Screen, ScreenHeader } from './badge-ui';
import { me } from './BadgeInvites';
import { parkingWeeks, type ParkingBookMany, type ParkingDay, type ParkingSpotChoice, type ParkingView } from './invites';

const P = t.parking;
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale, { ...o, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd, 12)));
};
/** "giovedì 8 ottobre", in the language of the app (written as the language writes it). */
const longDay = (d: string) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
/** "gio 8 ott", for lists of days. */
const shortDay = (d: string) => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
const reason = (code: string) => (P.errors as Record<string, string>)[code] ?? t.errors.generic;
const explain = (e: unknown) => (e instanceof ApiError ? reason(e.code) : t.errors.offline);

/**
 * The Parking app on /badge, the same screen as in the phone app: a calendar of two weeks where the
 * person picks one or more days, then the spot (or the first free one), and books them in one go.
 */
export function ParkingScreen({ token, onBack }: { token: string; onBack?: () => void }) {
  const [view, setView] = useState<ParkingView | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [spots, setSpots] = useState<ParkingSpotChoice[] | null>(null);
  const [spotId, setSpotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (siteId?: string) => {
    try { setView(await me<ParkingView>(token, `/parking${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`)); setError(null); }
    catch (e) { setError(explain(e)); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // The spots follow the days picked: only those free on all of them can be chosen.
  const siteId = view?.site?.id;
  useEffect(() => {
    if (!siteId || !picked.length) { setSpots(null); return; }
    let live = true;
    me<ParkingSpotChoice[]>(token, `/parking/spots?siteId=${encodeURIComponent(siteId)}&dates=${picked.join(',')}`)
      .then((s) => { if (!live) return; setSpots(s); setSpotId((cur) => (cur && s.some((x) => x.id === cur && x.free) ? cur : null)); })
      .catch((e) => live && setError(explain(e)));
    return () => { live = false; };
  }, [token, siteId, picked]);

  const left = view?.maxActive == null ? Infinity : view.maxActive - view.active;
  const changeSite = (id: string) => { setPicked([]); setNotice(null); load(id); };
  const toggle = (day: ParkingDay) => {
    setNotice(null); setError(null);
    if (picked.includes(day.date)) { setPicked(picked.filter((d) => d !== day.date)); return; }
    if (picked.length >= left) { setError(left > 0 ? (left === 1 ? P.leftOne : P.leftMany.replace('{n}', String(left))) : reason('PARKING_LIMIT')); return; }
    setPicked([...picked, day.date].sort());
  };
  const book = async () => {
    if (!siteId || !picked.length) return;
    setBusy('book'); setError(null); setNotice(null);
    try {
      const r = await me<ParkingBookMany>(token, '/parking/bookings', { method: 'POST', body: JSON.stringify({ siteId, dates: picked, ...(spotId ? { spotId } : {}) }) });
      if (r.booked.length) setNotice(P.bookedDays.replace('{list}', r.booked.map((b) => P.dayOn.replace('{day}', shortDay(b.date)).replace('{spot}', b.spot)).join('; ')));
      if (r.failed.length) setError(r.failed.map((f) => P.failedDay.replace('{day}', shortDay(f.date)).replace('{reason}', reason(f.code))).join('\n'));
      setPicked([]); setSpotId(null);
    } catch (e) { setError(explain(e)); }
    finally { await load(siteId); setBusy(null); }
  };
  const release = async (day: ParkingDay) => {
    if (!window.confirm(`${P.releaseTitle}\n${P.releaseText}`)) return;
    setBusy(day.date); setError(null); setNotice(null);
    try { await me(token, `/parking/${day.booking!.id}`, { method: 'DELETE' }); } catch (e) { setError(explain(e)); }
    finally { await load(siteId); setBusy(null); }
  };

  const today = view?.days[0]?.date;
  const free = spots?.filter((s) => s.free) ?? [];
  const chosen = free.find((s) => s.id === spotId);

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
          <div className="mb-chips" role="radiogroup">{view.sites.map((s) => <Chip key={s.id} label={s.name} selected={view.site?.id === s.id} onClick={() => changeSite(s.id)} />)}</div>
        )}

        {view?.site && <>
          <h2 className="mb-section">{P.pick}</h2>
          <p className="mb-small">{P.pickHint}</p>
          {parkingWeeks(view.days).map((w, i) => (
            <section key={w.monday} className="mb-cal" aria-label={i === 0 && w.monday <= (today ?? '') ? P.thisWeek : P.nextWeek}>
              <h3>{i === 0 && w.monday <= (today ?? '') ? P.thisWeek : P.nextWeek}</h3>
              <div className="mb-cal-grid">
                {w.cells.map(({ date, day }) => {
                  const head = <><small>{fmt(date, { weekday: 'short' })}</small><b>{fmt(date, { day: 'numeric' })}</b></>;
                  if (!day) return <span key={date} className="mb-cal-day is-past" aria-hidden>{head}</span>;
                  if (day.booking) {
                    return (
                      <button key={date} type="button" className="mb-cal-day is-booked" disabled={busy !== null}
                        aria-label={`${longDay(date)}, ${P.spot.replace('{spot}', day.booking.spot)}. ${day.booking.source === 'AUTO' ? P.release : P.cancel}`}
                        onClick={() => release(day)}>
                        {head}<span>{busy === date ? '…' : day.booking.spot}</span>
                      </button>
                    );
                  }
                  const open = day.bookable && day.free > 0;
                  const on = picked.includes(date);
                  const status = !day.bookable ? P.closed : day.free > 0 ? P.free.replace('{n}', String(day.free)) : P.full;
                  return (
                    <button key={date} type="button" className={`mb-cal-day${on ? ' is-on' : ''}${open ? '' : ' is-off'}`} disabled={!open || busy !== null}
                      aria-pressed={open ? on : undefined} aria-label={`${longDay(date)}, ${status}${on ? `, ${P.selected}` : ''}`} onClick={() => toggle(day)}>
                      {head}<span>{status}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>}
        <div role="status" aria-live="polite">{notice && <p className="mb-notice">{notice}</p>}</div>
        {error && <p className="mb-error-block" role="alert">{error}</p>}

        {picked.length > 0 && <>
          <h2 className="mb-section">{P.spotTitle}</h2>
          <div className="mb-spots" role="radiogroup" aria-label={P.spotTitle}>
            <button type="button" role="radio" aria-checked={spotId === null} className="mb-spot" onClick={() => setSpotId(null)}>
              <strong>{P.anySpot}</strong><span>{P.anySpotHint}</span>
            </button>
            {free.length > 0 && (
              <div className="mb-spot-grid">
                {free.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={spotId === s.id} className="mb-spot-tile"
                    aria-label={`${P.spot.replace('{spot}', s.code)}${s.note ? `, ${s.note}` : ''}`} onClick={() => setSpotId(s.id)}>
                    {s.code}{s.note && <i aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {chosen?.note && <p className="mb-small">{P.spot.replace('{spot}', chosen.code)}: {chosen.note}</p>}
          {spots && free.length === 0 && <p className="mb-small">{P.noCommonSpot}</p>}
          <Button label={picked.length === 1 ? P.bookOne : P.bookMany.replace('{n}', String(picked.length))} busy={busy === 'book'} disabled={busy !== null} onClick={book} />
          <Button label={P.clear} kind="ghost" disabled={busy !== null} onClick={() => { setPicked([]); setSpotId(null); }} />
        </>}

      </Screen>
    </>
  );
}
