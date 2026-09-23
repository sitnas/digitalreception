/** One CSV cell, quoted, with the spreadsheet formula-injection guard. */
export function csvCell(x: unknown): string {
  let s = x === null || x === undefined ? '' : x instanceof Date ? x.toISOString() : String(x);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
