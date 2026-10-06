// Load scenarios against an API seeded by seed.mjs. Each scenario runs at several concurrency
// levels and prints throughput, latency percentiles, errors and the CPU used by API and database.
//
//   node run.mjs                         all scenarios, 10 / 50 / 100 connections, 20 s each
//   node run.mjs doors checkin           only some
//   LOAD_CONNECTIONS=25,100 LOAD_DURATION=30 node run.mjs mixed
//   LOAD_PIDS=1234,5678 node run.mjs      also measure the CPU of these processes (API replicas, mysqld)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import autocannon from 'autocannon';
import { API, OUT, badgeQr, call, fakePng, hostOf, pick, randomIp, readSeed } from './lib.mjs';

const seed = readSeed();
const CONNECTIONS = (process.env.LOAD_CONNECTIONS ?? '10,50,100').split(',').map(Number);
const DURATION = Number(process.env.LOAD_DURATION ?? 20);
const PIDS = (process.env.LOAD_PIDS ?? '').split(',').filter(Boolean).map(Number);

// Console sessions: one administrator per organisation.
for (const t of seed.tenants) {
  const r = await call('POST', '/auth/login', { slug: t.slug, body: { email: t.email, password: t.password } });
  if (!r.cookie) throw new Error(`login ${t.slug}: ${r.status}`);
  t.cookie = r.cookie;
}
// Who may pass where: employees have permissions on the doors of their own site.
const doorsAndPeople = seed.tenants.flatMap((t) => t.sites.map((s, si) => ({ t, readers: s.doors.map((d) => d.readerToken), people: t.badges.filter((b) => b.siteIdx === si) })));
const signature = fakePng(25_000);
const headers = (t, extra = {}) => ({ host: hostOf(t.slug), 'x-forwarded-for': randomIp(), 'x-forwarded-proto': 'https', ...extra });
// Organisations are picked in proportion to their size: the big one gets most of the traffic.
const weighted = seed.tenants.flatMap((t) => Array(Math.max(1, Math.round(t.badges.length / 200))).fill(t));

const SCENARIOS = {
  /** Morning entrance: readers verify phone QR codes (the busiest path of the day). */
  doors: () => {
    const t = pick(weighted), g = pick(doorsAndPeople.filter((x) => x.t === t));
    const b = pick(g.people);
    return { method: 'POST', path: '/api/reader/verify', headers: headers(g.t, { authorization: `Bearer ${pick(g.readers)}`, 'content-type': 'application/json' }), body: JSON.stringify({ qr: badgeQr(b.id, b.secret) }) };
  },
  /** Reception: a guest checks in at the tablet with the signature. */
  checkin: () => {
    const t = pick(weighted), s = pick(t.sites), tab = pick(s.tablets);
    return { method: 'POST', path: '/api/kiosk/visits', headers: headers(t, { authorization: `Bearer ${tab.token}`, 'content-type': 'application/json' }), body: JSON.stringify({
      locale: 'it', firstName: 'Ospite', lastName: 'Carico', company: 'Fornitore Srl', sendNoticeEmail: false, purpose: 'MEETING',
      hostId: pick(s.hostIds), travelDistance: 'UNDER_10_KM', privacyNoticeId: tab.notice, privacyAccepted: true, signature,
    }) };
  },
  /** Console screens left open at reception and by managers: today, the home dashboard, parcels. */
  console: () => {
    const t = pick(weighted), s = pick(t.sites);
    const path = pick([`/api/admin/visits/present?siteId=${s.id}`, '/api/admin/dashboard', `/api/admin/parcels?siteId=${s.id}`, `/api/admin/visits/present?siteId=${s.id}`]);
    return { method: 'GET', path, headers: headers(t, { cookie: t.cookie }) };
  },
  /** Employees' phones: profile (badge validity) and parcels, when the app comes to the front. */
  app: () => {
    const t = pick(weighted), b = pick(t.badges);
    return { method: 'GET', path: pick(['/api/me', '/api/me/parcels']), headers: headers(t, { authorization: `Bearer ${b.appToken}` }) };
  },
  /** The HR system sends updates for its people (same data: the full write path, rules rewritten). */
  hr: () => {
    const t = pick(weighted), i = (Math.random() * t.employees.length) | 0, ext = t.employees[i];
    const site = t.sites[Number(ext.split('-')[0].slice(1))];
    return { method: 'PUT', path: `/api/integration/v1/employees/${ext}`, headers: headers(t, { authorization: `Bearer ${t.hrKey}`, 'content-type': 'application/json' }), body: JSON.stringify({
      firstName: 'Luca', lastName: `Aggiornato ${String.fromCharCode(97 + (i % 26))}`, email: `${ext.toLowerCase()}@${t.slug}.load.test`, department: 'Operations',
      permissions: site.doors.map((d) => ({ door: d.externalId })),
    }) };
  },
};
/** A morning peak, all at once: mostly doors and phones, some console, a few check-ins and HR updates. */
const MIX = [['doors', 10], ['app', 6], ['console', 2], ['checkin', 1], ['hr', 1]].flatMap(([k, w]) => Array(w).fill(k));
SCENARIOS.mixed = () => SCENARIOS[pick(MIX)]();

const cpuTicks = (pid) => { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); } catch { return 0; } };
const TICK = 100; // USER_HZ on Linux

async function runOne(name, connections) {
  const before = PIDS.map(cpuTicks), t0 = Date.now();
  const res = await autocannon({
    url: `${API.origin}`, connections, duration: DURATION, timeout: 30,
    requests: [{ setupRequest: (req) => ({ ...req, ...SCENARIOS[name]() }) }],
  });
  const secs = (Date.now() - t0) / 1000;
  const cpu = PIDS.map((p, i) => Math.round(((cpuTicks(p) - before[i]) / TICK / secs) * 100));
  const ok = res['2xx'], bad = res.non2xx + res.errors + res.timeouts;
  return { scenario: name, connections, rps: Math.round(ok / secs), p50: res.latency.p50, p90: res.latency.p90, p99: res.latency.p99, max: res.latency.max, ok, failed: bad, non2xx: res.non2xx, timeouts: res.timeouts, cpu };
}

// Check-ins last: each one leaves a guest on site, and the console's list of who is in grows with them.
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['doors', 'console', 'app', 'hr', 'mixed', 'checkin'];
const results = [];
for (const name of names) {
  for (const c of CONNECTIONS) {
    const r = await runOne(name, c);
    results.push(r);
    console.log(`${name.padEnd(8)} ${String(c).padStart(4)} conn  ${String(r.rps).padStart(5)} req/s  p50 ${String(r.p50).padStart(5)} ms  p90 ${String(r.p90).padStart(5)} ms  p99 ${String(r.p99).padStart(5)} ms  failed ${r.failed}${PIDS.length ? `  cpu ${r.cpu.join('/')}%` : ''}`);
    await new Promise((ok) => setTimeout(ok, 3000)); // let queues drain between runs
  }
}
mkdirSync(OUT, { recursive: true });
const file = new URL(`results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, OUT);
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), duration: DURATION, results }, null, 1));
console.log(`saved ${file.pathname}`);
