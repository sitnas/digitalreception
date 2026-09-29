/**
 * Intl formatters are costly to build (locale data, lookup tables) and these helpers run for every
 * row of a table: each distinct locale / options / time-zone combination is built once and reused.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, options); formatters.set(key, f); }
  return f;
}
const numberFormatters = new Map<string, Intl.NumberFormat>();
export function numberFormat(locale: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = numberFormatters.get(key);
  if (!f) { f = new Intl.NumberFormat(locale, options); numberFormatters.set(key, f); }
  return f;
}

export function fmtTime(iso: string | null, locale = 'it-IT', timeZone?: string) {
  if (!iso) return '—';
  return dateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}
export function fmtDateTime(iso: string | null, locale = 'it-IT', timeZone?: string) {
  if (!iso) return '—';
  return dateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Local calendar date -> ISO instant at local midnight (browser time zone). */
export function dayStart(date: string) { return new Date(`${date}T00:00:00`).toISOString(); }
export function dayEnd(date: string) { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + 1); return d.toISOString(); }
