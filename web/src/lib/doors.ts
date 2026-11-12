// Which doors leave anti-passback open at a site. Pure functions, so the console and the tests share them.
export type DoorDirection = 'NONE' | 'IN' | 'OUT';

export interface DoorLike {
  id: string;
  siteId: string;
  name: string;
  active: boolean;
  direction?: DoorDirection | null;
  antiPassback?: boolean | null;
  readers: readonly unknown[];
}

export interface DoorRules { id: string | null; siteId: string; direction: DoorDirection; antiPassback: boolean }

type PluralForms = { one: string; other: string };

/** Active entry door that refuses anyone already inside. */
export const guarded = (d: DoorLike) => d.active && d.direction === 'IN' && !!d.antiPassback;

/** Active door with a reader that lets a passed-on badge or QR in: no direction, or entry without anti-passback. */
export const unguarded = (d: DoorLike) =>
  d.active && d.readers.length > 0 && ((d.direction ?? 'NONE') === 'NONE' || (d.direction === 'IN' && !d.antiPassback));

/** Sites with at least one guarded door: only there an unguarded door is worth flagging. */
export const guardedSiteIds = (doors: readonly DoorLike[]) => new Set(doors.filter(guarded).map((d) => d.siteId));

/** Other unguarded doors at the site of the form, shown when the form sets an entry door with anti-passback. */
export function openDoorsFor<T extends DoorLike>(doors: readonly T[], form: DoorRules): T[] {
  if (form.direction !== 'IN' || !form.antiPassback) return [];
  return doors.filter((d) => d.id !== form.id && d.siteId === form.siteId && unguarded(d));
}

/** True when the saved door in the form, with the rules being edited, stays unguarded while another door of its site is guarded. */
export function formDoorUnguarded(doors: readonly DoorLike[], form: DoorRules): boolean {
  const saved = form.id ? doors.find((d) => d.id === form.id) : undefined;
  if (!saved) return false;
  const edited = { ...saved, direction: form.direction, antiPassback: form.direction === 'IN' && form.antiPassback };
  return unguarded(edited) && doors.some((d) => d.id !== saved.id && d.siteId === saved.siteId && guarded(d));
}

/** "A, B, C" or "A, B, C and N more": at most three names. */
export function doorNames(doors: readonly DoorLike[], more: PluralForms, plural: (forms: PluralForms, n: number) => string): string {
  const names = doors.slice(0, 3).map((d) => d.name).join(', ');
  return doors.length > 3 ? `${names} ${plural(more, doors.length - 3)}` : names;
}
