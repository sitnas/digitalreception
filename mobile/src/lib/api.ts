import type { Badge } from './badge';
import type { Invite, NewInvite, Profile } from './invites';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** Longest wait for an answer: a stuck network (captive portal, dead Wi-Fi) ends as "no connection". Tests shorten it. */
export const network = { timeoutMs: 15_000 };

async function call<R>(origin: string, path: string, init?: RequestInit): Promise<R> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), network.timeoutMs);
  let r: Response, data: any;
  try {
    // A fetch error (offline, timeout) is not an ApiError: the screens show "no connection".
    r = await fetch(`${origin}/api${path}`, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    data = await r.json().catch(() => undefined);
  } finally { clearTimeout(timer); }
  if (ctrl.signal.aborted) throw new Error('TIMEOUT');
  if (!r.ok) throw new ApiError(r.status, Array.isArray(data?.message) ? data.message[0] : data?.message ?? String(r.status));
  // A page that is not our JSON (a login wall, a captive portal, a proxy error page answering 200).
  if (data === undefined || data === null || typeof data !== 'object') throw new ApiError(r.status, 'BAD_RESPONSE');
  return data as R;
}

export interface Tenant { name: string; logo: string | null; primaryColor: string | null; secondaryColor: string | null; sso?: { provider: 'microsoft' | 'google'; enforced: boolean } | null }

/** Public branding of the organisation: also proves the address really is a digitalreception server. */
export const getTenant = (origin: string) => call<Tenant>(origin, '/tenant');

export const requestCode = (origin: string, email: string, locale: string) =>
  call<{ ok: true; step: number }>(origin, '/badge/request', { method: 'POST', body: JSON.stringify({ email, locale }) });

export const activate = (origin: string, email: string, code: string) =>
  call<Omit<Badge, 'origin' | 'primaryColor'>>(origin, '/badge/activate', { method: 'POST', body: JSON.stringify({ email, code }) });

/** Company-account activation: the one-time code from the browser + the app's verifier give the badge. */
export const ssoRedeem = (origin: string, code: string, verifier: string) =>
  call<Omit<Badge, 'origin' | 'primaryColor'>>(origin, '/auth/sso/badge/redeem', { method: 'POST', body: JSON.stringify({ code, verifier }) });

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
export const listInvites = async (b: Authed, scope: 'upcoming' | 'past' = 'upcoming') => {
  const rows = await authed<Invite[]>(b, `/invitations?scope=${scope}`);
  if (!Array.isArray(rows)) throw new ApiError(200, 'BAD_RESPONSE');
  return rows;
};
export const createInvite = (b: Authed, v: NewInvite, locale: string) =>
  authed<{ id: string; emailStatus: string }>(b, '/invitations', { method: 'POST', body: JSON.stringify({ ...v, company: v.company || undefined, locale }) });
export const cancelInvite = (b: Authed, id: string) => authed<{ ok: true }>(b, `/invitations/${id}/cancel`, { method: 'POST', body: '{}' });
export const inviteQr = (b: Authed, id: string) => authed<{ code: string; payload: string }>(b, `/invitations/${id}/qr`);

/** Parcels waiting for me at reception. */
export interface Parcel { id: string; siteName: string; timezone: string; carrier: string | null; pieces: number; receivedAt: string }
export const listParcels = async (b: Authed) => {
  const rows = await authed<Parcel[]>(b, '/parcels');
  if (!Array.isArray(rows)) throw new ApiError(200, 'BAD_RESPONSE');
  return rows;
};

// ------------------------------------------------------------------ "your guest has arrived" notices
export const pushRegister = (b: Authed, token: string, locale: string) =>
  authed<{ id: string }>(b, '/push', { method: 'POST', body: JSON.stringify({ kind: 'expo', token, locale }) });
export const pushUnregister = (b: Authed, token: string) =>
  authed<{ ok: true }>(b, '/push', { method: 'DELETE', body: JSON.stringify({ kind: 'expo', target: token }) });
/** "Remove the badge": the server revokes this phone's QR secret, app token and notices. */
export const revokeBadge = (b: Authed) => authed<{ ok: true }>(b, '/revoke', { method: 'POST', body: '{}' });
export const pushTest = (b: Authed, token: string) =>
  authed<{ result: string }>(b, '/push/test', { method: 'POST', body: JSON.stringify({ kind: 'expo', target: token }) });
