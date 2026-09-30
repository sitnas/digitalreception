/**
 * Fake HR system, for demos and tests: invents realistic employees and sends them to the integration
 * API exactly as a real HR / access-control system would (PUT /api/integration/v1/…). Nothing is
 * written to the database directly, so it also shows how the integration works.
 *
 *   npm run fake-employees -- --key drk_… [--count 20] [--site MI] [--domain esempio.it] [--my-email io@azienda.it --my-name "Mario Rossi"]
 *   npm run fake-employees -- --key drk_… --remove [--count 20]
 *
 * --key      integration API key (console → Integrazione API); or FAKE_API_KEY in the environment
 * --site     site code: also creates two doors there (FAKE-INGRESSO, FAKE-MAGAZZINO) with permissions
 * --my-email the first employee gets this address (and --my-name), to activate the phone app yourself
 * --url      API address, default http://127.0.0.1:$PORT (inside the API container)
 * --tenant   organisation slug, only for TENANCY_MODE=subdomain
 * --seed     same seed = same people (default 1)
 * --remove   deletes FAKE-EMP-001…FAKE-EMP-<count>
 */

const FIRST = ['Giulia', 'Marco', 'Francesca', 'Luca', 'Chiara', 'Alessandro', 'Sara', 'Andrea', 'Martina', 'Davide', 'Elena', 'Matteo',
  'Valentina', 'Simone', 'Federica', 'Lorenzo', 'Silvia', 'Stefano', 'Paola', 'Riccardo', 'Anna', 'Giorgio', 'Laura', 'Nicola',
  'Roberta', 'Fabio', 'Ilaria', 'Daniele', 'Beatrice', 'Emanuele', 'Noemi', 'Tommaso', 'Alice', 'Pietro', 'Marta', 'Gabriele'];
const LAST = ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo',
  'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani',
  'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale', 'D\'Angelo', 'Serra'];
const JOBS: [string, string[]][] = [
  ['Acquisti', ['Buyer', 'Responsabile acquisti']], ['Amministrazione', ['Contabile', 'Controller']],
  ['Commerciale', ['Account manager', 'Direttore commerciale']], ['Risorse umane', ['HR specialist', 'Responsabile HR']],
  ['IT', ['Sistemista', 'Sviluppatore']], ['Logistica', ['Magazziniere', 'Responsabile logistica']],
  ['Marketing', ['Marketing specialist', 'Brand manager']], ['Produzione', ['Operatore', 'Capo reparto']],
  ['Qualità', ['Responsabile qualità', 'Tecnico qualità']], ['Ricerca e sviluppo', ['Ingegnere', 'Tecnico di laboratorio']],
];
const DOORS = [{ id: 'FAKE-INGRESSO', name: 'Ingresso principale' }, { id: 'FAKE-MAGAZZINO', name: 'Magazzino' }];

function args() {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1] === undefined || a[i + 1].startsWith('--') ? 'true' : a[++i];
  return out;
}

/** Small seeded generator: the same seed always gives the same people. */
function prng(seed: number) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

const ascii = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

async function main() {
  const o = args();
  const key = o.key ?? process.env.FAKE_API_KEY;
  if (!key || !key.startsWith('drk_')) throw new Error('Serve una chiave API: --key drk_… (console → Integrazione API → Nuova chiave)');
  const base = (o.url ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/+$/, '');
  const count = Math.min(500, Math.max(1, Number(o.count ?? 20)));
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (o.tenant) headers.Host = `${o.tenant}.${process.env.BASE_DOMAIN ?? ''}`;

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api/integration/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => ({})) as { message?: unknown; created?: boolean };
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data.message ?? data)}`);
    return data;
  };
  const id = (n: number) => `FAKE-EMP-${String(n).padStart(3, '0')}`;

  if (o.remove) {
    let removed = 0;
    for (let n = 1; n <= count; n++) {
      try { await call('DELETE', `/employees/${id(n)}`); removed++; } catch (e) { if (!/→ 404/.test((e as Error).message)) throw e; }
    }
    console.log(`${removed} dipendenti finti eliminati (le porte FAKE-* restano: si disattivano dalla console).`);
    return;
  }

  if (o.site) for (const d of DOORS) await call('PUT', `/doors/${d.id}`, { siteCode: o.site, name: d.name });

  const rnd = prng(Number(o.seed ?? 1));
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const domain = o.domain ?? 'esempio.it';
  const used = new Set<string>();
  let created = 0, updated = 0;
  for (let n = 1; n <= count; n++) {
    let first = pick(FIRST), last = pick(LAST);
    if (n === 1 && o['my-name']) {
      const parts = o['my-name'].trim().split(/\s+/);
      first = parts[0]; if (parts.length > 1) last = parts.slice(1).join(' ');
    }
    let email = `${ascii(first)}.${ascii(last)}@${domain}`;
    for (let k = 2; used.has(email); k++) email = `${ascii(first)}.${ascii(last)}${k}@${domain}`;
    used.add(email);
    if (n === 1 && o['my-email']) email = o['my-email'].trim().toLowerCase();
    const [department, titles] = pick(JOBS);
    // Half of them also have an NFC card (7-byte UID, as on MIFARE / NTAG cards).
    const badgeUid = rnd() < 0.5 ? Array.from({ length: 7 }, (_, i) => (i === 0 ? 0x04 : Math.floor(rnd() * 256)).toString(16).padStart(2, '0')).join(':').toUpperCase() : null;
    const permissions = o.site ? [
      { door: 'FAKE-INGRESSO', days: [1, 2, 3, 4, 5], from: '07:00', to: '20:00' },
      ...(['Logistica', 'Produzione'].includes(department) ? [{ door: 'FAKE-MAGAZZINO' }] : []),
    ] : [];
    const r = await call('PUT', `/employees/${id(n)}`, { firstName: first, lastName: last, email, department, jobTitle: pick(titles), badgeUid, permissions });
    if (r.created) created++; else updated++;
    console.log(`${id(n)}  ${first} ${last}`.padEnd(38) + `${email}`.padEnd(42) + `${department}${badgeUid ? '  · tessera NFC' : ''}`);
  }
  console.log(`\n${created} creati, ${updated} aggiornati${o.site ? `, con permessi sulle porte ${DOORS.map((d) => d.id).join(' e ')} della sede ${o.site}` : ''}.`);
  console.log('Ora in console: Dipendenti per vederli, Persone da visitare → Aggiungi → Scegli tra i dipendenti.');
}

main().catch((e) => { console.error(`Errore: ${e.message}`); process.exit(1); });
