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
