export function fmtTime(iso: string | null, locale = 'it-IT', timeZone?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}
export function fmtDateTime(iso: string | null, locale = 'it-IT', timeZone?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Local calendar date -> ISO instant at local midnight (browser time zone). */
export function dayStart(date: string) { return new Date(`${date}T00:00:00`).toISOString(); }
export function dayEnd(date: string) { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + 1); return d.toISOString(); }
