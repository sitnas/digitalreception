// Unit tests on the compiled code (run `npm run build` first; `npm test` does it).
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
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

test('access rules: weekdays and time windows in the site time zone, also across midnight', () => {
  const { ruleAllows } = require('../dist/access/access.service.js');
  // 2026-09-24 is a Thursday (4). 08:30 UTC = 10:30 in Rome (summer time).
  const at = new Date('2026-09-24T08:30:00Z');
  assert.equal(ruleAllows({ days: null, fromTime: null, toTime: null }, at, 'Europe/Rome'), true);
  assert.equal(ruleAllows({ days: '1,2,3,4,5', fromTime: '08:00', toTime: '19:00' }, at, 'Europe/Rome'), true);
  assert.equal(ruleAllows({ days: '6,7', fromTime: null, toTime: null }, at, 'Europe/Rome'), false, 'weekend only');
  assert.equal(ruleAllows({ days: null, fromTime: '11:00', toTime: '12:00' }, at, 'Europe/Rome'), false, 'too early at the site');
  assert.equal(ruleAllows({ days: null, fromTime: '10:00', toTime: '11:00' }, at, 'Europe/Rome'), true);
  assert.equal(ruleAllows({ days: null, fromTime: '10:00', toTime: '11:00' }, at, 'America/Lima'), false, 'same instant is 03:30 in Lima');
  assert.equal(ruleAllows({ days: null, fromTime: '22:00', toTime: '06:00' }, new Date('2026-09-24T01:00:00Z'), 'Europe/Rome'), true, 'night shift at 03:00');
  assert.equal(ruleAllows({ days: null, fromTime: '22:00', toTime: '06:00' }, at, 'Europe/Rome'), false);
});

test('phone badge QR signature matches the one computed by the browser', () => {
  const { qrSignature, normaliseBadgeUid } = require('../dist/access/access.service.js');
  const secret = Buffer.alloc(32, 7);
  const sig = qrSignature(secret, 'emp-1', 123);
  assert.match(sig, /^[0-9a-f]{16}$/);
  assert.equal(sig, createHmac('sha256', secret).update('emp-1.123').digest('hex').slice(0, 16));
  assert.notEqual(qrSignature(secret, 'emp-1', 124), sig, 'changes every step');
  assert.equal(normaliseBadgeUid('04:a2-1b 9c'), '04A21B9C');
});

test('TOTP matches the RFC 6238 test vectors and refuses replays', () => {
  const { base32Encode, base32Decode, totpCode, verifyTotp, hashRecoveryCode, newRecoveryCodes } = require('../dist/common/totp.js');
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  // RFC 6238 appendix B (SHA-1), last 6 of the 8 digits.
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) {
    assert.equal(totpCode(secret, Math.floor(t / 30)), code);
  }
  const at = 1234567890_000, step = Math.floor(at / 30000);
  assert.equal(verifyTotp(secret, '005924', null, at), step);
  assert.equal(verifyTotp(secret, '005924', step, at), null, 'same step twice');
  assert.equal(verifyTotp(secret, totpCode(secret, step - 1), null, at), step - 1, 'one step of drift');
  assert.equal(verifyTotp(secret, totpCode(secret, step - 2), null, at), null);
  assert.equal(verifyTotp(secret, 'abcdef', null, at), null);
  const codes = newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].toLowerCase().replace('-', '')));
});

test('webhooks refuse addresses inside the network (SSRF) and anything but https', () => {
  const { WebhooksService, isPrivateIp } = require('../dist/common/webhooks.service.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '52.96.0.1', '2603:1026::1']) assert.equal(isPrivateIp(ip), false, ip);
  const svc = new WebhooksService({ webhooks: { allowPrivate: false } }, null, null, null);
  const code = (url) => { try { svc.checkUrl(url); return 'OK'; } catch (e) { return e.message; } };
  assert.equal(code('https://hooks.slack.com/services/T/B/x'), 'OK');
  assert.equal(code('http://hooks.slack.com/services/T/B/x'), 'WEBHOOK_URL_HTTPS');
  assert.equal(code('https://169.254.169.254/latest/meta-data'), 'WEBHOOK_URL_PRIVATE');
  assert.equal(code('https://[::1]/x'), 'WEBHOOK_URL_PRIVATE');
  assert.equal(code('https://localhost/x'), 'WEBHOOK_URL_PRIVATE');
  assert.equal(code('https://user:pw@example.com/x'), 'WEBHOOK_URL_INVALID');
  assert.equal(code('not a url'), 'WEBHOOK_URL_INVALID');
});

test('webhook messages: names only when allowed, Teams gets an Adaptive Card, generic payloads are signed', () => {
  const { WebhooksService } = require('../dist/common/webhooks.service.js');
  const svc = new WebhooksService({ webhooks: { allowPrivate: false } }, null, null, null);
  const ev = { event: 'visit.arrived', at: '2026-10-01T08:00:00.000Z', data: { site: 'Milano', locale: 'it', host: 'Mario Rossi', visitor: 'Ugo Ospite', company: 'Ospiti Srl' } };
  assert.equal(JSON.parse(svc.render({ kind: 'slack', includeNames: false }, ev, null).body).text, 'Un ospite per Mario Rossi è arrivato a Milano.');
  assert.equal(JSON.parse(svc.render({ kind: 'slack', includeNames: true }, ev, null).body).text, 'Ospite arrivato a Milano: Ugo Ospite (Ospiti Srl), per Mario Rossi.');
  const teams = JSON.parse(svc.render({ kind: 'teams', includeNames: false }, ev, null).body);
  assert.equal(teams.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  const g = svc.render({ kind: 'generic', includeNames: false }, ev, 'whsec_test');
  assert.equal(JSON.parse(g.body).data.visitor, undefined, 'no names unless allowed');
  assert.equal(g.headers['X-DR-Signature'], `sha256=${createHmac('sha256', 'whsec_test').update(`${g.headers['X-DR-Timestamp']}.${g.body}`).digest('hex')}`);
});
