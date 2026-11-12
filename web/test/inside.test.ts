// "Inside now" and "Mark as left": search, empty states, confirm button, NOT_INSIDE, the MAN row of the door log.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARK_OUT_REASONS, canConfirm, emptyState, eventColumns, filterPeople, isNotInside } from '../src/lib/inside.ts';

const person = (name: string) => ({ employeeId: name, name, department: null, since: '2026-11-12T08:12:00.000Z', door: 'Garage' });
const people = [person('Rossi Mario'), person('Bianchi Anna'), person('Núñez Pilar'), person('Rossetti Luca')];
const names = (rows: { name: string }[]) => rows.map((p) => p.name);

test('search: part of the first or last name, any case', () => {
  assert.deepEqual(names(filterPeople(people, 'ross')), ['Rossi Mario', 'Rossetti Luca']);
  assert.deepEqual(names(filterPeople(people, 'ROSSI')), ['Rossi Mario']);
  assert.deepEqual(names(filterPeople(people, 'anna')), ['Bianchi Anna']);
  assert.deepEqual(names(filterPeople(people, 'aR')), ['Rossi Mario', 'Núñez Pilar']);
});

test('search: words in any order, accents ignored, spaces trimmed', () => {
  assert.deepEqual(names(filterPeople(people, 'mario rossi')), ['Rossi Mario']);
  assert.deepEqual(names(filterPeople(people, '  luca   ross ')), ['Rossetti Luca']);
  assert.deepEqual(names(filterPeople(people, 'nunez')), ['Núñez Pilar']);
  assert.deepEqual(names(filterPeople(people, 'NÚÑEZ')), ['Núñez Pilar']);
});

test('search: empty shows everyone, no match shows nobody, the list itself is untouched', () => {
  assert.deepEqual(names(filterPeople(people, '')), names(people));
  assert.deepEqual(names(filterPeople(people, '   ')), names(people));
  assert.deepEqual(filterPeople(people, 'zzz'), []);
  assert.equal(people.length, 4);
});

test('search matches the name only, not the department or the door', () => {
  const rows = [{ ...person('Verdi Carla'), department: 'Garage', door: 'Garage' }];
  assert.deepEqual(filterPeople(rows, 'garage'), []);
});

test('empty state: nobody inside differs from nothing matching the search', () => {
  assert.equal(emptyState(null, 0), null);
  assert.equal(emptyState(0, 0), 'none');
  assert.equal(emptyState(4, 0), 'noMatch');
  assert.equal(emptyState(4, 2), null);
  assert.equal(emptyState(4, 4), null);
});

test('confirm stays off until a reason from the list is chosen, and while the request runs', () => {
  assert.equal(canConfirm(null, false), false);
  assert.equal(canConfirm(undefined, false), false);
  assert.equal(canConfirm('', false), false);
  assert.equal(canConfirm('FREE_TEXT', false), false);
  for (const r of MARK_OUT_REASONS) {
    assert.equal(canConfirm(r, false), true, r);
    assert.equal(canConfirm(r, true), false, r);
  }
});

test('the four reasons are the codes of the API contract', () => {
  assert.deepEqual([...MARK_OUT_REASONS], ['NO_BADGE_EXIT', 'NO_READER_EXIT', 'EXIT_DENIED', 'OTHER']);
});

test('NOT_INSIDE is recognised only as a 409 with that code', () => {
  assert.equal(isNotInside({ status: 409, code: 'NOT_INSIDE' }), true);
  assert.equal(isNotInside({ status: 404, code: 'EMPLOYEE_NOT_FOUND' }), false);
  assert.equal(isNotInside({ status: 409, code: 'EVACUATION_RUNNING' }), false);
  assert.equal(isNotInside({ status: 403, code: 'APP_DISABLED' }), false);
  assert.equal(isNotInside(null), false);
  assert.equal(isNotInside(new Error('network')), false);
});

test('door log: a MAN row names the console mark-out, never a door, a phone or a card', () => {
  const L = { phone: 'Telefono', card: 'Tessera', manual: 'A mano', markedOut: 'Segnato come uscito da console' };
  assert.deepEqual(eventColumns({ method: 'MAN', door: null }, L), { door: 'Segnato come uscito da console', method: 'A mano' });
  // Even if a door name ever came with it, the MAN row does not show it.
  assert.deepEqual(eventColumns({ method: 'MAN', door: 'Ingresso' }, L), { door: 'Segnato come uscito da console', method: 'A mano' });
  assert.deepEqual(eventColumns({ method: 'QR', door: 'Ingresso' }, L), { door: 'Ingresso', method: 'Telefono' });
  assert.deepEqual(eventColumns({ method: 'NFC', door: 'Garage' }, L), { door: 'Garage', method: 'Tessera' });
  // A deleted door: the API sends '—'; a null outside MAN still shows a dash rather than nothing.
  assert.deepEqual(eventColumns({ method: 'NFC', door: null }, L), { door: '—', method: 'Tessera' });
});
