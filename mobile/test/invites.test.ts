import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { isBadge } from '../src/lib/badge.ts';
import { byDay, dateIn, dayOptions, isEmail, isName, normaliseTime, shareText, timeIn } from '../src/lib/invites.ts';

test('times typed in any usual way become HH:MM', () => {
  assert.equal(normaliseTime('9'), '09:00');
  assert.equal(normaliseTime('930'), '09:30');
  assert.equal(normaliseTime('9.30'), '09:30');
  assert.equal(normaliseTime(' 14:05 '), '14:05');
  assert.equal(normaliseTime('9h15'), '09:15');
  for (const bad of ['', '24:00', '12:60', 'ab', '1:2:3']) assert.equal(normaliseTime(bad), null, bad);
});

test('days are those of the site, also across a daylight-saving change', () => {
  // 25 Oct 2026, 23:30 UTC is already 26 Oct in Rome (clocks went back that night).
  const ms = Date.UTC(2026, 9, 25, 23, 30);
  assert.equal(dateIn(ms, 'Europe/Rome'), '2026-10-26');
  assert.equal(dateIn(ms, 'America/New_York'), '2026-10-25');
  assert.equal(timeIn(ms, 'Europe/Rome'), '00:30');
  const days = dayOptions(Date.UTC(2026, 9, 24, 10), 'Europe/Rome', 'it', 5);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  assert.match(days[0].label, /24/);
});

test('guest checks match the server rules', () => {
  assert.ok(isName("D'Angelo")); assert.ok(isName('José María')); assert.ok(!isName('R2D2')); assert.ok(!isName(''));
  assert.ok(isEmail('ugo@ospiti.it')); assert.ok(!isEmail('ugo@ospiti')); assert.ok(!isEmail('ugo ospiti@x.it'));
});

test('invitations are grouped by local day in time order', () => {
  const rows = [
    { id: 'b', expectedAt: '2026-10-02T08:00:00.000Z', timezone: 'Europe/Rome' },
    { id: 'a', expectedAt: '2026-10-01T15:00:00.000Z', timezone: 'Europe/Rome' },
    { id: 'c', expectedAt: '2026-10-01T22:30:00.000Z', timezone: 'Europe/Rome' }, // 00:30 on the 2nd in Rome
  ];
  assert.deepEqual(byDay(rows).map((g) => [g.date, g.rows.map((r) => r.id)]), [['2026-10-01', ['a']], ['2026-10-02', ['c', 'b']]]);
});

test('share text fills every placeholder', () => {
  const s = shareText('{firstName} {when} {organisation} {site} {code} {host}', { firstName: 'Ugo', when: 'domani', organisation: 'Acme', site: 'Milano', code: 'AB12CD34', host: 'Luisa' });
  assert.equal(s, 'Ugo domani Acme Milano AB12CD34 Luisa');
});

test('badges from before the app token still load; a malformed token is refused', () => {
  const base = { origin: 'https://acme.example.com', employeeId: '8f1c2b4e-1111-4222-8333-444455556666', secret: randomBytes(32).toString('base64'), step: 30, organisation: 'Acme', firstName: 'A', lastName: 'B', primaryColor: null };
  assert.ok(isBadge(base));
  assert.ok(isBadge({ ...base, appToken: `dra_${randomBytes(32).toString('base64url')}` }));
  assert.ok(!isBadge({ ...base, appToken: 'something-else' }));
});
