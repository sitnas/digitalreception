// End-to-end tests: a real API process against a real MySQL/MariaDB database.
// Needs E2E_DB_HOST (plus optional E2E_DB_PORT, E2E_DB_NAME, E2E_DB_USER, E2E_DB_PASSWORD); skipped otherwise.
// Each run creates its own tenant (unique slug) and deletes it at the end, so it can run on a shared dev DB.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { startFakeIdp } from './fake-idp.mjs';

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const enabled = !!process.env.E2E_DB_HOST;
const PORT = Number(process.env.E2E_PORT ?? 3199);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SLUG = `e2e-${randomBytes(3).toString('hex')}`;
const IDP_PORT = PORT - 1;
const SSO_CLIENT = { clientId: 'e2e-client', clientSecret: randomBytes(16).toString('hex') };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const env = {
  ...process.env,
  NODE_ENV: 'development', PORT: String(PORT), TENANCY_MODE: 'single', DEFAULT_TENANT_SLUG: SLUG,
  MASTER_KEYS: `k1:${randomBytes(32).toString('base64')}`, JWT_SECRET: randomBytes(48).toString('base64'),
  DB_TYPE: 'mysql', DB_HOST: process.env.E2E_DB_HOST, DB_PORT: process.env.E2E_DB_PORT ?? '3306',
  DB_NAME: process.env.E2E_DB_NAME ?? 'reception', DB_USER: process.env.E2E_DB_USER ?? 'reception', DB_PASSWORD: process.env.E2E_DB_PASSWORD ?? 'reception',
  STORAGE_DRIVER: 'local', FILES_DIR: mkdtempSync(join(tmpdir(), 'e2e-files-')), COOKIE_SECURE: 'false', TRUST_PROXY: '1',
  SMTP_HOST: '', JOBS_ENABLED: 'false',
  SSO_REDIRECT_URI: `http://127.0.0.1:${PORT}/api/auth/sso/callback`,
  SSO_MICROSOFT_CLIENT_ID: SSO_CLIENT.clientId, SSO_MICROSOFT_CLIENT_SECRET: SSO_CLIENT.clientSecret, SSO_MICROSOFT_ISSUER: `http://127.0.0.1:${IDP_PORT}/ms`,
  SSO_GOOGLE_CLIENT_ID: SSO_CLIENT.clientId, SSO_GOOGLE_CLIENT_SECRET: SSO_CLIENT.clientSecret, SSO_GOOGLE_ISSUER: `http://127.0.0.1:${IDP_PORT}/google`,
};

/** One browser for the single sign-on round trip: follows nothing, keeps every cookie. */
class Browser {
  jar = new Map();
  constructor(ip, cookies = {}) { this.ip = ip; for (const [k, v] of Object.entries(cookies)) this.jar.set(k, v); }
  async go(url) {
    const headers = { 'X-Forwarded-For': this.ip };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(url.startsWith('http') ? url : BASE + url, { headers, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';'); const [k, v] = kv.split('=');
      if (!v || attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()))) this.jar.delete(k.trim()); else this.jar.set(k.trim(), v);
    }
    return { status: r.status, location: r.headers.get('location') ?? '', body: await r.text() };
  }
}

/** Minimal client: keeps the session cookie and sends the CSRF header like the console does. */
class Client {
  cookie = '';
  /** `ip` (sent as X-Forwarded-For) gives a test its own rate-limit bucket for the sign-in endpoints. */
  constructor(ip) { this.ip = ip; }
  async req(method, path, body, { bearer, csrf = true } = {}) {
    const headers = {};
    if (this.ip) headers['X-Forwarded-For'] = this.ip;
    if (csrf && !bearer) headers['X-Requested-With'] = 'reception-admin';
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b, o) { return this.req('POST', p, b ?? {}, o); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p, b) { return this.req('DELETE', p, b ?? {}); }
  async signIn(email, password, newPassword) {
    this.cookie = '';
    await this.post('/auth/login', { email, password });
    if (newPassword) { await this.post('/auth/password', { currentPassword: password, newPassword }); this.cookie = ''; await this.post('/auth/login', { email, password: newPassword }); }
  }
}

describe('end-to-end', { skip: !enabled && 'E2E_DB_HOST not set' }, () => {
  let api, adminPassword;
  const admin = new Client();
  const ctx = {};

  const idp = startFakeIdp(IDP_PORT, SSO_CLIENT);

  before(async () => {
    await idp.listen();
    const out = await run('node', ['dist/cli/tenants.js', 'create', '--slug', SLUG, '--name', 'E2E S.p.A.', '--countries', 'IT', '--admin-email', 'admin@e2e.test'], { env });
    adminPassword = /Temporary password[^:]*: (\S+)/.exec(out.stdout)[1];
    api = spawn('node', ['dist/main.js'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    await admin.signIn('admin@e2e.test', adminPassword, 'Admin-Password-E2E!');
  });

  after(async () => {
    api?.kill();
    await idp.close();
    await run('node', ['dist/cli/tenants.js', 'delete', '--slug', SLUG, '--confirm', SLUG], { env }).catch(() => {});
  });

  test('first sign-in forces a password change; the new password works', async () => {
    const c = new Client();
    assert.equal((await c.post('/auth/login', { email: 'admin@e2e.test', password: adminPassword })).status, 401);
    assert.equal((await admin.get('/auth/me')).data.mustChangePassword, false);
  });

  test('organisation reports email delivery; the test email explains why it fails', async () => {
    const org = (await admin.get('/admin/organisation')).data;
    assert.deepEqual(org.email, { enabled: false, from: null });
    const r = await admin.post('/admin/organisation/test-email');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, false);
    assert.match(r.data.error, /SMTP_HOST/);
  });

  test('setup: sites, hosts, users, document policy', async () => {
    ctx.milano = (await admin.post('/admin/sites', { code: 'MI', name: 'Milano', countryCode: 'IT', timezone: 'Europe/Rome' })).data;
    ctx.roma = (await admin.post('/admin/sites', { code: 'RM', name: 'Roma', countryCode: 'IT', timezone: 'Europe/Rome' })).data;
    ctx.mario = (await admin.post('/admin/hosts', { firstName: 'Mario', lastName: 'Rossi', department: 'Acquisti', email: 'mario@e2e.test', phone: '+39 02 1', siteIds: [ctx.milano.id] })).data;
    ctx.anna = (await admin.post('/admin/hosts', { firstName: 'Anna', lastName: 'Bianchi', siteIds: [ctx.roma.id] })).data;
    assert.ok(ctx.milano.id && ctx.roma.id && ctx.mario.id && ctx.anna.id);
    const tmp = 'Temporary-Pass-000';
    await admin.post('/admin/users', { email: 'rec@e2e.test', displayName: 'Rec Roma', role: 'RECEPTIONIST', siteIds: [ctx.roma.id], temporaryPassword: tmp });
    await admin.post('/admin/users', { email: 'aud@e2e.test', displayName: 'Auditor', role: 'AUDITOR', siteIds: [], temporaryPassword: tmp });
    ctx.rec = new Client(); await ctx.rec.signIn('rec@e2e.test', tmp, 'Rec-Password-E2E!');
    ctx.aud = new Client(); await ctx.aud.signIn('aud@e2e.test', tmp, 'Aud-Password-E2E!');
  });

  test('privacy rules: partial update keeps other fields; asking for the document forces its photo', async () => {
    const r = await admin.patch('/admin/policies/IT', { documentDataEnabled: true, documentPhotoEnabled: false });
    assert.equal(r.status, 200);
    assert.equal(r.data.documentDataEnabled, true);
    assert.equal(r.data.documentPhotoEnabled, true);
    assert.ok(Array.isArray(r.data.locales) && r.data.locales.length > 0);
    const withUnknown = await admin.patch('/admin/policies/IT', { ...r.data });
    assert.equal(withUnknown.status, 400, 'unknown fields (id, tenantId...) are rejected');
  });

  test('tablet: pairing and config expose hosts without contact details', async () => {
    const { code } = (await admin.post('/admin/devices/pairing-code', { siteId: ctx.milano.id, name: 'Tablet E2E' })).data;
    ctx.token = (await new Client().post('/kiosk/pair', { code })).data.deviceToken;
    const cfg = (await new Client().get('/kiosk/config', { bearer: ctx.token })).data;
    ctx.notice = cfg.notices.it.id;
    assert.deepEqual(cfg.hosts.map((h) => h.lastName), ['Rossi']);
    assert.ok(!('email' in cfg.hosts[0]) && !('phone' in cfg.hosts[0]));
    assert.equal(cfg.policy.documentPhotoEnabled, true);
  });

  const checkIn = (over) => new Client().post('/kiosk/visits', {
    locale: 'it', firstName: 'Luca', lastName: 'Verdi', company: 'ACME', sendNoticeEmail: false, purpose: 'MEETING',
    hostId: ctx.mario.id, travelDistance: 'UNDER_10_KM', documentType: 'ID_CARD', documentNumber: 'CA12345XY',
    documentPhoto: PNG, privacyNoticeId: ctx.notice, privacyAccepted: true, signature: PNG, ...over,
  }, { bearer: ctx.token });

  test('check-in validates distance, host of the site and document photo', async () => {
    assert.equal((await checkIn({ travelDistance: undefined })).status, 400);
    const other = await checkIn({ hostId: ctx.anna.id });
    assert.equal(other.status, 400); assert.equal(other.data.message, 'HOST_NOT_FOUND');
    assert.equal((await checkIn({ documentPhoto: undefined })).status, 400);
    const ok = await checkIn({});
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.match(ok.data.code, /^[A-Z0-9]{5}$/);
    assert.match(ok.data.qrSvg, /^<svg/, 'exit QR for the badge on screen');
    assert.equal(ok.data.hostNotified, false, 'no SMTP configured in tests');
    ctx.visit = (await admin.get(`/admin/visits?siteId=${ctx.milano.id}`)).data.items[0];
    const detail = (await admin.get(`/admin/visits/${ctx.visit.id}`)).data;
    assert.equal(detail.host, 'Mario Rossi');
    assert.equal(detail.travelDistance, 'UNDER_10_KM');
    assert.equal(detail.hostEmailStatus, 'SKIPPED');
  });

  test('check-out lookup never dumps the present list', async () => {
    for (const lastName of ['Tessari', 'Testa', 'Tesei', 'Tesini', 'Tesoro', 'Tesauro']) assert.equal((await checkIn({ firstName: 'Ospite', lastName })).status, 201);
    const k = new Client();
    assert.equal((await k.get('/kiosk/visits/open?q=te', { bearer: ctx.token })).status, 400, 'two letters are too few');
    assert.deepEqual((await k.get('/kiosk/visits/open?q=tes', { bearer: ctx.token })).data, [], 'a broad prefix reveals nobody');
    const one = (await k.get('/kiosk/visits/open?q=tessari', { bearer: ctx.token })).data;
    assert.equal(one.length, 1); assert.equal(one[0].label, 'Tessari O.');
  });

  test('roles: receptionist limited to own sites, auditor read-only on every site', async () => {
    assert.equal((await ctx.rec.get(`/admin/visits?siteId=${ctx.milano.id}`)).status, 403);
    assert.equal((await ctx.rec.get(`/admin/visits/${ctx.visit.id}`)).status, 403);
    assert.equal((await ctx.rec.get('/admin/stats?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z')).status, 403);
    const d = await ctx.aud.get(`/admin/visits/${ctx.visit.id}`);
    assert.equal(d.status, 200); assert.equal(d.data.documentNumber, 'CA12345XY');
    assert.equal((await ctx.aud.post(`/admin/visits/${ctx.visit.id}/checkout`)).status, 403);
    assert.equal((await ctx.aud.del(`/admin/visits/${ctx.visit.id}`, { reason: 'OTHER' })).status, 403);
    assert.equal((await ctx.aud.get('/admin/audit/export.csv')).status, 200);
    assert.equal((await new Client().get('/admin/visits')).status, 401);
  });

  test('state changes without the CSRF header are refused', async () => {
    assert.equal((await admin.req('POST', `/admin/visits/${ctx.visit.id}/checkout`, {}, { csrf: false })).status, 403);
  });

  test('statistics aggregate visits without personal data', async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString(), to = new Date(Date.now() + 86_400_000).toISOString();
    const s = (await admin.get(`/admin/stats?from=${from}&to=${to}`)).data;
    assert.equal(s.total, 7);
    assert.equal(s.byPurpose.MEETING, 7);
    assert.equal(s.byDistance.UNDER_10_KM, 7);
    assert.equal(JSON.stringify(s).includes('Verdi'), false);
    assert.equal((await admin.get('/admin/stats?from=2020-01-01T00:00:00Z&to=2022-01-01T00:00:00Z')).status, 400, 'range capped');
  });

  test('invitations: staff invite, the tablet reads the QR code once, on the right day and site', async () => {
    // Day and time at the site (Europe/Rome), as the console sends them.
    const at = (ms) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + ms)).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
    };
    const base = { siteId: ctx.milano.id, hostId: ctx.mario.id, firstName: 'Irene', lastName: 'Galli', company: 'Galli Srl', email: 'irene@e2e.test', purpose: 'MEETING' };
    const created = await admin.post('/admin/invitations', { ...base, ...at(0) });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.emailStatus, 'SKIPPED', 'no SMTP in tests');
    assert.equal((await admin.post('/admin/invitations', { ...base, ...at(-3 * 86_400_000) })).data.message, 'INVITATION_IN_PAST');
    assert.equal((await admin.post('/admin/invitations', { ...base, hostId: ctx.anna.id, ...at(0) })).data.message, 'HOST_NOT_FOUND');
    assert.equal((await ctx.rec.post('/admin/invitations', { ...base, ...at(0) })).status, 403, 'receptionist of another site');
    assert.equal((await ctx.aud.post('/admin/invitations', { ...base, ...at(0) })).status, 403, 'auditor is read-only');

    const list = (await ctx.aud.get('/admin/invitations')).data;
    const row = list.find((r) => r.id === created.data.id);
    assert.ok(Math.abs(new Date(row.expectedAt).getTime() - Date.now()) < 120_000, 'the time is read in the site time zone');
    assert.equal(row.lastName, 'Galli'); assert.equal(row.hostName, 'Mario Rossi'); assert.equal(row.status, 'PENDING');

    const { code, qrSvg } = (await admin.get(`/admin/invitations/${created.data.id}/qr`)).data;
    assert.match(code, /^[A-Z0-9]{8}$/); assert.match(qrSvg, /^<svg/);
    const kiosk = (c) => new Client().get(`/kiosk/invitations/${c}`, { bearer: ctx.token });
    assert.equal((await kiosk('ZZZZZZZZ')).status, 404);
    const pre = (await kiosk(code.toLowerCase())).data;
    assert.equal(pre.firstName, 'Irene'); assert.equal(pre.hostId, ctx.mario.id); assert.equal(pre.email, 'irene@e2e.test');

    const visit = await checkIn({ firstName: 'Irene', lastName: 'Galli', invitationCode: code });
    assert.equal(visit.status, 201, JSON.stringify(visit.data));
    assert.equal((await checkIn({ firstName: 'Irene', lastName: 'Galli', invitationCode: code })).data.message, 'INVITATION_USED');
    assert.equal((await kiosk(code)).data.message, 'INVITATION_USED');
    assert.equal((await admin.get('/admin/invitations')).data.find((r) => r.id === created.data.id).status, 'USED');

    const later = await admin.post('/admin/invitations', { ...base, ...at(2 * 86_400_000) });
    const laterCode = (await admin.get(`/admin/invitations/${later.data.id}/qr`)).data.code;
    assert.equal((await kiosk(laterCode)).data.message, 'INVITATION_NOT_TODAY');
    assert.equal((await admin.post(`/admin/invitations/${later.data.id}/cancel`)).status, 200);
    assert.equal((await kiosk(laterCode)).status, 404, 'cancelled invitations are unknown to the tablet');
  });

  test('employee access: integration API, reader pairing, NFC badge, rotating QR, schedules and log', async () => {
    const { createHmac, createHash } = await import('node:crypto');
    const api = (method, path, body, key) => fetch(`${BASE}/integration/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

    const { key } = (await admin.post('/admin/access/api-keys', { name: 'HR system' })).data;
    assert.match(key, /^drk_/);
    assert.equal((await ctx.aud.post('/admin/access/api-keys', { name: 'x' })).status, 403, 'only the super admin creates keys');
    assert.equal((await api('PUT', '/doors/X', { siteCode: 'MI', name: 'X' })).status, 401);
    assert.equal((await api('PUT', '/doors/X', { siteCode: 'MI', name: 'X' }, 'drk_' + 'x'.repeat(43))).status, 401);

    const main = (await admin.post('/admin/access/doors', { siteId: ctx.milano.id, name: 'Ingresso principale', externalId: 'MI-MAIN' })).data;
    assert.equal((await api('PUT', '/doors/MI-LAB', { siteCode: 'MI', name: 'Laboratorio' }, key)).data.created, true);
    const lab = (await admin.get('/admin/access/doors')).data.find((d) => d.externalId === 'MI-LAB');

    const romeDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' }).format(new Date())) + 1;
    const person = { firstName: 'Paolo', lastName: 'Bruni', email: 'paolo@e2e.test', badgeUid: '04:A2:1B:9C', permissions: [{ door: 'MI-MAIN' }, { door: 'MI-LAB', days: [(romeDay % 7) + 1], from: '00:00', to: '23:59' }] };
    assert.equal((await api('PUT', '/employees/E001', { ...person, permissions: [{ door: 'NOPE' }] }, key)).data.message, 'UNKNOWN_DOOR');
    assert.equal((await api('PUT', '/employees/E001', person, key)).data.created, true);
    assert.equal((await api('PUT', '/employees/E001', person, key)).data.created, false, 'PUT is idempotent');
    const clash = await api('PUT', '/employees/E002', { ...person, email: null, badgeUid: '04a21b9c' }, key);
    assert.equal(clash.status, 409); assert.equal(clash.data.message, 'BADGE_IN_USE');

    const pairReader = async (door) => {
      const { code } = (await admin.post(`/admin/access/doors/${door.id}/reader-code`, { name: `Lettore ${door.name}` })).data;
      assert.equal((await new Client().post('/kiosk/pair', { code })).status, 401, 'a reader code does not enrol a reception tablet');
      return (await new Client().post('/reader/pair', { code })).data.readerToken;
    };
    const mainReader = await pairReader(main), labReader = await pairReader(lab);
    const verify = (token, body) => new Client().post('/reader/verify', body, { bearer: token }).then((r) => r.data);

    let v = await verify(mainReader, { nfc: '04a21b9c' });
    assert.equal(v.result, 'GRANTED'); assert.equal(v.name, 'Paolo B.');
    assert.equal((await verify(mainReader, { nfc: 'DEADBEEF' })).reason, 'UNKNOWN_CREDENTIAL');
    assert.equal((await verify(labReader, { nfc: '04A21B9C' })).reason, 'OUTSIDE_SCHEDULE', 'the lab is allowed on another weekday only');

    // Phone badge: the activation code normally arrives by email (no SMTP in tests), so set a known one.
    const mysql = require('mysql2/promise');
    const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
    const emp = (await admin.get('/admin/access/employees')).data.find((e) => e.externalId === 'E001');
    assert.equal(emp.badgeHint, '1B9C'); assert.equal(emp.phoneBadge, false); assert.equal(emp.permissions.length, 2);
    assert.equal((await new Client().post('/badge/request', { email: 'nobody@e2e.test' })).data.ok, true, 'same answer for unknown addresses');
    await db.query('UPDATE employees SET loginCodeHash = ?, loginCodeExpiresAt = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE), loginCodeAttempts = 0 WHERE id = ?', [createHash('sha256').update(`${emp.id}|123456`).digest('hex'), emp.id]);
    assert.equal((await new Client().post('/badge/activate', { email: 'paolo@e2e.test', code: '000000' })).data.message, 'CODE_INVALID');
    const badge = (await new Client().post('/badge/activate', { email: 'PAOLO@e2e.test', code: '123456' })).data;
    assert.equal(badge.firstName, 'Paolo'); assert.equal(badge.step, 30);
    assert.equal((await new Client().post('/badge/activate', { email: 'paolo@e2e.test', code: '123456' })).data.message, 'CODE_INVALID', 'one use only');
    // Five wrong guesses use up the budget: even the right code is refused afterwards.
    await db.query('UPDATE employees SET loginCodeHash = ?, loginCodeExpiresAt = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE), loginCodeAttempts = 0 WHERE id = ?', [createHash('sha256').update(`${emp.id}|654321`).digest('hex'), emp.id]);
    const guesses = await Promise.all(Array.from({ length: 5 }, (_, i) => new Client().post('/badge/activate', { email: 'paolo@e2e.test', code: String(100000 + i) })));
    assert.ok(guesses.every((g) => g.data.message === 'CODE_INVALID'));
    assert.equal((await new Client().post('/badge/activate', { email: 'paolo@e2e.test', code: '654321' })).data.message, 'CODE_INVALID', 'attempt budget used up');
    const qr = (stepOffset = 0, secret = badge.secret) => {
      const step = Math.floor(Date.now() / 1000 / 30) + stepOffset;
      return `DRE1:${badge.employeeId}.${step}.${createHmac('sha256', Buffer.from(secret, 'base64')).update(`${badge.employeeId}.${step}`).digest('hex').slice(0, 16)}`;
    };
    assert.equal((await verify(mainReader, { qr: qr() })).result, 'GRANTED');
    assert.equal((await verify(mainReader, { qr: qr(-5) })).reason, 'QR_EXPIRED', 'a screenshot stops working');
    const forged = await verify(mainReader, { qr: qr(0, Buffer.alloc(32).toString('base64')) });
    assert.equal(forged.reason, 'QR_INVALID', 'forged signature');
    assert.equal(forged.name, null, 'a forged QR does not show the name of the employee it names');
    assert.equal((await verify(mainReader, { qr: 'hello' })).reason, 'QR_INVALID');

    assert.equal((await api('PUT', '/employees/E001', { ...person, active: false }, key)).status, 200);
    assert.equal((await verify(mainReader, { nfc: '04A21B9C' })).reason, 'EMPLOYEE_INACTIVE');
    await api('PUT', '/employees/E001', person, key);
    // A site manager of Rome cannot act on an employee who only opens doors in Milan.
    await admin.post('/admin/users', { email: 'smroma@e2e.test', displayName: 'SM Roma', role: 'SITE_MANAGER', siteIds: [ctx.roma.id], temporaryPassword: 'Temporary-Pass-333' });
    const smRoma = new Client('10.9.0.2');
    await smRoma.signIn('smroma@e2e.test', 'Temporary-Pass-333', 'Sm-Roma-Password-1');
    assert.equal((await smRoma.post(`/admin/access/employees/${emp.id}/revoke-phone`)).status, 404, 'other sites are out of reach');
    assert.equal((await admin.post(`/admin/access/employees/${emp.id}/revoke-phone`)).status, 200);
    assert.equal((await verify(mainReader, { qr: qr() })).reason, 'UNKNOWN_CREDENTIAL', 'revoked phone badge');

    const from = new Date(Date.now() - 3_600_000).toISOString(), to = new Date(Date.now() + 60_000).toISOString();
    const log = (await ctx.aud.get(`/admin/access/events?from=${from}&to=${to}`)).data;
    assert.ok(log.filter((e) => e.reason === 'QR_INVALID').every((e) => e.employee === null), 'invalid QR codes are not logged against anyone');
    assert.ok(log.length >= 9 && log.some((e) => e.employee === 'Bruni Paolo' && e.result === 'GRANTED'));
    assert.equal((await ctx.rec.get(`/admin/access/events?from=${from}&to=${to}`)).status, 403, 'receptionists do not see the access log');
    // Inbound only: the integration API never returns stored data.
    for (const path of ['/doors', '/employees', `/events?since=${from}`]) assert.equal((await api('GET', path, undefined, key)).status, 404, path);

    assert.equal((await api('DELETE', '/employees/E001', undefined, key)).status, 200);
    const [[orphan]] = await db.query('SELECT COUNT(*) AS n FROM access_events WHERE employeeId = ?', [emp.id]);
    await db.end();
    assert.equal(Number(orphan.n), 0, 'deleting the employee unlinks the log');
    assert.equal((await verify(mainReader, { nfc: '04A21B9C' })).reason, 'UNKNOWN_CREDENTIAL');
  });

  test('two-step verification: enrolment, login with code or recovery code, no replay, organisation policy, reset', async () => {
    const { totpCode, totpStep } = require('../dist/common/totp.js');
    const MFA_IP = '10.9.0.1';
    await admin.post('/admin/users', { email: 'mfa@e2e.test', displayName: 'Mfa User', role: 'AUDITOR', siteIds: [], temporaryPassword: 'Temporary-Pass-111' });
    await admin.post('/admin/users', { email: 'nomfa@e2e.test', displayName: 'No Mfa', role: 'AUDITOR', siteIds: [], temporaryPassword: 'Temporary-Pass-222' });
    const u = new Client(MFA_IP);
    await u.signIn('mfa@e2e.test', 'Temporary-Pass-111', 'Mfa-User-Password-1');
    assert.deepEqual((await u.get('/auth/mfa')).data, { enabled: false, enabledAt: null, required: false, recoveryCodesLeft: 0 });

    // Enrolment: the secret works only after a correct first code.
    assert.equal((await u.post('/auth/mfa/enable', { code: '123456' })).status, 409, 'enable before setup');
    const setup = (await u.post('/auth/mfa/setup')).data;
    assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\/E2E%20S\.p\.A\.%3Amfa%40e2e\.test\?secret=[A-Z2-7]+&issuer=/);
    assert.match(setup.qrSvg, /^<svg/);
    const now = totpStep();
    const wrong = String((Number(totpCode(setup.secret, now)) + 1) % 1e6).padStart(6, '0');
    assert.equal((await u.post('/auth/mfa/enable', { code: wrong })).status, 401);
    const enabled = await u.post('/auth/mfa/enable', { code: totpCode(setup.secret, now) });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.recoveryCodes.length, 10);
    assert.match(enabled.data.recoveryCodes[0], /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    assert.equal((await u.post('/auth/mfa/setup')).status, 409, 'already enabled');

    // Login: the password alone gives no session, only a short ticket that is not a session cookie.
    const c = new Client(MFA_IP);
    const first = await c.post('/auth/login', { email: 'mfa@e2e.test', password: 'Mfa-User-Password-1' });
    assert.equal(first.data.mfaRequired, true);
    assert.equal(c.cookie, '');
    assert.equal((await c.get('/auth/me')).status, 401);
    c.cookie = `rs_session=${first.data.mfaToken}`;
    assert.equal((await c.get('/auth/me')).status, 401, 'the ticket is not a session');
    c.cookie = '';
    // The code used for enrolment cannot be used again; the next one can, once.
    assert.equal((await c.post('/auth/login/mfa', { mfaToken: first.data.mfaToken, code: totpCode(setup.secret, now) })).data.message, 'MFA_CODE_INVALID');
    const next = totpCode(setup.secret, now + 1);
    assert.equal((await c.post('/auth/login/mfa', { mfaToken: first.data.mfaToken, code: next })).status, 200);
    assert.equal((await c.get('/auth/me')).data.mfaEnabled, true);
    const again = new Client(MFA_IP);
    const t2 = (await again.post('/auth/login', { email: 'mfa@e2e.test', password: 'Mfa-User-Password-1' })).data.mfaToken;
    assert.equal((await again.post('/auth/login/mfa', { mfaToken: t2, code: next })).status, 401, 'replayed code');
    // Recovery code: works once, lower-case and without the dash too.
    const rc = enabled.data.recoveryCodes[0];
    assert.equal((await again.post('/auth/login/mfa', { mfaToken: t2, code: rc.replace('-', '').toLowerCase() })).status, 200);
    assert.equal((await again.get('/auth/mfa')).data.recoveryCodesLeft, 9);
    const t3 = (await new Client(MFA_IP).post('/auth/login', { email: 'mfa@e2e.test', password: 'Mfa-User-Password-1' })).data.mfaToken;
    assert.equal((await new Client(MFA_IP).post('/auth/login/mfa', { mfaToken: t3, code: rc })).status, 401, 'recovery code used twice');
    assert.equal((await new Client(MFA_IP).post('/auth/login/mfa', { mfaToken: 'not-a-token', code: '123456' })).data.message, 'MFA_SESSION_EXPIRED');

    // Organisation policy: only an administrator who already uses it can require it.
    assert.equal((await admin.patch('/admin/organisation', { mfaRequired: true })).data.message, 'MFA_SELF_FIRST');
    const aSetup = (await admin.post('/auth/mfa/setup')).data;
    assert.equal((await admin.post('/auth/mfa/enable', { code: totpCode(aSetup.secret, totpStep()) })).status, 200);
    assert.equal((await admin.patch('/admin/organisation', { mfaRequired: true })).status, 200);
    assert.equal((await admin.get('/admin/organisation')).data.mfaRequired, true);
    const n = new Client(MFA_IP);
    await n.signIn('nomfa@e2e.test', 'Temporary-Pass-222', 'No-Mfa-Password-12');
    assert.equal((await n.get('/auth/me')).data.mfaSetupRequired, true);
    assert.equal((await n.get('/admin/visits')).data.message, 'MFA_SETUP_REQUIRED');
    assert.equal((await n.get('/auth/mfa')).data.required, true);
    assert.equal((await again.post('/auth/mfa/disable', { password: 'Mfa-User-Password-1', code: enabled.data.recoveryCodes[1] })).data.message, 'MFA_REQUIRED_BY_ORGANISATION');
    assert.equal((await admin.patch('/admin/organisation', { mfaRequired: false })).status, 200);
    assert.equal((await n.get('/auth/me')).data.mfaSetupRequired, false);

    // Disabling needs password + code; an administrator can reset someone who lost the phone.
    assert.equal((await again.post('/auth/mfa/disable', { password: 'wrong-password-xx', code: enabled.data.recoveryCodes[1] })).status, 401);
    const users = (await admin.get('/admin/users')).data;
    const mfaUser = users.find((x) => x.email === 'mfa@e2e.test');
    assert.ok(mfaUser.mfaEnabledAt);
    assert.equal(mfaUser.mfaSecretEnc, undefined);
    const me = users.find((x) => x.email === 'admin@e2e.test');
    assert.equal((await admin.post(`/admin/users/${me.id}/reset-mfa`)).data.message, 'CANNOT_RESET_OWN_MFA');
    assert.equal((await admin.post(`/admin/users/${mfaUser.id}/reset-mfa`)).status, 200);
    assert.equal((await again.get('/auth/me')).status, 401, 'sessions revoked');
    const plain = new Client(MFA_IP);
    assert.equal((await plain.post('/auth/login', { email: 'mfa@e2e.test', password: 'Mfa-User-Password-1' })).data.ok, true);
  });

  test('single sign-on: link the directory, sign in, refusals, obligation with an emergency account', async () => {
    const IP = '10.9.0.3';
    const TID = '11111111-2222-3333-4444-555555555555';
    const ms = (tid) => `${idp.base}/ms/${tid}/v2.0`;
    const sessionOf = (b) => { const c = new Client(IP); c.cookie = `rs_session=${b.jar.get('rs_session')}`; return c; };
    // Full round trip: start → provider (fake) → callback → finish, in the same browser unless told otherwise.
    const roundTrip = async (b, startPath, claims, opts = {}) => {
      const s = await b.go(startPath);
      assert.equal(s.status, 302, s.body);
      const cb = await b.go(`/auth/sso/callback?${idp.issueCode(s.location, claims, opts)}`);
      assert.equal(cb.status, 302, cb.body);
      assert.match(cb.location, new RegExp(`^http://127\\.0\\.0\\.1:${PORT}/api/auth/sso/finish\\?code=`));
      return (opts.finishIn ?? b).go(cb.location);
    };

    assert.equal((await admin.get('/tenant')).data.sso, null, 'nothing linked yet');
    const org = (await admin.get('/admin/organisation')).data;
    assert.deepEqual(org.sso.available, ['microsoft', 'google']);
    assert.equal(org.sso.provider, null);
    assert.equal((await new Browser(IP).go('/auth/sso/start')).location, '/admin/?sso_error=SSO_NOT_CONFIGURED');

    // Only a SUPER_ADMIN links, and only with a work account.
    assert.equal((await new Browser(IP).go('/auth/sso/link?provider=microsoft')).status, 401);
    const adminBrowser = () => new Browser(IP, { rs_session: admin.cookie.split('=')[1] });
    let r = await roundTrip(adminBrowser(), '/auth/sso/link?provider=google', { sub: 'g1', email: 'someone@gmail.com', email_verified: true }, { issuer: `${idp.base}/google` });
    assert.equal(r.location, '/admin/organisation?sso_error=NOT_A_WORK_ACCOUNT');
    r = await roundTrip(adminBrowser(), '/auth/sso/link?provider=microsoft', { tid: TID, oid: 'o-boss', preferred_username: 'it@contoso.com' }, { issuer: ms(TID) });
    assert.equal(r.location, '/admin/organisation?sso=linked');
    const linked = (await admin.get('/admin/organisation')).data.sso;
    assert.equal(linked.provider, 'microsoft'); assert.equal(linked.org, 'contoso.com'); assert.equal(linked.enforced, false);
    assert.deepEqual((await admin.get('/tenant')).data.sso, { provider: 'microsoft', enforced: false });

    // Sign-in of an existing user: the session is marked as single sign-on.
    const b = new Browser(IP);
    r = await roundTrip(b, '/auth/sso/start', { tid: TID, oid: 'o-admin', preferred_username: 'Admin@E2E.test' }, { issuer: ms(TID) });
    assert.equal(r.location, '/admin/');
    const ssoAdmin = sessionOf(b);
    const me = (await ssoAdmin.get('/auth/me')).data;
    assert.equal(me.email, 'admin@e2e.test'); assert.equal(me.sso, true);
    assert.ok(!b.jar.has('rs_sso'), 'binding cookie cleared');

    // Refusals: another browser, another directory, a forged token, an unknown person, a different account with the same email, a replayed code.
    r = await roundTrip(new Browser(IP), '/auth/sso/start', { tid: TID, oid: 'o-admin', preferred_username: 'admin@e2e.test' }, { issuer: ms(TID), finishIn: new Browser('10.9.0.4') });
    assert.equal(r.location, '/admin/?sso_error=OTHER_BROWSER');
    const OTHER = '99999999-2222-3333-4444-555555555555';
    r = await roundTrip(new Browser(IP), '/auth/sso/start', { tid: OTHER, oid: 'o-admin', preferred_username: 'admin@e2e.test' }, { issuer: ms(OTHER) });
    assert.equal(r.location, '/admin/?sso_error=WRONG_ISSUER');
    r = await roundTrip(new Browser(IP), '/auth/sso/start', { tid: TID, oid: 'o-admin', preferred_username: 'admin@e2e.test' }, { issuer: ms(TID), rogueKey: true });
    assert.equal(r.location, '/admin/?sso_error=BAD_SIGNATURE');
    r = await roundTrip(new Browser(IP), '/auth/sso/start', { tid: TID, oid: 'o-admin', preferred_username: 'admin@e2e.test' }, { issuer: ms(TID), nonce: 'not-the-one' });
    assert.equal(r.location, '/admin/?sso_error=NONCE_MISMATCH');
    r = await roundTrip(new Browser(IP), '/auth/sso/start', { tid: TID, oid: 'o-x', preferred_username: 'nobody@e2e.test' }, { issuer: ms(TID) });
    assert.equal(r.location, '/admin/?sso_error=NO_ACCOUNT');
    r = await roundTrip(new Browser(IP), '/auth/sso/start', { tid: TID, oid: 'o-intruder', preferred_username: 'admin@e2e.test' }, { issuer: ms(TID) });
    assert.equal(r.location, '/admin/?sso_error=ACCOUNT_MISMATCH');
    const replay = new Browser(IP);
    const s = await replay.go('/auth/sso/start');
    const q = idp.issueCode(s.location, { tid: TID, oid: 'o-admin', preferred_username: 'admin@e2e.test' }, { issuer: ms(TID) });
    const first = await replay.go(`/auth/sso/callback?${q}`);
    assert.equal((await replay.go(`/auth/sso/callback?${q}`)).status, 400, 'state used once');
    assert.equal((await replay.go(first.location)).location, '/admin/');
    assert.equal((await replay.go(first.location)).location, '/admin/?sso_error=EXPIRED', 'hand-off code used once');
    assert.equal((await replay.go('/auth/sso/callback?state=unknown&code=x')).status, 400);

    // Obligation: proven by signing in through the directory, and only with an emergency account kept.
    assert.equal((await admin.patch('/admin/organisation', { ssoEnforced: true })).data.message, 'SSO_SELF_FIRST');
    assert.equal((await ssoAdmin.patch('/admin/organisation', { ssoEnforced: true })).data.message, 'SSO_EMERGENCY_ADMIN_REQUIRED');
    const users = (await ssoAdmin.get('/admin/users')).data;
    const adminRow = users.find((u) => u.email === 'admin@e2e.test');
    assert.equal(adminRow.ssoBound, true); assert.equal(adminRow.ssoSubject, undefined);
    assert.equal((await ssoAdmin.patch(`/admin/users/${adminRow.id}`, { ssoExempt: true })).status, 200);
    assert.equal((await ssoAdmin.patch('/admin/organisation', { ssoEnforced: true })).status, 200);
    assert.equal((await ssoAdmin.patch(`/admin/users/${adminRow.id}`, { ssoExempt: false })).data.message, 'SSO_EMERGENCY_ADMIN_REQUIRED');
    const rec = new Client(IP);
    const denied = await rec.post('/auth/login', { email: 'rec@e2e.test', password: 'Rec-Password-E2E!' });
    assert.equal(denied.status, 403); assert.equal(denied.data.message, 'SSO_REQUIRED');
    // The emergency account passes (and still gets its own second factor, enabled in the previous test).
    assert.equal((await new Client(IP).post('/auth/login', { email: 'admin@e2e.test', password: 'Admin-Password-E2E!' })).data.mfaRequired, true, 'emergency account');
    assert.equal((await admin.get('/tenant')).data.sso.enforced, true);

    // Unlinking turns everything off and forgets the bound accounts.
    assert.equal((await ssoAdmin.post('/admin/organisation/sso/unlink')).status, 200);
    assert.equal((await admin.get('/tenant')).data.sso, null);
    assert.equal((await new Client(IP).post('/auth/login', { email: 'rec@e2e.test', password: 'Rec-Password-E2E!' })).data.ok, true);
    assert.equal((await ssoAdmin.get('/admin/users')).data.find((u) => u.email === 'admin@e2e.test').ssoBound, false);
    assert.equal((await ssoAdmin.patch(`/admin/users/${adminRow.id}`, { ssoExempt: false })).status, 200);
  });

  test('people to visit picked from the employees; the visited employee invites guests from the phone app', async () => {
    const { createHash } = await import('node:crypto');
    const IP = '10.9.0.5';
    const api = (method, path, body) => fetch(`${BASE}/integration/v1${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.hrKey}` }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
    ctx.hrKey = (await admin.post('/admin/access/api-keys', { name: 'HR for hosts' })).data.key;
    const luisa = { firstName: 'Luisa', lastName: 'Verdi', email: 'luisa@e2e.test', department: 'Acquisti', jobTitle: 'Buyer', permissions: [] };
    assert.equal((await api('PUT', '/employees/H100', luisa)).data.created, true);

    // The console offers the employees; the person to visit takes name and email from the employee record.
    const cand = (await admin.get('/admin/hosts/employees')).data.find((e) => e.externalId === 'H100');
    assert.equal(cand.department, 'Acquisti'); assert.equal(cand.hostId, null);
    // A site manager sees only employees who can open a door of their sites (like the employee list).
    await admin.post('/admin/users', { email: 'sm-hosts@e2e.test', displayName: 'SM Hosts', role: 'SITE_MANAGER', siteIds: [ctx.milano.id], temporaryPassword: 'Temporary-Pass-333' });
    const sm = new Client(IP); await sm.signIn('sm-hosts@e2e.test', 'Temporary-Pass-333', 'Sm-Hosts-Password-1');
    assert.ok(!(await sm.get('/admin/hosts/employees')).data.some((e) => e.externalId === 'H100'));
    assert.equal((await sm.post('/admin/hosts', { firstName: 'A', lastName: 'B', employeeId: cand.id, siteIds: [ctx.milano.id] })).data.message, 'EMPLOYEE_NOT_FOUND');
    const host = await admin.post('/admin/hosts', { firstName: 'Typed', lastName: 'Name', phone: '+39 02 9', employeeId: cand.id, siteIds: [ctx.milano.id] });
    assert.equal(host.status, 201, JSON.stringify(host.data));
    assert.equal((await admin.post('/admin/hosts', { firstName: 'A', lastName: 'B', employeeId: cand.id, siteIds: [ctx.milano.id] })).data.message, 'EMPLOYEE_ALREADY_HOST');
    let row = (await admin.get('/admin/hosts')).data.find((h) => h.id === host.data.id);
    assert.deepEqual([row.firstName, row.lastName, row.email, row.department, row.jobTitle, row.phone, row.employeeId, row.appInvites], ['Luisa', 'Verdi', 'luisa@e2e.test', 'Acquisti', 'Buyer', '+39 02 9', cand.id, false]);
    assert.equal((await admin.patch(`/admin/hosts/${host.data.id}`, { firstName: 'Changed' })).status, 200);
    assert.equal((await admin.get('/admin/hosts')).data.find((h) => h.id === host.data.id).firstName, 'Luisa', 'a linked name follows the employee');
    // The external system renames her: the tablet shows the new name.
    await api('PUT', '/employees/H100', { ...luisa, lastName: 'Verdi Neri' });
    assert.equal((await admin.get('/admin/hosts')).data.find((h) => h.id === host.data.id).lastName, 'Verdi Neri');

    // She activates the phone app (code set directly: no SMTP in tests) and gets a token for her own requests.
    const mysql = require('mysql2/promise');
    const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
    await db.query('UPDATE employees SET loginCodeHash = ?, loginCodeExpiresAt = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE), loginCodeAttempts = 0 WHERE id = ?', [createHash('sha256').update(`${cand.id}|111222`).digest('hex'), cand.id]);
    await db.end();
    const badge = (await new Client(IP).post('/badge/activate', { email: 'luisa@e2e.test', code: '111222' })).data;
    assert.match(badge.appToken, /^dra_[A-Za-z0-9_-]{40,}$/);
    const phone = new Client(IP);
    const me = (path, body, method) => phone.req(method ?? (body ? 'POST' : 'GET'), `/me${path}`, body, { bearer: badge.appToken });
    assert.equal((await new Client(IP).get('/me')).status, 401);
    assert.equal((await new Client(IP).get('/me', { bearer: 'dra_' + 'x'.repeat(43) })).status, 401);
    assert.equal((await new Client(IP).get('/me', { bearer: badge.secret })).status, 401, 'the QR secret is not an app token');
    const profile = (await me('')).data;
    assert.equal(profile.canInvite, true); assert.deepEqual(profile.sites.map((x) => x.name), ['Milano']); assert.equal(profile.lastName, 'Verdi Neri');
    assert.equal((await admin.get('/admin/hosts')).data.find((h) => h.id === host.data.id).appInvites, true);

    // Invitations: only for her own sites; she sees and cancels only hers.
    const tomorrow = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + 86_400_000)).map((x) => [x.type, x.value]));
    const guest = { date: `${tomorrow.year}-${tomorrow.month}-${tomorrow.day}`, time: '10:30', firstName: 'Ugo', lastName: 'Ospite', company: 'Ospiti Srl', email: 'ugo@e2e.test', purpose: 'MEETING' };
    assert.equal((await me('/invitations', { ...guest, siteId: ctx.roma.id })).data.message, 'NOT_A_HOST_HERE');
    assert.equal((await me('/invitations', { ...guest, siteId: ctx.milano.id, hostId: ctx.mario.id })).status, 400, 'the host is always herself');
    const inv = await me('/invitations', { ...guest, siteId: ctx.milano.id });
    assert.equal(inv.status, 201, JSON.stringify(inv.data));
    const mine = (await me('/invitations')).data;
    assert.equal(mine.length, 1); assert.equal(mine[0].firstName, 'Ugo'); assert.equal(mine[0].status, 'PENDING'); assert.equal(mine[0].siteName, 'Milano');
    const inConsole = (await admin.get('/admin/invitations')).data.find((r) => r.id === inv.data.id);
    assert.equal(inConsole.hostName, 'Luisa Verdi Neri'); assert.equal(inConsole.fromApp, true);
    const qr = (await me(`/invitations/${inv.data.id}/qr`)).data;
    assert.match(qr.code, /^[A-Z0-9]{8}$/); assert.ok(qr.payload.endsWith(qr.code));
    const other = (await admin.get('/admin/invitations')).data.find((r) => r.hostName === 'Mario Rossi');
    if (other) assert.equal((await me(`/invitations/${other.id}/cancel`, {})).status, 404, 'somebody else’s invitation');
    assert.equal((await me(`/invitations/${inv.data.id}/cancel`, {})).status, 200);
    assert.equal((await me('/invitations')).data[0].status, 'CANCELLED');

    // Unlinked from the directory: no more inviting. Phone revoked: the token stops working.
    assert.equal((await admin.patch(`/admin/hosts/${host.data.id}`, { employeeId: null })).status, 200);
    assert.equal((await me('')).data.canInvite, false);
    assert.equal((await me('/invitations')).data.message, 'NOT_A_HOST');
    assert.equal((await admin.patch(`/admin/hosts/${host.data.id}`, { employeeId: cand.id })).status, 200);
    assert.equal((await me('')).data.canInvite, true);
    assert.equal((await admin.post(`/admin/access/employees/${cand.id}/revoke-phone`)).status, 200);
    assert.equal((await me('')).status, 401);

    // Removed by the external system: the person stays in the directory, no longer linked.
    assert.equal((await api('DELETE', '/employees/H100')).status, 200);
    row = (await admin.get('/admin/hosts')).data.find((h) => h.id === host.data.id);
    assert.equal(row.employeeId, null); assert.equal(row.lastName, 'Verdi Neri');
  });

  test('retention deletes audit entries older than AUDIT_LOG_RETENTION_DAYS, keeps recent ones', async () => {
    const mysql = require('mysql2/promise');
    const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
    const [[t]] = await db.query('SELECT id FROM tenants WHERE slug = ?', [SLUG]);
    const add = (days, action) => db.query("INSERT INTO audit_logs (tenantId, at, actorType, actorId, actorLabel, action, ip) VALUES (?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY), 'USER', NULL, 'old@e2e.test', ?, '203.0.113.9')", [t.id, days, action]);
    await add(400, 'E2E_OLD_ENTRY');
    await add(30, 'E2E_RECENT_ENTRY');
    await run('node', ['dist/database/run-retention.js'], { env: { ...env, AUDIT_LOG_RETENTION_DAYS: '365' } });
    const [rows] = await db.query("SELECT action FROM audit_logs WHERE tenantId = ? AND action LIKE 'E2E_%'", [t.id]);
    await db.end();
    assert.deepEqual(rows.map((r) => r.action), ['E2E_RECENT_ENTRY']);
  });

  test('deleting the tenant removes its host directory too', async () => {
    const mysql = require('mysql2/promise');
    const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
    const [[t]] = await db.query('SELECT id FROM tenants WHERE slug = ?', [SLUG]);
    await run('node', ['dist/cli/tenants.js', 'delete', '--slug', SLUG, '--confirm', SLUG], { env });
    const [[h]] = await db.query('SELECT COUNT(*) AS n FROM hosts WHERE tenantId = ?', [t.id]);
    const [[v]] = await db.query('SELECT COUNT(*) AS n FROM visits WHERE tenantId = ?', [t.id]);
    const [[i]] = await db.query('SELECT COUNT(*) AS n FROM invitations WHERE tenantId = ?', [t.id]);
    const [[d]] = await db.query('SELECT (SELECT COUNT(*) FROM doors WHERE tenantId = ?) + (SELECT COUNT(*) FROM access_events WHERE tenantId = ?) + (SELECT COUNT(*) FROM api_keys WHERE tenantId = ?) AS n', [t.id, t.id, t.id]);
    await db.end();
    assert.equal(Number(h.n), 0); assert.equal(Number(v.n), 0); assert.equal(Number(i.n), 0); assert.equal(Number(d.n), 0);
  });
});
