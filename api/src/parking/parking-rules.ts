/**
 * Company parking, the calendar rules. Pure functions on local dates (YYYY-MM-DD) at the site, so
 * they are tested without a database.
 *  - Managers have a fixed spot: every Monday it is booked for them, Monday to Friday of the week after.
 *  - Standard users book day by day: the days left of this week, and from Thursday also next week;
 *    at most MAX_ACTIVE bookings from today on.
 */
export type ParkingRole = 'NONE' | 'USER' | 'MANAGER';
export const PARKING_ROLES: ParkingRole[] = ['NONE', 'USER', 'MANAGER'];
export const MAX_ACTIVE = 4;
/** ISO weekday (1 = Monday) from which standard users can book the week after. */
export const OPENS_ON = 4;

/** Today at the site: local date and ISO weekday. */
export function localDay(now: Date, timeZone: string): { date: string; weekday: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1 };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Monday of the week containing `date`. */
export const mondayOf = (date: string) => addDays(date, 1 - weekdayOf(date));
/** Monday to Friday of the week starting on `monday`. */
export const workingDays = (monday: string) => [0, 1, 2, 3, 4].map((i) => addDays(monday, i));

/** Monday of the week after `now`: the week the managers' spots are booked for. */
export const nextMonday = (now: Date, timeZone: string) => addDays(mondayOf(localDay(now, timeZone).date), 7);

/** Days this person can book now (oldest first): working days from today to the end of the open window. */
export function bookableDays(now: Date, timeZone: string): string[] {
  const today = localDay(now, timeZone);
  const monday = mondayOf(today.date);
  const days = workingDays(monday).filter((d) => d >= today.date);
  // From Thursday the week after opens too (and on the weekend, only that is left).
  return today.weekday >= OPENS_ON ? [...days, ...workingDays(addDays(monday, 7))] : days;
}

/** When the week after opens for standard users, if it is not open yet. */
export function opensOn(now: Date, timeZone: string): string | null {
  const today = localDay(now, timeZone);
  return today.weekday >= OPENS_ON ? null : addDays(mondayOf(today.date), OPENS_ON - 1);
}
