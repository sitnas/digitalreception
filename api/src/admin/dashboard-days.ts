/** Calendar arithmetic of the dashboard, in the sites' own time zones (pure: unit-tested). */
export const DAY_MS = 86_400_000;

/** Calendar day (YYYY-MM-DD) of an instant in a time zone. */
const dayFmt = new Map<string, Intl.DateTimeFormat>();
export function localDay(d: Date, tz: string) {
  let f = dayFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); dayFmt.set(tz, f); }
  return f.format(d);
}
export const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Whole days from `b` to `a` (both YYYY-MM-DD): 0 the same day, -1 the day before. */
export const between = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS);
/** The instant a local calendar day starts in a time zone (daylight saving included). */
export function midnight(day: string, tz: string): Date {
  let t = Date.parse(`${day}T00:00:00Z`);
  // Two corrections are enough: the offset only changes by an hour around a switch.
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const seen = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    t -= seen - Date.parse(`${day}T00:00:00Z`);
  }
  return new Date(t);
}
