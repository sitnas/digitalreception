import { useEffect, useRef, useState } from 'react';
import type { Strings } from './strings';

/** Same prefixes the API puts in its QR codes: any other QR code is ignored. */
export const EXIT_QR = /^DRX1:([A-Z0-9]{5})$/;
export const INVITE_QR = /^DRI1:([A-Z0-9]{8})$/;
const SCAN_EVERY_MS = 200;
const MAX_SIDE = 640;

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global {
  interface Window { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }
}

/** Native detector when the browser has one (Chrome on Android), otherwise jsQR, loaded only when needed. */
async function makeDecoder(): Promise<(c: HTMLCanvasElement) => Promise<string | null>> {
  const BD = window.BarcodeDetector;
  if (BD && (await BD.getSupportedFormats().catch(() => [] as string[])).includes('qr_code')) {
    const d = new BD({ formats: ['qr_code'] });
    return async (c) => (await d.detect(c))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  return async (c) => {
    const img = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/**
 * Live camera preview that reads the exit QR. Frames are decoded in the browser and never stored
 * or sent: only the recognised visit code leaves this component. The camera stops on unmount.
 */
export function QrScanner({ onCode, onCancel, t, accept = EXIT_QR, wrongText, cancelText }: {
  onCode: (code: string) => void; onCancel?: () => void; t: Strings; accept?: RegExp; wrongText?: string; cancelText?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  // The latest callback, read when a code is found: a new function from a re-render must not restart the camera.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [error, setError] = useState(false);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');

    (async () => {
      try {
        // The visitor holds the phone up to the tablet: prefer the camera on the screen side.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const decode = await makeDecoder();
        const tick = async () => {
          if (stopped) return;
          if (v.videoWidth) {
            const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
            canvas.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0, canvas.width, canvas.height);
            const text = await decode(canvas).catch(() => null);
            const m = text ? accept.exec(text.trim()) : null;
            if (m) { stopped = true; onCodeRef.current(m[1]); return; }
            if (text) setWrong(true);
          }
          timer = window.setTimeout(tick, SCAN_EVERY_MS);
        };
        tick();
      } catch {
        if (!stopped) setError(true);
      }
    })();

    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [accept]);

  return (
    <div className="k-scan">
      {error ? <p className="alert" role="alert" style={{ margin: 0 }}>{t.scanNoCamera}</p> : (
        <div className="k-scan-view">
          <video ref={video} muted playsInline aria-label={t.scanTitle} />
          <div className="k-scan-frame" aria-hidden />
        </div>
      )}
      <p className="muted" style={{ margin: 0 }} role="status">{wrong ? (wrongText ?? t.scanWrong) : t.scanHint}</p>
      {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{cancelText ?? t.scanStop}</button>}
    </div>
  );
}
