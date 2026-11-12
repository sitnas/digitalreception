// "Inside now" and "Mark as left": the console logic, kept pure so the page and the tests share it.

/** One row of GET /admin/access/inside. */
export interface InsidePerson { employeeId: string; name: string; department: string | null; since: string; door: string }
export interface InsideList { timezone: string; people: InsidePerson[] }

/** The closed list of reasons the API accepts for a mark-out (POST /admin/access/employees/:id/mark-out). */
export const MARK_OUT_REASONS = ['NO_BADGE_EXIT', 'NO_READER_EXIT', 'EXIT_DENIED', 'OTHER'] as const;
export type MarkOutReason = (typeof MARK_OUT_REASONS)[number];

/** Lower case, without accents: "Núñez" matches "nunez". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/**
 * The rows whose name contains the search, ignoring case and accents. Every word of the search has to
 * appear, in any order, so "mario rossi" finds "Rossi Mario". Filters the list already loaded: nothing
 * goes to the server.
 */
export function filterPeople<T extends Pick<InsidePerson, 'name'>>(people: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...people];
  return people.filter((p) => { const name = fold(p.name); return words.every((w) => name.includes(w)); });
}

/** Which message stands in for the table: nobody inside at all, nobody matching the search, or none (show the rows). */
export type InsideEmpty = 'none' | 'noMatch' | null;
export function emptyState(loaded: number | null, shown: number): InsideEmpty {
  if (loaded === null) return null; // still loading
  if (loaded === 0) return 'none';
  return shown === 0 ? 'noMatch' : null;
}

/** The confirm button of the dialog works only with a reason from the list and no request in flight. */
export function canConfirm(reason: string | null | undefined, busy: boolean): boolean {
  return !busy && !!reason && (MARK_OUT_REASONS as readonly string[]).includes(reason);
}

/** 409 NOT_INSIDE: the person had already left (a reader, or someone else at the console). */
export function isNotInside(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null;
  return !!e && e.status === 409 && e.code === 'NOT_INSIDE';
}

/** One row of GET /admin/access/events, as far as the door and method columns go. */
export type EventMethod = 'QR' | 'NFC' | 'MAN';
export interface EventLike { method: EventMethod; door: string | null }
export interface EventLabels { phone: string; card: string; manual: string; markedOut: string }

/**
 * Door and method columns of the door log. A MAN row is the mark-out done from the console: no door and
 * no credential, so it says so instead of naming a door, a phone or a card.
 */
export function eventColumns(e: EventLike, L: EventLabels): { door: string; method: string } {
  if (e.method === 'MAN') return { door: L.markedOut, method: L.manual };
  return { door: e.door ?? '—', method: e.method === 'QR' ? L.phone : L.card };
}
