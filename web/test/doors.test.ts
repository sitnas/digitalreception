// Doors that leave anti-passback open: what the console flags and how it names them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doorNames, formDoorUnguarded, guardedSiteIds, openDoorsFor, unguarded, type DoorLike } from '../src/lib/doors.ts';

const reader = [{ id: 'r' }];
const door = (over: Partial<DoorLike> = {}): DoorLike =>
  ({ id: 'd', siteId: 's1', name: 'Porta', active: true, direction: 'NONE', antiPassback: false, readers: reader, ...over });
const more = { one: 'e un’altra', other: 'e altre {n}' };
const plural = (f: { one: string; other: string }, n: number) => (n === 1 ? f.one : f.other).replace('{n}', String(n));

test('active doors with a reader and no direction, or entry without anti-passback, are unguarded', () => {
  assert.equal(unguarded(door({ direction: 'NONE' })), true);
  assert.equal(unguarded(door({ direction: 'IN', antiPassback: false })), true);
  assert.equal(unguarded(door({ direction: undefined })), true);
  assert.equal(unguarded(door({ direction: null })), true);
});

test('entry with anti-passback, exit, doors without readers and inactive doors are not flagged', () => {
  assert.equal(unguarded(door({ direction: 'IN', antiPassback: true })), false);
  assert.equal(unguarded(door({ direction: 'OUT' })), false);
  assert.equal(unguarded(door({ readers: [] })), false);
  assert.equal(unguarded(door({ active: false })), false);
});

test('guarded sites are the ones with an active entry door with anti-passback', () => {
  const ids = guardedSiteIds([
    door({ id: 'a', siteId: 's1', direction: 'IN', antiPassback: true }),
    door({ id: 'b', siteId: 's2', direction: 'IN', antiPassback: true, active: false }),
    door({ id: 'c', siteId: 's3', direction: 'IN', antiPassback: false }),
  ]);
  assert.deepEqual([...ids], ['s1']);
});

test('the warning lists other unguarded doors of the same site, not the one being edited', () => {
  const doors = [
    door({ id: 'self', direction: 'NONE' }),
    door({ id: 'x', name: 'Retro' }),
    door({ id: 'y', siteId: 's2', name: 'Altra sede' }),
    door({ id: 'z', direction: 'OUT', name: 'Uscita' }),
  ];
  const form = { id: 'self', siteId: 's1', direction: 'IN' as const, antiPassback: true };
  assert.deepEqual(openDoorsFor(doors, form).map((d) => d.id), ['x']);
  assert.deepEqual(openDoorsFor(doors, { ...form, id: null }).map((d) => d.id), ['self', 'x']);
});

test('no list when the door in the form is not an entry with anti-passback', () => {
  const doors = [door({ id: 'x' })];
  assert.deepEqual(openDoorsFor(doors, { id: null, siteId: 's1', direction: 'IN', antiPassback: false }), []);
  assert.deepEqual(openDoorsFor(doors, { id: null, siteId: 's1', direction: 'NONE', antiPassback: true }), []);
});

test('names: up to three, then "and one more" or "and N more"', () => {
  const list = (n: number) => ['A', 'B', 'C', 'D', 'E'].slice(0, n).map((name) => door({ id: name, name }));
  assert.equal(doorNames(list(1), more, plural), 'A');
  assert.equal(doorNames(list(3), more, plural), 'A, B, C');
  assert.equal(doorNames(list(4), more, plural), 'A, B, C e un’altra');
  assert.equal(doorNames(list(5), more, plural), 'A, B, C e altre 2');
});

test('the door being edited is flagged when it stays open next to a guarded door', () => {
  const guard = door({ id: 'g', direction: 'IN', antiPassback: true });
  const self = door({ id: 'self', direction: 'IN', antiPassback: true });
  const doors = [guard, self];
  const form = (direction: 'NONE' | 'IN' | 'OUT', antiPassback = false) => ({ id: 'self', siteId: 's1', direction, antiPassback });
  assert.equal(formDoorUnguarded(doors, form('NONE')), true);
  assert.equal(formDoorUnguarded(doors, form('IN', false)), true);
  assert.equal(formDoorUnguarded(doors, form('IN', true)), false);
  assert.equal(formDoorUnguarded(doors, form('OUT')), false);
  // New door: no readers yet, so nothing to flag.
  assert.equal(formDoorUnguarded(doors, { ...form('NONE'), id: null }), false);
  // Saved door without readers, inactive, or with no guarded door at its site.
  assert.equal(formDoorUnguarded([guard, { ...self, readers: [] }], form('NONE')), false);
  assert.equal(formDoorUnguarded([guard, { ...self, active: false }], form('NONE')), false);
  assert.equal(formDoorUnguarded([{ ...guard, siteId: 's2' }, self], form('NONE')), false);
  assert.equal(formDoorUnguarded([self], form('NONE')), false);
});
