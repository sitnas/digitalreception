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

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const enabled = !!process.env.E2E_DB_HOST;
const PORT = Number(process.env.E2E_PORT ?? 3199);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SLUG = `e2e-${randomBytes(3).toString('hex')}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const env = {
  ...process.env,
  NODE_ENV: 'development', PORT: String(PORT), TENANCY_MODE: 'single', DEFAULT_TENANT_SLUG: SLUG,
  MASTER_KEYS: `k1:${randomBytes(32).toString('base64')}`, JWT_SECRET: randomBytes(48).toString('base64'),
  DB_TYPE: 'mysql', DB_HOST: process.env.E2E_DB_HOST, DB_PORT: process.env.E2E_DB_PORT ?? '3306',
  DB_NAME: process.env.E2E_DB_NAME ?? 'reception', DB_USER: process.env.E2E_DB_USER ?? 'reception', DB_PASSWORD: process.env.E2E_DB_PASSWORD ?? 'reception',
  STORAGE_DRIVER: 'local', FILES_DIR: mkdtempSync(join(tmpdir(), 'e2e-files-')), COOKIE_SECURE: 'false', TRUST_PROXY: '0',
  SMTP_HOST: '', JOBS_ENABLED: 'false',
};

/** Minimal client: keeps the session cookie and sends the CSRF header like the console does. */
class Client {
  cookie = '';
  async req(method, path, body, { bearer, csrf = true } = {}) {
    const headers = {};
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

  before(async () => {
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

  test('deleting the tenant removes its host directory too', async () => {
    const mysql = require('mysql2/promise');
    const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
    const [[t]] = await db.query('SELECT id FROM tenants WHERE slug = ?', [SLUG]);
    await run('node', ['dist/cli/tenants.js', 'delete', '--slug', SLUG, '--confirm', SLUG], { env });
    const [[h]] = await db.query('SELECT COUNT(*) AS n FROM hosts WHERE tenantId = ?', [t.id]);
    const [[v]] = await db.query('SELECT COUNT(*) AS n FROM visits WHERE tenantId = ?', [t.id]);
    const [[i]] = await db.query('SELECT COUNT(*) AS n FROM invitations WHERE tenantId = ?', [t.id]);
    await db.end();
    assert.equal(Number(h.n), 0); assert.equal(Number(v.n), 0); assert.equal(Number(i.n), 0);
  });
});
