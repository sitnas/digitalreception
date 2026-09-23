import { useEffect, useRef, useState } from 'react';
import { compressPhoto } from '../lib/image';
import type { Strings } from './strings';

export function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="k-steps" aria-label="Progress">
      {labels.map((l, i) => (
        <li key={l} className={i < current ? 'done' : undefined} aria-current={i === current ? 'step' : undefined}>
          <span className="n">{i < current ? '✓' : i + 1}</span>{l}
        </li>
      ))}
    </ol>
  );
}

/** Finger / stylus signature. Exports a PNG data URL; nothing is kept once the flow ends. */
export function SignaturePad({ onChange, clearLabel }: { onChange: (dataUrl: string | null) => void; clearLabel: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111111';
      dirty.current = false; setEmpty(true); onChange(null);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [onChange]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
    if (!dirty.current) { dirty.current = true; setEmpty(false); }
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    if (dirty.current) onChange(canvasRef.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    dirty.current = false; setEmpty(true); onChange(null);
  };

  return (
    <div className="stack">
      <div className="k-sign">
        <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} aria-label="Signature" role="img" />
      </div>
      <div><button type="button" className="btn btn-ghost" onClick={clear} disabled={empty}>{clearLabel}</button></div>
    </div>
  );
}

export function PhotoCapture({ title, hint, value, onChange, t }: { title: string; hint: string; value: string | null; onChange: (v: string | null) => void; t: Strings }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { onChange(await compressPhoto(f)); } finally { setBusy(false); }
  };
  return (
    <div className="k-photo">
      <div>
        <h3 className="k-h2" style={{ fontSize: 26 }}>{title}</h3>
        <p className="muted" style={{ margin: 0 }}>{hint}</p>
      </div>
      {value && <img src={value} alt={title} />}
      <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} tabIndex={-1} />
      <button type="button" className={value ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => input.current?.click()} disabled={busy}>
        {busy ? '…' : value ? t.retakePhoto : t.takePhoto}
      </button>
    </div>
  );
}
