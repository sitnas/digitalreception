import type { Badge } from './badge';

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function call<R>(origin: string, path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`${origin}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, Array.isArray(data.message) ? data.message[0] : data.message ?? String(r.status));
  return data as R;
}

export interface Tenant { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null }

/** Public branding of the organisation: also proves the address really is a digitalreception server. */
export const getTenant = (origin: string) => call<Tenant>(origin, '/tenant');

export const requestCode = (origin: string, email: string, locale: string) =>
  call<{ ok: true; step: number }>(origin, '/badge/request', { method: 'POST', body: JSON.stringify({ email, locale }) });

export const activate = (origin: string, email: string, code: string) =>
  call<Omit<Badge, 'origin' | 'primaryColor'>>(origin, '/badge/activate', { method: 'POST', body: JSON.stringify({ email, code }) });

/** Server time from the Date header, to warn when the phone clock is off (the QR depends on it). */
export async function serverClockOffsetMs(origin: string): Promise<number | null> {
  try {
    const before = Date.now();
    const r = await fetch(`${origin}/api/health`, { method: 'GET' });
    const date = r.headers.get('date');
    if (!date) return null;
    return Date.parse(date) - (before + Date.now()) / 2;
  } catch { return null; }
}
