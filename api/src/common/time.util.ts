/** Time-zone helpers with no dependencies (Intl only). All DB timestamps are UTC. */
function parts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight (start of the day containing `date`) in `timeZone`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = parts(date, timeZone);
  const naive = Date.UTC(p.y, p.m - 1, p.d);
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone); // second pass handles DST transitions
  return new Date(guess);
}

/** UTC instant of local midnight for a YYYY-MM-DD date in `timeZone`. */
export function localDateToUtc(isoDate: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return startOfLocalDay(new Date(Date.UTC(y, m - 1, d, 12)), timeZone);
}

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
