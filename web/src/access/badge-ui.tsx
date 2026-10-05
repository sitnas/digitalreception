import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { currentBrand, onBrandChange, squareColors, usesSecondary } from '../lib/theme';

/**
 * Building blocks of the "My badge" page, drawn like the phone app (mobile/src/components/ui.tsx
 * and motion.tsx): same sizes, colours and motion, so the page and the app look the same.
 * Every animation stops when the system asks for reduced motion.
 */

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function Button({ label, onClick, kind = 'primary', busy = false, disabled = false, type = 'button' }: {
  label: string; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean; type?: 'button' | 'submit';
}) {
  return (
    <button type={type} className={`mb-btn mb-btn-${kind}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy}>
      {busy ? <span className="mb-spinner" aria-hidden /> : label}
      {busy && <span className="sr-only">{label}</span>}
    </button>
  );
}

export function Field({ id, label, error, inputRef, className, ...input }: { id: string; label: string; error?: string | null; inputRef?: React.Ref<HTMLInputElement> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={inputRef} className={`mb-input${className ? ` ${className}` : ''}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} {...input} />
      {error && <span id={`${id}-err`} className="mb-error" role="alert">{error}</span>}
    </div>
  );
}

/** Title row of a secondary screen, with the way back. */
export function ScreenHeader({ title, backLabel, onBack }: { title: string; backLabel: string; onBack?: () => void }) {
  return (
    <header className="mb-header">
      {onBack ? <button type="button" className="mb-back" onClick={onBack}>‹ {backLabel}</button> : <span aria-hidden />}
      <h1>{title}</h1>
      <span aria-hidden />
    </header>
  );
}

/** One of a few mutually exclusive choices (day, site, reason). */
export function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} className="mb-chip" onClick={onClick}>{label}</button>;
}

export function Screen({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <main className={`mb-content${center ? ' mb-center' : ''}`}>{children}</main>;
}

/**
 * A ring around the QR that drains during the step: at a glance you see when the code changes.
 * `left` and `step` are in seconds. A new code remounts the ring, so it refills without running backwards.
 */
export function QrRing({ codeStep, left, step, children }: { codeStep: number; left: number; step: number; children: ReactNode }) {
  const STROKE = 4, GAP = 6, RADIUS = 18;
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = box.w + 2 * (GAP + STROKE), h = box.h + 2 * (GAP + STROKE);
  const rw = w - STROKE, rh = h - STROKE;
  const perimeter = 2 * (rw + rh) - (8 - 2 * Math.PI) * RADIUS;
  // Where the ring will be one second from now: the 1 s linear transition makes the drain smooth.
  const ahead = Math.max(0, left - 1) / step;
  return (
    <div className="mb-ring" style={{ padding: GAP + STROKE }}>
      {box.w > 0 && (
        <svg width={w} height={h} aria-hidden>
          <rect x={STROKE / 2} y={STROKE / 2} width={rw} height={rh} rx={RADIUS} fill="none" stroke="var(--mb-line)" strokeWidth={STROKE} />
          <Drain key={codeStep} perimeter={perimeter} start={left / step} target={ahead} x={STROKE / 2} rw={rw} rh={rh} rx={RADIUS} stroke={STROKE} />
        </svg>
      )}
      <div ref={inner}>{children}</div>
    </div>
  );
}

function Drain({ perimeter, start, target, x, rw, rh, rx, stroke }: { perimeter: number; start: number; target: number; x: number; rw: number; rh: number; rx: number; stroke: number }) {
  // First paint at the current position without transition, then follow `target` second by second.
  const [value, setValue] = useState(start);
  useEffect(() => { const r = requestAnimationFrame(() => setValue(target)); return () => cancelAnimationFrame(r); }, [target]);
  return (
    <rect className="mb-ring-drain" x={x} y={x} width={rw} height={rh} rx={rx} fill="none" stroke="var(--brand)" strokeWidth={stroke}
      strokeLinecap="round" strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={perimeter * (1 - value)} />
  );
}

/** A tick that draws itself in a disc of the brand colour, with a short vibration where the phone has one. */
export function SuccessCheck({ size = 64 }: { size?: number }) {
  useEffect(() => { try { navigator.vibrate?.(30); } catch { /* not available */ } }, []);
  return (
    <svg className="mb-check" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx={50} cy={50} r={48} fill="var(--brand)" />
      <path d="M30 51 L44 64 L70 36" fill="none" stroke="var(--on-brand)" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The tablet's twinkling squares at the top of the badge card, in the organisation's colours, fading towards
 * the name. Canvas at about 24 frames a second, paused while the page is hidden; still with reduced motion.
 */
export function SquaresBand({ height = 64 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const CELL = 14, FILL = 0.62, FRAME_MS = 1000 / 24;
    const still = reducedMotion();
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const MAX_ALPHA = dark ? 0.34 : 0.28;
    let w = 0, cols = 0, rows = 0, raf = 0, last = 0;
    let squares: { x: number; y: number; peak: number; period: number; delay: number; second: boolean }[] = [];
    const rnd = (i: number, a: number, b: number, c: number) => { const v = Math.sin(i * a + b) * c; return v - Math.floor(v); };
    const colors = () => { const b = currentBrand(); return squareColors(b.primary, b.secondary); };
    let rgb = colors();
    const layout = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, canvas.clientWidth);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL); rows = Math.ceil(height / CELL);
      squares = [];
      // Same deterministic pattern as the app: position, peak brightness and rhythm per square.
      for (let y = 0; y < rows; y++) {
        const envelope = Math.pow(1 - y / rows, 1.8);
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const peak = envelope * (0.35 + 0.65 * rnd(i, 12.9898, 78.233, 43758.5453)) * MAX_ALPHA;
          if (peak < 0.03) continue;
          squares.push({ x: x * CELL + (CELL * (1 - FILL)) / 2, y: y * CELL + (CELL * (1 - FILL)) / 2, peak,
            period: 1400 + rnd(i, 7.137, 33.71, 12345.6789) * 2200, delay: rnd(i, 3.51, 5.91, 9876.54321) * 2400, second: usesSecondary(i) });
        }
      }
    };
    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, height);
      const size = CELL * FILL;
      for (const q of squares) {
        // Breathes between 12 % and 100 % of its peak, like the app's sine loop.
        const phase = still ? 0.5 : 0.5 - 0.5 * Math.cos(((now + q.delay) / q.period) * Math.PI * 2);
        const a = q.peak * (0.12 + 0.88 * phase);
        const c = q.second && rgb.secondary ? rgb.secondary : rgb.primary;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
        ctx.fillRect(q.x, q.y, size, size);
      }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now; draw(now);
    };
    const gate = () => {
      if (still) return;
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => { layout(); draw(performance.now()); });
    ro.observe(canvas);
    layout(); draw(performance.now()); gate();
    document.addEventListener('visibilitychange', gate);
    // The organisation's colours arrive from /api/tenant after the first paint.
    const off = onBrandChange(() => { rgb = colors(); draw(performance.now()); });
    return () => { ro.disconnect(); off(); cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', gate); };
  }, [height]);
  return <canvas ref={ref} className="mb-squares" style={{ height }} aria-hidden />;
}

/** Grey rows that breathe while a list loads, shaped like the rows that will replace them. */
export function SkeletonRows({ label, count = 3 }: { label: string; count?: number }) {
  return (
    <div className="mb-skeleton" role="progressbar" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mb-row">
          <span className="mb-sk" style={{ width: 48, height: 18 }} />
          <span style={{ flex: 1, display: 'grid', gap: 6 }}>
            <span className="mb-sk" style={{ width: `${70 - i * 12}%`, height: 14 }} />
            <span className="mb-sk" style={{ width: `${45 + i * 8}%`, height: 11 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A switch like the phone's, on top of a real checkbox (keyboard and screen readers work as usual). */
export function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden />
    </label>
  );
}

export type TabKey = 'badge' | 'home' | 'invites' | 'parcels' | 'parking';
export interface Tab { key: TabKey; label: string; count?: number }

const TAB_ICONS: Record<TabKey, ReactNode> = {
  badge: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h1M20.5 14v1" /></>,
  home: <path d="M4 10.5L12 4l8 6.5V20H4z" />,
  invites: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18.5 8v6M15.5 11h6" /></>,
  parcels: <><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" /></>,
  parking: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M9.5 17V7h3.2a3 3 0 0 1 0 6H9.5" /></>,
};

/**
 * Bottom tab bar (Mortise mobile navigation: three to five destinations, always in reach). Every tab
 * carries its label; the active one is a filled pill, so it reads by shape and not only by colour.
 */
export function TabBar({ label, tabs, active, onSelect }: { label: string; tabs: Tab[]; active: TabKey; onSelect: (k: TabKey) => void }) {
  return (
    <nav className="mb-tabs" aria-label={label}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <button type="button" className="mb-tab" aria-current={tab.key === active ? 'page' : undefined} onClick={() => onSelect(tab.key)}>
              <span className="mb-tab-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{TAB_ICONS[tab.key]}</svg>
                <span>{tab.label}</span>
              </span>
              {tab.count ? <em>{tab.count}</em> : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
