import { useEffect, useRef } from 'react';
import { currentBrand, onBrandChange, squareColors, usesSecondary } from '../lib/theme';

/**
 * Twinkling squares in the organisation's colours along the bottom of the welcome screen.
 * Adapted from Originkit's "Blinking Squares" (canvas 2D, no dependencies), tuned for a tablet that
 * stays on all day: about 24 frames a second, paused while the page is hidden, a single still frame
 * when the system asks for reduced motion, and never behind the text (it fades out well before it).
 */

const CELLS_ON_LONG_SIDE = 30;
const FILL = 0.62;
const MAX_ALPHA = 0.32;
/** Share of the backdrop height where the squares are at full strength before fading towards the top. */
const SOLID = 0.15;
const FRAME_MS = 1000 / 24;
const SPEED = 0.35;

/** Deterministic pseudo-random values per cell, so the pattern does not jump on resize. */
function cellSeed(i: number) {
  const f = (a: number, b: number, c: number) => { const s = Math.sin(i * a + b) * c; return s - Math.floor(s); };
  return { phase: f(12.9898, 78.233, 43758.5453) * Math.PI * 2, rate: 0.6 + f(7.137, 33.71, 12345.6789) * 0.8, second: usesSecondary(i) };
}

export function BrandBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let w = 0, h = 0, cols = 0, rows = 0, cell = 0;
    let seeds: ReturnType<typeof cellSeed>[] = [];
    const colors = () => { const b = currentBrand(); return squareColors(b.primary, b.secondary); };
    let rgb = colors();
    let raf = 0, last = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, canvas.clientWidth); h = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = Math.max(w, window.innerHeight) / CELLS_ON_LONG_SIDE;
      cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);
      seeds = Array.from({ length: cols * rows }, (_, i) => cellSeed(i));
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      const size = cell * FILL, inset = cell * (1 - FILL) / 2;
      for (let y = 0; y < rows; y++) {
        // 1 at the bottom row, fading to 0 at the top of the backdrop.
        const u = 1 - (y + 0.5) / rows;
        const envelope = u <= SOLID ? 1 : Math.pow(1 - (u - SOLID) / (1 - SOLID), 2.2);
        if (envelope < 0.01) continue;
        for (let x = 0; x < cols; x++) {
          const s = seeds[y * cols + x];
          const twinkle = reduced ? 0.5 + 0.5 * Math.sin(s.phase) : 0.5 + 0.5 * Math.sin(t * SPEED * s.rate * Math.PI * 2 + s.phase);
          const a = envelope * twinkle * MAX_ALPHA;
          if (a < 0.01) continue;
          const c = s.second && rgb.secondary ? rgb.secondary : rgb.primary;
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
          ctx.fillRect(x * cell + inset, h - (rows - y) * cell + inset, size, size);
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
    };
    const gate = () => {
      if (reduced) return;
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
    ro.observe(canvas);
    resize();
    draw(performance.now());
    gate();
    document.addEventListener('visibilitychange', gate);
    // The organisation's colours can arrive (or change in the console) after the first paint.
    const off = onBrandChange(() => { rgb = colors(); draw(performance.now()); });
    return () => { ro.disconnect(); off(); cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', gate); };
  }, []);

  return <canvas ref={canvasRef} className="k-backdrop" aria-hidden="true" />;
}
