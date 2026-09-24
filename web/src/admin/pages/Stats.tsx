import { useState } from 'react';
import { api, qs } from '../../lib/api';
import { dayEnd, dayStart, todayIso } from '../../lib/format';
import { BarList, ColumnChart, DataTable, Datum } from '../charts';
import { useI18n } from '../i18n';
import type { Site } from '../types';
import { ErrorBox, PageHead, SiteSelect, useAsync } from '../ui';

interface Stats {
  total: number; days: number; avgPerDay: number;
  durationMinutes: { average: number | null; median: number | null; sample: number };
  byDay: { date: string; count: number }[]; byHour: number[]; byWeekday: number[];
  byPurpose: Record<string, number>; byDistance: Record<string, number>;
  bySite: { id: string; name: string; count: number }[];
}

type Preset = 7 | 30 | 90 | 'custom';
const PRESETS: Preset[] = [7, 30, 90, 'custom'];
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/** Aggregate numbers only: no visitor is identifiable from anything on this page. */
export function StatsPage() {
  const { t, intl } = useI18n();
  const sites = useAsync(() => api.get<Site[]>('/admin/sites'), []);
  const [siteId, setSiteId] = useState('');
  const [preset, setPreset] = useState<Preset>(30);
  const [custom, setCustom] = useState({ from: daysAgo(30), to: todayIso() });
  const range = preset === 'custom' ? custom : { from: daysAgo(preset), to: todayIso() };
  const stats = useAsync(() => api.get<Stats>(`/admin/stats${qs({ siteId, from: dayStart(range.from), to: dayEnd(range.to) })}`), [siteId, range.from, range.to]);
  const s = stats.data;

  const n = (v: number) => new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(v);
  const dur = (m: number | null) => (m === null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);
  const peakHour = s && s.total ? s.byHour.indexOf(Math.max(...s.byHour)) : null;
  const dayFmt = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayLong = new Intl.DateTimeFormat(intl, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))));

  const byDay: Datum[] = s?.byDay.map((d) => { const dt = new Date(`${d.date}T00:00:00Z`); return { key: d.date, label: dayFmt.format(dt), tip: dayLong.format(dt), value: d.count }; }) ?? [];
  const every = Math.max(1, Math.ceil(byDay.length / 8));
  const byHour: Datum[] = s?.byHour.map((v, h) => ({ key: String(h), label: `${h}`, tip: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`, value: v })) ?? [];
  const byWeekday: Datum[] = s?.byWeekday.map((v, i) => ({ key: String(i), label: weekdays[i], value: v })) ?? [];
  const purposes: Datum[] = s ? Object.entries(s.byPurpose).map(([k, v]) => ({ key: k, label: t.purposes[k as keyof typeof t.purposes] ?? k, value: v })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value) : [];
  // Distance is ordinal: keep the natural order (near → far), never sort by size.
  const distances: Datum[] = s ? (['UNDER_10_KM', 'FROM_10_TO_100_KM', 'OVER_100_KM', 'UNKNOWN'] as const)
    .map((k) => ({ key: k, label: k === 'UNKNOWN' ? t.stats.notAsked : t.distances[k], value: s.byDistance[k] ?? 0 }))
    .filter((d) => d.key !== 'UNKNOWN' || d.value > 0) : [];
  const bySite: Datum[] = s?.bySite.map((x) => ({ key: x.id, label: x.name, value: x.count })) ?? [];
  const table = (rows: Datum[]): [string, string][] => rows.map((d) => [d.tip ?? d.label, n(d.value)]);

  return (
    <>
      <PageHead title={t.stats.title} intro={t.stats.intro} />
      <div className="a-filters">
        {sites.data && sites.data.length > 1 && <SiteSelect sites={sites.data} value={siteId} onChange={setSiteId} allowAll />}
        <div className="field">
          <span className="label">{t.stats.period}</span>
          <div className="segmented" role="tablist" aria-label={t.stats.period}>
            {PRESETS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={preset === p} onClick={() => setPreset(p)}>
                {p === 'custom' ? t.stats.custom : t.stats.lastDays.replace('{n}', String(p))}
              </button>
            ))}
          </div>
        </div>
        {preset === 'custom' && (
          <>
            <div className="field"><label htmlFor="sf">{t.from}</label><input id="sf" type="date" className="input" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></div>
            <div className="field"><label htmlFor="st">{t.to}</label><input id="st" type="date" className="input" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></div>
          </>
        )}
      </div>
      <ErrorBox error={stats.error ?? sites.error} />

      {s && (
        <div className="stats" style={{ opacity: stats.loading ? 0.6 : 1 }}>
          <div className="stat-tiles">
            <div className="stat-tile"><span>{t.stats.visits}</span><strong>{n(s.total)}</strong></div>
            <div className="stat-tile"><span>{t.stats.perDay}</span><strong>{n(s.avgPerDay)}</strong></div>
            <div className="stat-tile"><span>{t.stats.duration}</span><strong>{dur(s.durationMinutes.median)}</strong><small>{t.stats.durationHint.replace('{avg}', dur(s.durationMinutes.average))}</small></div>
            <div className="stat-tile"><span>{t.stats.peak}</span><strong>{peakHour === null ? '—' : `${String(peakHour).padStart(2, '0')}:00`}</strong></div>
          </div>

          {s.total === 0 ? <p className="empty a-card">{t.stats.empty}</p> : (
            <div className="stats-grid">
              <section className="a-card stats-wide">
                <h2>{t.stats.perDayChart}</h2>
                <ColumnChart data={byDay} caption={t.stats.perDayChart} showLabel={(_, i) => i % every === 0} format={n} />
                <DataTable summary={t.stats.showData} head={[t.stats.day, t.stats.visits]} rows={table(byDay)} />
              </section>
              <section className="a-card">
                <h2>{t.stats.byHour}</h2>
                <ColumnChart data={byHour} caption={t.stats.byHour} showLabel={(_, i) => i % 3 === 0} format={n} height={150} />
                <DataTable summary={t.stats.showData} head={[t.stats.hour, t.stats.visits]} rows={table(byHour)} />
              </section>
              <section className="a-card">
                <h2>{t.stats.byWeekday}</h2>
                <ColumnChart data={byWeekday} caption={t.stats.byWeekday} format={n} height={150} />
                <DataTable summary={t.stats.showData} head={[t.stats.weekday, t.stats.visits]} rows={table(byWeekday)} />
              </section>
              <section className="a-card">
                <h2>{t.stats.byPurpose}</h2>
                <BarList data={purposes} total={s.total} format={n} />
              </section>
              <section className="a-card">
                <h2>{t.stats.byDistance}</h2>
                <BarList data={distances} total={s.total} format={n} />
              </section>
              {bySite.length > 1 && (
                <section className="a-card">
                  <h2>{t.stats.bySite}</h2>
                  <BarList data={bySite} total={s.total} format={n} />
                </section>
              )}
            </div>
          )}
          <p className="muted" style={{ fontSize: 13 }}>{t.stats.footnote}</p>
        </div>
      )}
    </>
  );
}
