/**
 * Invitations from the "My badge" page: the same helpers as the phone app (mobile/src/lib/invites.ts).
 * Dates and times are those of the site, in its own time zone, as the server expects.
 */

export const PURPOSES = ['MEETING', 'INTERVIEW', 'SUPPLIER', 'MAINTENANCE', 'DELIVERY', 'OTHER'] as const;
export type Purpose = (typeof PURPOSES)[number];

export interface InviteSite { id: string; name: string; timezone: string }
/** Apps of the portal (servers before the portal send none: everything was on). */
export type AppKey = 'reception' | 'access' | 'parcels' | 'parking';
export interface Profile { firstName: string; lastName: string; organisation: string; canInvite: boolean; canRemove?: boolean; apps?: AppKey[]; sites: InviteSite[]; purposes: Purpose[] }
export type InviteStatus = 'PENDING' | 'USED' | 'CANCELLED' | 'EXPIRED';
export interface Invite {
  id: string; siteId: string; siteName: string; timezone: string; expectedAt: string; purpose: Purpose;
  firstName: string; lastName: string; company: string | null; email: string; status: InviteStatus; emailStatus: string;
}
export interface NewInvite { siteId: string; date: string; time: string; firstName: string; lastName: string; company: string | null; email: string; purpose: Purpose }

/** "YYYY-MM-DD" of a moment in a time zone. */
export function dateIn(ms: number, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" of a moment in a time zone. */
export function timeIn(ms: number, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

/** The next `count` days at the site, starting today, with a short label ("gio 1 ott"). */
export function dayOptions(nowMs: number, timeZone: string, locale: string, count = 14): { date: string; label: string }[] {
  const seen = new Set<string>();
  const out: { date: string; label: string }[] = [];
  // Step by 12 hours and keep distinct dates: safe across daylight-saving changes.
  for (let i = 0; out.length < count && i < count * 3; i++) {
    const ms = nowMs + i * 12 * 3_600_000;
    const date = dateIn(ms, timeZone);
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ date, label: new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms)) });
  }
  return out;
}

/** Accepts "9", "930", "9.30", "09:30" and returns "09:30", or null. */
export function normaliseTime(input: string): string | null {
  const s = input.trim().replace(/[.,h]/gi, ':');
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? '0');
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
/** Letters, spaces, apostrophes, dots and dashes: the same rule as the server. */
export const isName = (s: string) => /^[\p{L}\p{M}' .-]{1,80}$/u.test(s.trim());

/** Text the host forwards to the guest when the email did not arrive (or to anticipate it). */
export function shareText(tpl: string, v: { firstName: string; when: string; site: string; organisation: string; code: string; host: string }) {
  return tpl.replace('{firstName}', v.firstName).replace('{when}', v.when).replace('{site}', v.site)
    .replace('{organisation}', v.organisation).replace('{code}', v.code).replace('{host}', v.host);
}

/** Groups upcoming invitations by local day, in order. */
export function byDay<T extends { expectedAt: string; timezone: string }>(rows: T[]): { date: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => a.expectedAt.localeCompare(b.expectedAt))) {
    const d = dateIn(Date.parse(r.expectedAt), r.timezone);
    groups.set(d, [...(groups.get(d) ?? []), r]);
  }
  return [...groups].map(([date, rs]) => ({ date, rows: rs }));
}

/** Parking, as the app shows it: the days at a site and the person's bookings. */
export interface ParkingDay { date: string; bookable: boolean; free: number; booking: { id: string; source: 'AUTO' | 'MANUAL'; spot: string; note: string | null; site: string | null } | null }
export interface ParkingView {
  role: 'USER' | 'MANAGER'; maxActive: number | null; active: number; opensOn: string | null;
  fixedSpot: { code: string; note: string | null; site: string | null } | null;
  sites: { id: string; name: string }[]; site: { id: string; name: string } | null; days: ParkingDay[];
}
