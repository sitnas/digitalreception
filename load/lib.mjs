// Helpers shared by the seed and the scenarios: an HTTP client that can set Host (tenant by subdomain)
// and X-Forwarded-For (one address per simulated device), a concurrency pool, synthetic images.
import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';

export const API = new URL(process.env.LOAD_API ?? 'http://127.0.0.1:3000');
export const BASE_DOMAIN = process.env.LOAD_BASE_DOMAIN ?? 'load.test';
export const OUT = new URL('./.out/', import.meta.url);
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

/** A random private address: each simulated tablet, reader or phone gets its own rate-limit bucket. */
export const randomIp = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${1 + ((Math.random() * 253) | 0)}`;
export const hostOf = (slug) => `${slug}.${BASE_DOMAIN}`;

export function call(method, path, { slug, body, bearer, cookie, ip = randomIp(), csrf = !bearer } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = { Host: hostOf(slug), 'X-Forwarded-For': ip, 'X-Forwarded-Proto': 'https' };
  if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-Requested-With'] = 'reception-admin';
  return new Promise((resolve, reject) => {
    const req = http.request({ host: API.hostname, port: API.port, method, path: `/api${path}`, headers, agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        const set = res.headers['set-cookie'];
        resolve({ status: res.statusCode, data, cookie: set ? set[0].split(';')[0] : undefined });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Throws with the server's answer when a seeding call does not succeed. */
export async function must(p, what) {
  const r = await p;
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

/** Runs fn over items with at most n in flight. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * Images as the tablet sends them: the server checks only the first bytes, so random content of a
 * realistic size is enough (and, like a real JPEG, it does not compress).
 */
export const fakePng = (bytes) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(bytes - 8)]).toString('base64')}`;
export const fakeJpeg = (bytes) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(bytes - 4)]).toString('base64')}`;

/** The phone badge QR for now, exactly as the app computes it. */
export function badgeQr(employeeId, secretB64, stepS = 30) {
  const step = Math.floor(Date.now() / 1000 / stepS);
  const sig = createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${employeeId}.${step}`).digest('hex').slice(0, 16);
  return `DRE1:${employeeId}.${step}.${sig}`;
}

export const readSeed = () => JSON.parse(readFileSync(new URL('seed.json', OUT), 'utf8'));
export const pick = (a) => a[(Math.random() * a.length) | 0];
