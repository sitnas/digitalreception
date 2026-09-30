import type { Badge } from './badge';
import type { Invite, NewInvite, Profile } from './invites';

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

// ------------------------------------------------------------------ the employee's own requests

type Authed = Pick<Badge, 'origin' | 'appToken'>;
const authed = <R>(b: Authed, path: string, init?: RequestInit) => {
  if (!b.appToken) return Promise.reject(new ApiError(401, 'APP_TOKEN_REQUIRED'));
  return call<R>(b.origin, `/me${path}`, { ...init, headers: { Authorization: `Bearer ${b.appToken}` } });
};

/** Who I am and, if I can be visited, where: `canInvite` turns the invitations on in the app. */
export const getProfile = (b: Authed) => authed<Profile>(b, '');
export const listInvites = (b: Authed, scope: 'upcoming' | 'past' = 'upcoming') => authed<Invite[]>(b, `/invitations?scope=${scope}`);
export const createInvite = (b: Authed, v: NewInvite, locale: string) =>
  authed<{ id: string; emailStatus: string }>(b, '/invitations', { method: 'POST', body: JSON.stringify({ ...v, company: v.company || undefined, locale }) });
export const cancelInvite = (b: Authed, id: string) => authed<{ ok: true }>(b, `/invitations/${id}/cancel`, { method: 'POST', body: '{}' });
export const inviteQr = (b: Authed, id: string) => authed<{ code: string; payload: string }>(b, `/invitations/${id}/qr`);
