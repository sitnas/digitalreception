// Fills a dedicated database with realistic organisations through the real API (and SQL only for
// history that the API cannot backdate). Never point it at a database with real data.
//
//   LOAD_ENV=/path/to/load.env node seed.mjs
//
// LOAD_ENV is the API's environment file (database and keys): the seed runs the platform CLI with it
// and writes history rows with the same database account.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import { OUT, call, fakePng, must, pool } from './lib.mjs';

const run = promisify(execFile);
const envFile = process.env.LOAD_ENV;
if (!envFile) throw new Error('Set LOAD_ENV to the API environment file of the load database');
const env = { ...process.env, ...Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) };
const CLI = new URL('../api/dist/cli/tenants.js', import.meta.url).pathname;
const PASSWORD = 'Load-Test-Password-2026!';

/**
 * One large organisation (four sites, 3,000 employees) and four small ones (one site, 200 employees):
 * a shared SaaS with a big customer next to small ones. Set LOAD_SCALE=0.2 for a quick run.
 */
const SCALE = Number(process.env.LOAD_SCALE ?? 1);
const n = (v) => Math.max(1, Math.round(v * SCALE));
const SPECS = [
  { slug: 'grande', name: 'Grande S.p.A.', sites: 4, employeesPerSite: n(750), doorsPerSite: 5, tabletsPerSite: 2, hostsPerSite: 12, visits: n(8000), parcels: n(240), spotsPerSite: 25, parkingUsers: n(400) },
  ...[1, 2, 3, 4].map((i) => ({ slug: `piccola${i}`, name: `Piccola ${i} S.r.l.`, sites: 1, employeesPerSite: n(200), doorsPerSite: 2, tabletsPerSite: 1, hostsPerSite: 8, visits: n(1000), parcels: n(20), spotsPerSite: 10, parkingUsers: n(40) })),
];
const HISTORY_DAYS = 60;
const CITIES = [['MI', 'Milano'], ['RM', 'Roma'], ['TO', 'Torino'], ['BO', 'Bologna']];
const FIRST = ['Luca', 'Giulia', 'Marco', 'Sara', 'Paolo', 'Anna', 'Davide', 'Elena', 'Matteo', 'Chiara', 'Andrea', 'Francesca'];
const LAST = ['Rossi', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'Costa', 'Giordano'];
const PURPOSES = ['MEETING', 'MEETING', 'MEETING', 'SUPPLIER', 'INTERVIEW', 'MAINTENANCE', 'DELIVERY', 'OTHER'];
const DISTANCES = ['UNDER_10_KM', 'FROM_10_TO_100_KM', 'OVER_100_KM'];
const name = (i) => [FIRST[i % FIRST.length], LAST[Math.floor(i / FIRST.length) % LAST.length]];
/** A unique surname suffix made of letters only (names do not take digits): 0 → a, 27 → bb. */
const letters = (i) => { let s = ''; do { s = String.fromCharCode(97 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0); return s; };
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${m}`);

async function seedTenant(spec, db) {
  const { slug } = spec;
  const out = await run('node', [CLI, 'create', '--slug', slug, '--name', spec.name, '--countries', 'IT', '--admin-email', `admin@${slug}.load.test`, '--apps', 'reception,access,parcels,parking'], { env });
  const temp = /Temporary password[^:]*: (\S+)/.exec(out.stdout)[1];
  let r = await call('POST', '/auth/login', { slug, body: { email: `admin@${slug}.load.test`, password: temp } });
  await must(call('POST', '/auth/password', { slug, cookie: r.cookie, body: { currentPassword: temp, newPassword: PASSWORD } }), 'password');
  r = await call('POST', '/auth/login', { slug, body: { email: `admin@${slug}.load.test`, password: PASSWORD } });
  const cookie = r.cookie;
  const admin = (method, path, body) => must(call(method, path, { slug, cookie, body }), `${method} ${path}`);

  const sites = [];
  for (let s = 0; s < spec.sites; s++) {
    const [code, city] = CITIES[s];
    const site = await admin('POST', '/admin/sites', { code, name: city, countryCode: 'IT', timezone: 'Europe/Rome' });
    const hosts = await pool(Array.from({ length: spec.hostsPerSite }, (_, i) => i), 4, (i) => {
      const [fn, ln] = name(i + s * 31);
      return admin('POST', '/admin/hosts', { firstName: fn, lastName: ln, department: 'Ufficio', siteIds: [site.id] });
    });
    const tablets = [];
    for (let t = 0; t < spec.tabletsPerSite; t++) {
      const { code: pc } = await admin('POST', '/admin/devices/pairing-code', { siteId: site.id, name: `Tablet ${city} ${t + 1}` });
      const { deviceToken } = await must(call('POST', '/kiosk/pair', { slug, body: { code: pc } }), 'kiosk pair');
      const cfg = await must(call('GET', '/kiosk/config', { slug, bearer: deviceToken }), 'kiosk config');
      tablets.push({ token: deviceToken, notice: cfg.notices.it.id });
    }
    const doors = [];
    for (let d = 0; d < spec.doorsPerSite; d++) {
      const door = await admin('POST', '/admin/access/doors', { siteId: site.id, name: `${city} porta ${d + 1}`, externalId: `${code}-D${d + 1}` });
      const { code: rc } = await admin('POST', `/admin/access/doors/${door.id}/reader-code`, { name: `Lettore ${city} ${d + 1}` });
      const { readerToken } = await must(call('POST', '/reader/pair', { slug, body: { code: rc } }), 'reader pair');
      doors.push({ id: door.id, externalId: `${code}-D${d + 1}`, readerToken });
    }
    const spots = await pool(Array.from({ length: spec.spotsPerSite }, (_, i) => i), 4, (i) => admin('POST', '/admin/parking/spots', { siteId: site.id, code: `P${i + 1}` }));
    sites.push({ id: site.id, code, hostIds: hosts.map((h) => h.id), tablets, doors, spotIds: spots.map((x) => x.id) });
  }
  log(`${slug}: ${sites.length} sites, tablets, readers and spots ready`);

  // Employees through the HR integration, as a customer's personnel system would send them.
  const { key } = await admin('POST', '/admin/access/api-keys', { name: 'Load HR' });
  const people = sites.flatMap((s, si) => Array.from({ length: spec.employeesPerSite }, (_, i) => ({ site: s, externalId: `E${si}-${i}`, i: i + si * spec.employeesPerSite })));
  await pool(people, 16, (p) => {
    const [fn, ln] = name(p.i);
    return must(call('PUT', `/integration/v1/employees/${p.externalId}`, { slug, bearer: key, body: {
      firstName: fn, lastName: `${ln} ${letters(p.i)}`, email: `${p.externalId.toLowerCase()}@${slug}.load.test`, department: 'Operations',
      permissions: p.site.doors.map((d) => ({ door: d.externalId })),
    } }), 'employee');
  });
  log(`${slug}: ${people.length} employees sent by the HR integration`);

  // Phone badges: the code normally arrives by email; set a known one, then activate through the API.
  const [ids] = await db.query('SELECT e.id, e.externalId FROM employees e JOIN tenants t ON t.id = e.tenantId WHERE t.slug = ?', [slug]);
  const byExt = new Map(ids.map((x) => [x.externalId, x.id]));
  for (const chunk of Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) => ids.slice(i * 500, i * 500 + 500))) {
    await db.query(`UPDATE employees SET loginCodeHash = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END, loginCodeExpiresAt = UTC_TIMESTAMP() + INTERVAL 30 MINUTE, loginCodeAttempts = 0 WHERE id IN (${chunk.map(() => '?').join(',')})`,
      [...chunk.flatMap((x) => [x.id, createHash('sha256').update(`${x.id}|135790`).digest('hex')]), ...chunk.map((x) => x.id)]);
  }
  const badges = await pool(people, 16, async (p) => {
    const b = await must(call('POST', '/badge/activate', { slug, body: { email: `${p.externalId.toLowerCase()}@${slug}.load.test`, code: '135790' } }), 'activate');
    return { id: b.employeeId, secret: b.secret, appToken: b.appToken, siteIdx: sites.indexOf(p.site) };
  });
  log(`${slug}: ${badges.length} phone badges activated`);

  // Parking benefit and waiting parcels.
  await pool(people.slice(0, spec.parkingUsers), 8, (p) => admin('PUT', `/admin/access/employees/${byExt.get(p.externalId)}/parking`, { role: 'USER' }));
  await pool(people.slice(0, spec.parcels), 8, (p) => admin('POST', '/admin/parcels', { siteId: p.site.id, employeeId: byExt.get(p.externalId), carrier: 'DHL' }));

  // Visits through the tablets (encrypted like real ones), then spread over the last weeks.
  const signature = fakePng(25_000);
  await pool(Array.from({ length: spec.visits }, (_, i) => i), 24, (i) => {
    const s = sites[i % sites.length], tab = s.tablets[i % s.tablets.length];
    const [fn, ln] = name(i * 7);
    return must(call('POST', '/kiosk/visits', { slug, bearer: tab.token, body: {
      locale: 'it', firstName: fn, lastName: ln, company: 'Fornitore Srl', sendNoticeEmail: false, purpose: PURPOSES[i % PURPOSES.length],
      hostId: s.hostIds[i % s.hostIds.length], travelDistance: DISTANCES[i % 3], privacyNoticeId: tab.notice, privacyAccepted: true, signature,
    } }), 'check-in');
  });
  // Keep about 30 visitors on site now; the rest arrived on working days of the last weeks and left.
  await db.query(`UPDATE visits v JOIN tenants t ON t.id = v.tenantId SET
      v.checkInAt = UTC_TIMESTAMP(3) - INTERVAL FLOOR(1 + RAND() * ?) DAY + INTERVAL FLOOR(RAND() * 480) MINUTE - INTERVAL 4 HOUR,
      v.status = 'CLOSED' WHERE t.slug = ?`, [HISTORY_DAYS - 1, slug]);
  await db.query(`UPDATE visits v JOIN tenants t ON t.id = v.tenantId SET v.checkOutAt = v.checkInAt + INTERVAL FLOOR(20 + RAND() * 200) MINUTE WHERE t.slug = ?`, [slug]);
  await db.query(`UPDATE visits v JOIN tenants t ON t.id = v.tenantId SET v.checkInAt = UTC_TIMESTAMP(3) - INTERVAL FLOOR(RAND() * 120) MINUTE, v.checkOutAt = NULL, v.status = 'OPEN'
      WHERE t.slug = ? ORDER BY RAND() LIMIT ?`, [slug, Math.min(30, spec.visits)]);
  log(`${slug}: ${spec.visits} visits`);

  // Door log: about two passages per employee per working day, written in bulk (the API only logs "now").
  const rows = [];
  for (let day = 1; day <= HISTORY_DAYS; day++) {
    const dow = new Date(Date.now() - day * 86_400_000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const b of badges) {
      if (Math.random() < 0.15) continue; // holidays, remote work
      const site = sites[b.siteIdx], door = site.doors[(Math.random() * site.doors.length) | 0];
      for (const hour of [7.5 + Math.random() * 2, 16.5 + Math.random() * 3]) {
        const denied = Math.random() < 0.01;
        rows.push([randomUUID(), site.id, door.id, null, b.id, 'QR', denied ? 'DENIED' : 'GRANTED', denied ? 'QR_EXPIRED' : 'OK',
          new Date(Date.now() - day * 86_400_000 - (Date.now() % 86_400_000) + hour * 3_600_000)]);
      }
    }
  }
  const [[tenant]] = await db.query('SELECT id FROM tenants WHERE slug = ?', [slug]);
  const [readers] = await db.query('SELECT r.id, r.doorId FROM door_readers r WHERE r.tenantId = ?', [tenant.id]);
  const readerOf = new Map(readers.map((x) => [x.doorId, x.id]));
  for (let i = 0; i < rows.length; i += 2000) {
    const part = rows.slice(i, i + 2000).map((x) => [x[0], tenant.id, x[1], x[2], readerOf.get(x[2]), x[4], x[5], x[6], x[7], x[8]]);
    await db.query('INSERT INTO access_events (id, tenantId, siteId, doorId, readerId, employeeId, method, result, reason, at) VALUES ?', [part]);
  }
  log(`${slug}: ${rows.length} door events in the last ${HISTORY_DAYS} days`);

  return { slug, password: PASSWORD, email: `admin@${slug}.load.test`, hrKey: key, sites: sites.map((s) => ({ ...s })), badges, employees: people.map((p) => p.externalId) };
}

const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const [[{ c }]] = await db.query('SELECT COUNT(*) AS c FROM tenants');
if (c > 0 && !process.env.LOAD_APPEND) throw new Error(`${env.DB_NAME} already has ${c} organisations: use an empty database (or LOAD_APPEND=1)`);
const tenants = [];
for (const spec of SPECS) tenants.push(await seedTenant(spec, db));
await db.end();
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('seed.json', OUT), JSON.stringify({ createdAt: new Date().toISOString(), tenants }, null, 1));
log(`done: ${tenants.length} organisations, written to load/.out/seed.json`);
