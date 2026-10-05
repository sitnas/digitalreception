import { useState } from 'react';

/**
 * Minimal, dependency-free charts for single-series data.
 * One series = one colour (the brand variant with >= 3:1 contrast on the surface), no legend:
 * the card title names what is plotted. Values are text in ink colours, never in the data colour.
 */

export interface Datum { key: string; label: string; value: number; tip?: string }

/** Rounds the axis top to 1 / 2 / 5 × 10^n and returns evenly spaced ticks from 0. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Vertical columns sharing one baseline. `showLabel` decides which x labels to print (avoid crowding). */
export function ColumnChart({ data, height = 180, showLabel = () => true, format = String, caption }: {
  data: Datum[]; height?: number; showLabel?: (d: Datum, i: number) => boolean; format?: (n: number) => string; caption: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1] || 1;
  return (
    <div className="chart" role="img" aria-label={caption}>
      <div className="chart-plot" style={{ height }}>
        <div className="chart-grid" aria-hidden>
          {ticks.map((tk) => (
            <div key={tk} className="chart-gridline" style={{ bottom: `${(tk / top) * 100}%` }}><span>{format(tk)}</span></div>
          ))}
        </div>
        <div className="chart-cols">
          {data.map((d, i) => (
            <div key={d.key} className="chart-col" tabIndex={0} aria-label={`${d.tip ?? d.label}: ${format(d.value)}`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <div className="chart-bar" data-active={hover === i || undefined} style={{ height: `${(d.value / top) * 100}%` }} />
              {hover === i && (
                <div className="chart-tip" role="tooltip" style={{ bottom: `calc(${(d.value / top) * 100}% + 8px)` }}>
                  <strong>{format(d.value)}</strong><span>{d.tip ?? d.label}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="chart-xaxis" aria-hidden>
        {data.map((d, i) => <span key={d.key}>{showLabel(d, i) ? d.label : ''}</span>)}
      </div>
    </div>
  );
}

/** Horizontal bars with the value at the tip and its share of the total. */
export function BarList({ data, total, format = String }: { data: Datum[]; total: number; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="barlist">
      {data.map((d) => {
        const share = total ? Math.round((d.value / total) * 100) : 0;
        return (
          <li key={d.key} title={`${d.label}: ${format(d.value)} (${share}%)`}>
            <span className="barlist-label">{d.label}</span>
            <span className="barlist-track"><span className="barlist-bar" style={{ width: `${(d.value / max) * 100}%` }} /></span>
            <span className="barlist-value"><strong>{format(d.value)}</strong> <span className="muted">{share}%</span></span>
          </li>
        );
      })}
    </ul>
  );
}

/** The same numbers as a table: the chart never gates a value. */
export function DataTable({ summary, head, rows }: { summary: string; head: [string, string]; rows: [string, string][] }) {
  return (
    <details className="chart-data">
      <summary>{summary}</summary>
      <table>
        <thead><tr><th>{head[0]}</th><th style={{ textAlign: 'right' }}>{head[1]}</th></tr></thead>
        <tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td className="num" style={{ textAlign: 'right' }}>{b}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

/**
 * Area chart for one series over days (Mortise dashboard): a black line, a light yellow fill and one
 * highlighted point with a black tooltip, the highest day unless the pointer or the keyboard picks
 * another. The SVG scales to the card; the caption says the main fact for screen readers.
 */
export function AreaChart({ data, format = String, caption, height = 210 }: { data: Datum[]; format?: (n: number) => string; caption: string; height?: number }) {
  const W = 560, H = height, L = 44, R = 16, T = 16, B = 30;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const [pick, setPick] = useState<number | null>(null);
  const at = pick ?? peak;
  const x = (i: number) => L + (data.length > 1 ? (i * (W - L - R)) / (data.length - 1) : (W - L - R) / 2);
  const y = (v: number) => H - B - (v / top) * (H - T - B);
  // Smooth curve through the points (Catmull-Rom as cubic Béziers), never overshooting below zero.
  const pts = data.map((d, i) => [x(i), y(d.value)] as const);
  let line = pts.length ? `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}` : '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(H - B, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(H - B, p2[1] - (p3[1] - p1[1]) / 6)];
    line += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H - B} L${pts[0][0].toFixed(1)} ${H - B} Z` : '';
  const d = data[at];
  const tipW = 96, tipX = d ? Math.min(Math.max(x(at) - tipW / 2, L), W - R - tipW) : 0, tipY = d ? Math.max(0, y(d.value) - 50) : 0;
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    data.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setPick(best);
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setPick(Math.min(data.length - 1, at + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPick(Math.max(0, at - 1)); }
  };
  return (
    <svg className="area-chart" viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={caption}
      onPointerMove={move} onPointerLeave={() => setPick(null)} onKeyDown={key} onBlur={() => setPick(null)}>
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={L} x2={W - R} y1={y(tk)} y2={y(tk)} className="ac-grid" />
          <text x={L - 8} y={y(tk) + 4} textAnchor="end" className="ac-label">{format(tk)}</text>
        </g>
      ))}
      {data.map((dt, i) => <text key={dt.key} x={x(i)} y={H - 8} textAnchor="middle" className="ac-label">{dt.label}</text>)}
      <path d={area} className="ac-area" />
      <path d={line} className="ac-line" />
      {d && (
        <g aria-hidden>
          <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} className="ac-cursor" />
          <circle cx={x(at)} cy={y(d.value)} r={5.5} className="ac-dot" />
          <g transform={`translate(${tipX} ${tipY})`}>
            <rect width={tipW} height={36} rx={9} className="ac-tip" />
            <text x={tipW / 2} y={15} textAnchor="middle" className="ac-tip-day">{d.tip ?? d.label}</text>
            <text x={tipW / 2} y={30} textAnchor="middle" className="ac-tip-value">{format(d.value)}</text>
          </g>
        </g>
      )}
    </svg>
  );
}

/**
 * Doughnut for shares of a whole: at most four series (more are grouped by the caller as "Other"),
 * told apart by lightness and not only by hue, with the total in the middle and a legend carrying
 * label, share and value: the colour is never the only cue.
 */
export function Donut({ data, total, unit, format = String, caption }: { data: Datum[]; total: number; unit: string; format?: (n: number) => string; caption: string }) {
  const R = 62, C = 2 * Math.PI * R, GAP = 2;
  let offset = 0;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div className="donut">
      <svg viewBox="-85 -85 170 170" width="150" height="150" role="img" aria-label={caption}>
        <circle r={R} className="donut-track" />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * C;
          const seg = <circle key={d.key} r={R} className={`donut-seg s${i + 1}`} strokeDasharray={`${Math.max(0, len - (data.length > 1 ? GAP : 0))} ${C}`} strokeDashoffset={-offset} transform="rotate(-90)" />;
          offset += len;
          return seg;
        })}
        <text y={4} textAnchor="middle" className="donut-total">{format(total)}</text>
        <text y={22} textAnchor="middle" className="donut-unit">{unit}</text>
      </svg>
      <ul className="donut-legend">
        {data.map((d, i) => (
          <li key={d.key}><i className={`s${i + 1}`} aria-hidden /><span>{d.label}</span><b>{pct(d.value)}%</b><em>{format(d.value)}</em></li>
        ))}
      </ul>
    </div>
  );
}
