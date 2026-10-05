import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'crypto';
import { lookup as dnsLookup, type LookupAddress } from 'dns';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { isIP } from 'net';
import { EntityManager, Repository } from 'typeorm';
import { Webhook, WebhookDelivery, type WebhookEvent } from '../entities';
import { APP_CONFIG, AppConfig } from './app-config';
import { TenantKeysService } from './tenant-keys.service';

const TIMEOUT_MS = 5_000;
/** Minutes before the next attempt: 1, 5, 30, 120; then FAILED. */
const BACKOFF_MIN = [1, 5, 30, 120];

/** Loopback, private, link-local (cloud metadata), CGNAT, multicast and reserved ranges. */
export function isPrivateIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateIp(mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  if (isIP(ip) === 6) {
    const s = ip.toLowerCase();
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

export interface EventData {
  site: string; locale: string;
  /** visit.arrived */
  visitor?: string; company?: string | null; host?: string;
  /** access.denied */
  door?: string; reason?: string; employee?: string | null;
  /** evacuation.started */
  guests?: number; employees?: number;
}

const TEXT = {
  it: {
    arrived: (d: EventData, names: boolean) => names ? `Ospite arrivato a ${d.site}: ${d.visitor}${d.company ? ` (${d.company})` : ''}, per ${d.host}.` : `Un ospite per ${d.host} è arrivato a ${d.site}.`,
    denied: (d: EventData, names: boolean) => `Accesso negato alla porta ${d.door} (${d.site}): ${REASONS.it[d.reason as keyof typeof REASONS.it] ?? d.reason}${names && d.employee ? `, ${d.employee}` : ''}.`,
    evacuation: (d: EventData) => `🚨 Evacuazione avviata a ${d.site}: ${d.guests} ospiti e ${d.employees} dipendenti passati oggi dalle porte. L'appello è in console, alla voce Evacuazione.`,
    test: 'Prova dal registro visitatori: se leggi questo messaggio il collegamento funziona.',
  },
  es: {
    arrived: (d: EventData, names: boolean) => names ? `Ha llegado una visita a ${d.site}: ${d.visitor}${d.company ? ` (${d.company})` : ''}, para ${d.host}.` : `Ha llegado una visita para ${d.host} a ${d.site}.`,
    denied: (d: EventData, names: boolean) => `Acceso denegado en la puerta ${d.door} (${d.site}): ${REASONS.es[d.reason as keyof typeof REASONS.es] ?? d.reason}${names && d.employee ? `, ${d.employee}` : ''}.`,
    evacuation: (d: EventData) => `🚨 Evacuación iniciada en ${d.site}: ${d.guests} visitas y ${d.employees} empleados que pasaron hoy por las puertas. El recuento está en la consola, en Evacuación.`,
    test: 'Prueba desde el registro de visitas: si lee este mensaje, la conexión funciona.',
  },
  en: {
    arrived: (d: EventData, names: boolean) => names ? `Guest arrived at ${d.site}: ${d.visitor}${d.company ? ` (${d.company})` : ''}, here to see ${d.host}.` : `A guest for ${d.host} has arrived at ${d.site}.`,
    denied: (d: EventData, names: boolean) => `Access denied at door ${d.door} (${d.site}): ${REASONS.en[d.reason as keyof typeof REASONS.en] ?? d.reason}${names && d.employee ? `, ${d.employee}` : ''}.`,
    evacuation: (d: EventData) => `🚨 Evacuation started at ${d.site}: ${d.guests} guests and ${d.employees} employees who passed a door today. The roll call is in the console, under Evacuation.`,
    test: 'Test from the visitor log: if you can read this, the connection works.',
  },
};
const REASONS = {
  it: { UNKNOWN_CREDENTIAL: 'badge non riconosciuto', QR_INVALID: 'QR non valido', QR_EXPIRED: 'QR scaduto', EMPLOYEE_INACTIVE: 'dipendente non attivo', NOT_YET_VALID: 'non ancora valido', EXPIRED: 'validità scaduta', DOOR_INACTIVE: 'porta disattivata', NO_PERMISSION: 'nessun permesso', OUTSIDE_SCHEDULE: 'fuori orario', APP_DISABLED: 'porte non attive per questa persona' },
  es: { UNKNOWN_CREDENTIAL: 'credencial no reconocida', QR_INVALID: 'QR no válido', QR_EXPIRED: 'QR caducado', EMPLOYEE_INACTIVE: 'empleado inactivo', NOT_YET_VALID: 'aún no válido', EXPIRED: 'validez vencida', DOOR_INACTIVE: 'puerta desactivada', NO_PERMISSION: 'sin permiso', OUTSIDE_SCHEDULE: 'fuera de horario', APP_DISABLED: 'puertas no activas para esta persona' },
  en: { UNKNOWN_CREDENTIAL: 'badge not recognised', QR_INVALID: 'invalid QR', QR_EXPIRED: 'expired QR', EMPLOYEE_INACTIVE: 'employee inactive', NOT_YET_VALID: 'not valid yet', EXPIRED: 'validity ended', DOOR_INACTIVE: 'door turned off', NO_PERMISSION: 'no permission', OUTSIDE_SCHEDULE: 'outside allowed hours', APP_DISABLED: 'doors not turned on for this person' },
};

/**
 * Notifications to Microsoft Teams, Slack or any HTTPS endpoint. Events are written to an outbox in
 * the same transaction that produces them; a worker delivers them with retries, so a slow or broken
 * channel never slows down the tablet or the door.
 *
 * The address is chosen by an administrator, so it is checked against server-side request forgery:
 * HTTPS only, and the connection is refused if the name resolves to a private, loopback or
 * link-local address (cloud metadata), checked at connect time to defeat DNS rebinding.
 */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger('Webhooks');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectRepository(Webhook) private readonly hooks: Repository<Webhook>,
    @InjectRepository(WebhookDelivery) private readonly deliveries: Repository<WebhookDelivery>,
    private readonly keys: TenantKeysService,
  ) {}

  /** Throws BadRequest when the address cannot be used. */
  checkUrl(raw: string): URL {
    let u: URL;
    try { u = new URL(raw); } catch { throw new BadRequestException('WEBHOOK_URL_INVALID'); }
    const allowHttp = this.cfg.webhooks.allowPrivate;
    if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) throw new BadRequestException('WEBHOOK_URL_HTTPS');
    if (u.username || u.password) throw new BadRequestException('WEBHOOK_URL_INVALID');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!host) throw new BadRequestException('WEBHOOK_URL_INVALID');
    const internal = /^localhost$/i.test(host) || (isIP(host) !== 0 && isPrivateIp(host));
    if (internal && !this.cfg.webhooks.allowPrivate) throw new BadRequestException('WEBHOOK_URL_PRIVATE');
    return u;
  }

  /** Queues the event for every active webhook of the organisation that wants it (inside the caller's transaction). */
  async enqueue(em: EntityManager, tenantId: string, siteId: string, event: WebhookEvent, data: EventData) {
    const hooks = (await em.find(Webhook, { where: { tenantId, active: true } }))
      .filter((h) => h.events.split(',').includes(event) && (!h.siteId || h.siteId === siteId));
    if (!hooks.length) return;
    const tc = await this.keys.forTenant(tenantId);
    const payload = tc.encrypt(JSON.stringify({ event, at: new Date().toISOString(), data }), 'webhook.payload')!;
    for (const h of hooks) {
      await em.insert(WebhookDelivery, { tenantId, webhookId: h.id, event, payloadEnc: payload, status: 'PENDING', attempts: 0, nextAt: new Date() });
    }
  }

  /** Sends a test message now and reports the outcome (console "Send a test"). */
  async test(hook: Webhook, locale: string) {
    const tc = await this.keys.forTenant(hook.tenantId);
    const result = await this.send(hook, tc.decrypt(hook.urlEnc, 'webhook.url')!, tc.decrypt(hook.secretEnc, 'webhook.secret'), { event: 'test', at: new Date().toISOString(), data: { site: '', locale } });
    await this.hooks.update(hook.id, { lastResult: result, lastAt: new Date() });
    return result;
  }

  /** Worker: delivers what is due, with backoff. Returns how many were attempted. */
  async deliverDue(limit = 100) {
    const due = await this.deliveries.createQueryBuilder('d').where('d.status = :s AND d.nextAt <= :now', { s: 'PENDING', now: new Date() }).orderBy('d.nextAt', 'ASC').take(limit).getMany();
    for (const d of due) {
      const hook = await this.hooks.findOne({ where: { id: d.webhookId, tenantId: d.tenantId } });
      if (!hook || !hook.active) { await this.deliveries.update(d.id, { status: 'FAILED' }); continue; }
      const tc = await this.keys.forTenant(d.tenantId);
      const payload = JSON.parse(tc.decrypt(d.payloadEnc, 'webhook.payload')!);
      const result = await this.send(hook, tc.decrypt(hook.urlEnc, 'webhook.url')!, tc.decrypt(hook.secretEnc, 'webhook.secret'), payload);
      const attempts = d.attempts + 1;
      const ok = result === 'OK';
      await this.deliveries.update(d.id, {
        attempts, status: ok ? 'SENT' : attempts > BACKOFF_MIN.length ? 'FAILED' : 'PENDING',
        nextAt: new Date(Date.now() + (BACKOFF_MIN[attempts - 1] ?? 0) * 60_000),
      });
      await this.hooks.update(hook.id, { lastResult: result, lastAt: new Date() });
      if (!ok) this.log.warn(`Webhook ${hook.id} (${hook.urlHost}) ${result}, attempt ${attempts}`);
    }
    return due.length;
  }

  /** Body and headers for each kind. Visitor and employee names only when the webhook allows them. */
  render(hook: Pick<Webhook, 'kind' | 'includeNames'>, payload: { event: string; at: string; data: EventData }, secret: string | null) {
    const lang = (['it', 'es', 'en'].includes(payload.data.locale) ? payload.data.locale : 'en') as keyof typeof TEXT;
    const d = payload.data, names = hook.includeNames;
    const text = payload.event === 'visit.arrived' ? TEXT[lang].arrived(d, names) : payload.event === 'access.denied' ? TEXT[lang].denied(d, names) : payload.event === 'evacuation.started' ? TEXT[lang].evacuation(d) : TEXT[lang].test;
    if (hook.kind === 'slack') return { body: JSON.stringify({ text }), headers: {} as Record<string, string> };
    if (hook.kind === 'teams') {
      // Teams "Workflows" webhooks (the old Office 365 connectors are retired) expect an Adaptive Card.
      return { body: JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text, wrap: true }] } }] }), headers: {} as Record<string, string> };
    }
    const data = names ? d : { ...d, visitor: undefined, company: undefined, employee: undefined };
    const body = JSON.stringify({ event: payload.event, at: payload.at, text, data });
    const ts = String(Math.floor(Date.now() / 1000));
    return { body, headers: { 'X-DR-Timestamp': ts, 'X-DR-Signature': `sha256=${createHmac('sha256', secret ?? '').update(`${ts}.${body}`).digest('hex')}` } };
  }

  private async send(hook: Webhook, url: string, secret: string | null, payload: { event: string; at: string; data: EventData }): Promise<string> {
    let u: URL;
    try { u = this.checkUrl(url); } catch (e) { return (e as BadRequestException).message.slice(0, 60); }
    const { body, headers } = this.render(hook, payload, secret);
    const allowPrivate = this.cfg.webhooks.allowPrivate;
    // Checked when connecting, on every resolved address: a name cannot point inside after validation.
    const lookup = (hostname: string, options: object, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
      dnsLookup(hostname, options as never, (err: Error | null, address: string | LookupAddress[], family?: number) => {
        if (err) return cb(err, '');
        const all = Array.isArray(address) ? address.map((a) => a.address) : [address];
        if (!allowPrivate && all.some(isPrivateIp)) return cb(new Error('PRIVATE_ADDRESS'), '');
        cb(null, address, family);
      });
    };
    const req = u.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<string>((resolve) => {
      const r = req(u, { method: 'POST', lookup: lookup as never, timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json', 'User-Agent': 'digitalreception-webhook', ...headers } }, (res) => {
        res.resume(); // the answer is not needed; redirects are not followed
        resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? 'OK' : `HTTP_${res.statusCode}`);
      });
      r.on('timeout', () => { r.destroy(new Error('TIMEOUT')); });
      r.on('error', (e) => resolve(e.message === 'PRIVATE_ADDRESS' ? 'WEBHOOK_URL_PRIVATE' : e.message === 'TIMEOUT' ? 'TIMEOUT' : 'CONNECTION_FAILED'));
      r.end(body);
    });
  }
}
