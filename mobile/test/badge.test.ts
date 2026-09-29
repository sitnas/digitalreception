import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { base64ToBytes, isBadge, normaliseOrigin, qrPayload, signStep, stepAt } from '../src/lib/badge.ts';

// Same computation as api/src/access/access.service.ts qrSignature(): the reader must accept the app's QR.
const serverSignature = (secret: Buffer, id: string, step: number) => createHmac('sha256', secret).update(`${id}.${step}`).digest('hex').slice(0, 16);

test('the app signs exactly like the server', () => {
  for (let i = 0; i < 50; i++) {
    const secret = randomBytes(32), id = randomUUID(), step = 58_000_000 + i * 7919;
    assert.equal(signStep(secret.toString('base64'), id, step), serverSignature(secret, id, step));
  }
});

test('QR payload has the reader format', () => {
  const secret = randomBytes(32).toString('base64'), employeeId = randomUUID();
  assert.match(qrPayload({ employeeId, secret }, 12345), new RegExp(`^DRE1:${employeeId}\\.12345\\.[0-9a-f]{16}$`));
});

test('base64 decoding matches Node', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33]) {
    const b = randomBytes(n);
    assert.deepEqual(Buffer.from(base64ToBytes(b.toString('base64'))), b);
  }
});

test('steps change every 30 seconds', () => {
  assert.deepEqual(stepAt(59_000, 30), { step: 1, left: 1 });
  assert.deepEqual(stepAt(60_000, 30), { step: 2, left: 30 });
});

test('organisation address: https only, host kept, path dropped', () => {
  assert.equal(normaliseOrigin('acme.example.com'), 'https://acme.example.com');
  assert.equal(normaliseOrigin(' https://acme.example.com/badge?x=1 '), 'https://acme.example.com');
  assert.equal(normaliseOrigin('https://acme.example.com:8443'), 'https://acme.example.com:8443');
  assert.equal(normaliseOrigin('http://acme.example.com'), null, 'no clear text on the internet');
  assert.equal(normaliseOrigin('http://192.168.1.20:5173', true), 'http://192.168.1.20:5173', 'local development');
  assert.equal(normaliseOrigin('http://192.168.1.20:5173'), null);
  assert.equal(normaliseOrigin('javascript:alert(1)'), null);
  assert.equal(normaliseOrigin('acme'), null);
  assert.equal(normaliseOrigin(''), null);
});

test('only a well-formed activation answer is stored', () => {
  const ok = { origin: 'https://a.example.com', employeeId: randomUUID(), secret: randomBytes(32).toString('base64'), step: 30, organisation: 'Acme', firstName: 'A', lastName: 'B', primaryColor: null };
  assert.equal(isBadge(ok), true);
  assert.equal(isBadge({ ...ok, secret: 'short' }), false);
  assert.equal(isBadge({ ...ok, employeeId: 'x' }), false);
  assert.equal(isBadge(null), false);
});
