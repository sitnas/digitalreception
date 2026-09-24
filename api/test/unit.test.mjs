// Unit tests on the compiled code (run `npm run build` first; `npm test` does it).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { TenantCrypto, CryptoService } = require('../dist/common/crypto.service.js');
const { csvCell } = require('../dist/admin/csv.js');

const tenant = (id) => new TenantCrypto(id, 'd1', new Map([['d1', randomBytes(32)]]), randomBytes(32));

test('personal data round-trips through encryption', () => {
  const tc = tenant('t-1');
  const enc = tc.encrypt('Mario Rossi', 'visit.lastName');
  assert.notEqual(enc, 'Mario Rossi');
  assert.equal(tc.decrypt(enc, 'visit.lastName'), 'Mario Rossi');
  assert.equal(tc.encrypt('', 'visit.lastName'), null);
});

test('same value encrypts differently every time (random IV)', () => {
  const tc = tenant('t-1');
  assert.notEqual(tc.encrypt('Rossi', 'visit.lastName'), tc.encrypt('Rossi', 'visit.lastName'));
});

test('a ciphertext cannot be moved to another column', () => {
  const tc = tenant('t-1');
  const enc = tc.encrypt('Rossi', 'visit.lastName');
  assert.throws(() => tc.decrypt(enc, 'visit.firstName'));
});

test('a ciphertext cannot be read by another tenant, even with the same key material', () => {
  const key = randomBytes(32), bik = randomBytes(32);
  const a = new TenantCrypto('tenant-a', 'd1', new Map([['d1', key]]), bik);
  const b = new TenantCrypto('tenant-b', 'd1', new Map([['d1', key]]), bik);
  assert.throws(() => b.decrypt(a.encrypt('Rossi', 'visit.lastName'), 'visit.lastName'));
});

test('blind index: accent/case/space insensitive, different per tenant and per column', () => {
  const a = tenant('a'), b = tenant('b');
  assert.equal(a.blindIndex('Nicolò  Rossi', 'visit.lastName'), a.blindIndex('nicolo rossi', 'visit.lastName'));
  assert.notEqual(a.blindIndex('Rossi', 'visit.lastName'), b.blindIndex('Rossi', 'visit.lastName'));
  assert.notEqual(a.blindIndex('Rossi', 'visit.lastName'), a.blindIndex('Rossi', 'visit.email'));
});

test('tenant keys are wrapped with the master key and bound to the tenant id', () => {
  const svc = new CryptoService({ masterKeys: { keys: new Map([['k1', randomBytes(32)]]), activeKeyId: 'k1' } });
  const key = randomBytes(32);
  const wrapped = svc.wrapKey(key, 'tenant-a', 'dek:d1');
  assert.deepEqual(svc.unwrapKey(wrapped, 'tenant-a', 'dek:d1'), key);
  assert.throws(() => svc.unwrapKey(wrapped, 'tenant-b', 'dek:d1'));
});

test('passwords: scrypt hash verifies only the right password', async () => {
  const svc = new CryptoService({ masterKeys: { keys: new Map(), activeKeyId: 'k1' } });
  const h = await svc.hashPassword('correct horse battery');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await svc.verifyPassword('correct horse battery', h), true);
  assert.equal(await svc.verifyPassword('wrong', h), false);
});

test('codes avoid ambiguous characters', () => {
  const svc = new CryptoService({ masterKeys: { keys: new Map(), activeKeyId: 'k1' } });
  for (let i = 0; i < 200; i++) assert.match(svc.randomCode(8), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
});

test('CSV cells are quoted and neutralise spreadsheet formulas', () => {
  assert.equal(csvCell('Rossi'), '"Rossi"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  for (const f of ['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx']) assert.ok(csvCell(f).startsWith(`"'`), f);
  assert.equal(csvCell(null), '""');
});

test('exit QR decodes to the visit code with the tablet prefix, as PNG and SVG', async () => {
  const { exitQrPng, exitQrSvg, EXIT_QR_PREFIX } = require('../dist/common/exit-qr.js');
  const jsQR = require('jsqr');
  const { PNG } = require('pngjs');
  const png = PNG.sync.read(await exitQrPng('AB3CD'));
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data, `${EXIT_QR_PREFIX}AB3CD`);
  assert.equal(EXIT_QR_PREFIX, 'DRX1:', 'the tablet scanner matches this prefix');
  const svg = await exitQrSvg('AB3CD');
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
  assert.doesNotMatch(svg, /<script|on\w+=/i);
});
