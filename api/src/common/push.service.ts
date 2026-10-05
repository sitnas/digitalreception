import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { Employee, Host, PlatformSecret, PushDelivery, PushDevice, Tenant, type PushKind } from '../entities';
import { APP_CONFIG, AppConfig } from './app-config';
import { CryptoService } from './crypto.service';
import { withDbLock } from './db-lock';
import { TenantKeysService } from './tenant-keys.service';

const TIMEOUT_MS = 5_000;
/** Minutes before the next attempt; an arrival notice that is late by more than a few minutes is useless. */
const BACKOFF_MIN = [1, 3];
/** Browser push services a subscription may point to. Anything else would let a client make the server call any URL. */
const WEB_PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

export interface WebSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
export interface ArrivalData { site: string; visitor: string; company: string | null }
/** A parcel waiting at reception. `carrier` is a display name, null when unknown. */
export interface ParcelData { kind: 'parcel'; site: string; carrier: string | null; pieces: number }
type Payload = (ArrivalData & { kind?: 'arrival' }) | ParcelData;

const TEXT = {
  it: {
    title: 'È arrivato il tuo ospite',
    body: (d: ArrivalData, names: boolean) => names ? `${d.visitor}${d.company ? ` (${d.company})` : ''} ti aspetta in reception, sede di ${d.site}.` : `Ti aspetta in reception, sede di ${d.site}.`,
    testTitle: 'Notifiche attive', testBody: 'Quando arriva un tuo ospite te lo diciamo qui.',
    parcelTitle: (d: ParcelData) => (d.pieces > 1 ? `Ci sono ${d.pieces} pacchi per te` : 'C’è un pacco per te'),
    parcelBody: (d: ParcelData) => `Ritiralo in reception, sede di ${d.site}${d.carrier ? ` (${d.carrier})` : ''}.`,
  },
  es: {
    title: 'Ha llegado su visita',
    body: (d: ArrivalData, names: boolean) => names ? `${d.visitor}${d.company ? ` (${d.company})` : ''} le espera en recepción, sede de ${d.site}.` : `Le espera en recepción, sede de ${d.site}.`,
    testTitle: 'Avisos activados', testBody: 'Cuando llegue una visita suya, se lo diremos aquí.',
    parcelTitle: (d: ParcelData) => (d.pieces > 1 ? `Tiene ${d.pieces} paquetes` : 'Tiene un paquete'),
    parcelBody: (d: ParcelData) => `Recójalo en recepción, sede de ${d.site}${d.carrier ? ` (${d.carrier})` : ''}.`,
  },
  en: {
    title: 'Your guest has arrived',
    body: (d: ArrivalData, names: boolean) => names ? `${d.visitor}${d.company ? ` (${d.company})` : ''} is waiting at reception, ${d.site}.` : `Waiting at reception, ${d.site}.`,
    testTitle: 'Notifications on', testBody: 'When a guest of yours arrives, you will hear it here.',
    parcelTitle: (d: ParcelData) => (d.pieces > 1 ? `${d.pieces} parcels for you` : 'A parcel for you'),
    parcelBody: (d: ParcelData) => `Collect it at reception, ${d.site}${d.carrier ? ` (${d.carrier})` : ''}.`,
  },
};
const lang = (l: string) => (['it', 'es', 'en'].includes(l) ? l : 'en') as keyof typeof TEXT;

type SendResult = 'OK' | 'GONE' | 'RETRY';

/**
 * Tells an employee on their phone that their guest has arrived (or that a parcel is waiting): the Expo push service for the app,
 * Web Push for the /badge page. Like webhooks, arrivals go through an outbox written with the visit;
 * here the delivery is attempted right after the check-in commits, and the worker only retries.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  private vapidKeys?: Promise<{ publicKey: string; privateKey: string }>;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(PushDevice) private readonly devices: Repository<PushDevice>,
    @InjectRepository(PushDelivery) private readonly deliveries: Repository<PushDelivery>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly keys: TenantKeysService,
    private readonly crypto: CryptoService,
  ) {}

  /** VAPID key pair from the environment, or created once and kept (wrapped) in the database. */
  vapid() {
    this.vapidKeys ??= (async () => {
      if (this.cfg.push.vapid) return this.cfg.push.vapid;
      const repo = this.ds.getRepository(PlatformSecret);
      const wrap = () => this.crypto.wrapKey(Buffer.from(JSON.stringify(webpush.generateVAPIDKeys())), 'platform', 'vapid');
      let row = await repo.findOne({ where: { name: 'vapid' } });
      if (!row) {
        // Two replicas may race: the first insert wins and both read it back.
        await repo.createQueryBuilder().insert().orIgnore().values({ name: 'vapid', valueWrapped: wrap() }).execute();
        row = await repo.findOneOrFail({ where: { name: 'vapid' } });
      }
      try {
        return JSON.parse(this.crypto.unwrapKey(row.valueWrapped, 'platform', 'vapid').toString('utf8')) as { publicKey: string; privateKey: string };
      } catch {
        // Wrapped with a master key that is gone (removed without rewrap-keys): start over with a new pair.
        // Browsers subscribed with the old key subscribe again the next time the employee opens /badge.
        this.log.warn('Web Push key unreadable with the current MASTER_KEYS: generating a new one');
        await repo.update({ name: 'vapid' }, { valueWrapped: wrap() });
        row = await repo.findOneOrFail({ where: { name: 'vapid' } });
        return JSON.parse(this.crypto.unwrapKey(row.valueWrapped, 'platform', 'vapid').toString('utf8')) as { publicKey: string; privateKey: string };
      }
    })();
    this.vapidKeys.catch(() => { this.vapidKeys = undefined; });
    return this.vapidKeys;
  }

  checkExpoToken(token: string) {
    if (!EXPO_TOKEN.test(token)) throw new BadRequestException('PUSH_TOKEN_INVALID');
  }

  checkWebSubscription(sub: WebSubscription) {
    let u: URL;
    try { u = new URL(sub.endpoint); } catch { throw new BadRequestException('PUSH_ENDPOINT_INVALID'); }
    if (this.cfg.push.allowAnyEndpoint) return;
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !WEB_PUSH_HOSTS.some((r) => r.test(u.hostname))) throw new BadRequestException('PUSH_ENDPOINT_INVALID');
  }

  /** Expo token, or the endpoint of a Web Push subscription. */
  targetHash(kind: PushKind, tokenOrEndpoint: string) {
    return this.crypto.sha256(`${kind}|${tokenOrEndpoint}`);
  }

  /** Registers this phone or browser for the employee. The same device moving to another employee follows the last one. */
  async register(employee: { id: string; tenantId: string }, kind: PushKind, target: string, locale: string) {
    const tc = await this.keys.forTenant(employee.tenantId);
    const targetHash = this.targetHash(kind, kind === 'web' ? (JSON.parse(target) as WebSubscription).endpoint : target);
    await this.devices.delete({ targetHash });
    const d = await this.devices.save(this.devices.create({ tenantId: employee.tenantId, employeeId: employee.id, kind, targetHash, targetEnc: tc.encrypt(target, 'push.target')!, locale: lang(locale) }));
    return d;
  }

  async unregister(employee: { id: string; tenantId: string }, kind: PushKind, endpointOrToken: string) {
    await this.devices.delete({ tenantId: employee.tenantId, employeeId: employee.id, targetHash: this.targetHash(kind, endpointOrToken) });
  }

  /** Every phone and browser of the employee stops receiving (badge revoked, employee deleted, new phone). */
  forget(em: EntityManager | null, tenantId: string, employeeId: string) {
    return (em ?? this.ds.manager).delete(PushDevice, { tenantId, employeeId });
  }

  /** Inside the check-in transaction: queues a notice for the employee behind the host, if they have a device. */
  async enqueueArrival(em: EntityManager, tenantId: string, hostId: string | null, data: ArrivalData) {
    if (!hostId) return false;
    const host = await em.findOne(Host, { where: { id: hostId, tenantId }, select: { id: true, employeeId: true } });
    if (!host?.employeeId) return false;
    const employee = await em.findOne(Employee, { where: { id: host.employeeId, tenantId, active: true }, select: { id: true } });
    if (!employee || !(await em.exists(PushDevice, { where: { tenantId, employeeId: employee.id } }))) return false;
    const tc = await this.keys.forTenant(tenantId);
    await em.insert(PushDelivery, { tenantId, employeeId: employee.id, payloadEnc: tc.encrypt(JSON.stringify(data), 'push.payload')!, status: 'PENDING', attempts: 0, nextAt: new Date() });
    return true;
  }

  /** Inside the parcel transaction: queues "a parcel for you" for the employee, if they have a device. */
  async enqueueParcel(em: EntityManager, tenantId: string, employeeId: string, data: Omit<ParcelData, 'kind'>) {
    if (!(await em.exists(PushDevice, { where: { tenantId, employeeId } }))) return false;
    const tc = await this.keys.forTenant(tenantId);
    await em.insert(PushDelivery, { tenantId, employeeId, payloadEnc: tc.encrypt(JSON.stringify({ kind: 'parcel', ...data }), 'push.payload')!, status: 'PENDING', attempts: 0, nextAt: new Date() });
    return true;
  }

  /** Called after the check-in commits: deliver now instead of waiting for the next worker run. */
  kick() {
    withDbLock(this.ds, 'push-outbox', async () => { await this.deliverDue(); })
      .catch((e) => this.log.error(`Push delivery failed: ${(e as Error).message}`));
  }

  /** Worker: sends what is due to every device of the employee. Returns how many deliveries were handled. */
  async deliverDue(limit = 100) {
    const due = await this.deliveries.createQueryBuilder('d').where('d.status = :s AND d.nextAt <= :now', { s: 'PENDING', now: new Date() }).orderBy('d.nextAt', 'ASC').take(limit).getMany();
    for (const d of due) {
      const tc = await this.keys.forTenant(d.tenantId);
      const data = JSON.parse(tc.decrypt(d.payloadEnc, 'push.payload')!) as Payload;
      const tenant = await this.tenants.findOne({ where: { id: d.tenantId }, select: { id: true, pushIncludeNames: true } });
      const devices = await this.devices.find({ where: { tenantId: d.tenantId, employeeId: d.employeeId } });
      const results = await Promise.all(devices.map((dev) => {
        const t = TEXT[lang(dev.locale)];
        const target = tc.decrypt(dev.targetEnc, 'push.target')!;
        return data.kind === 'parcel' ? this.send(dev, target, t.parcelTitle(data), t.parcelBody(data))
          : this.send(dev, target, t.title, t.body(data, !!tenant?.pushIncludeNames));
      }));
      const attempts = d.attempts + 1;
      const retry = results.includes('RETRY') && !results.includes('OK');
      await this.deliveries.update(d.id, {
        attempts, status: !retry ? 'SENT' : attempts > BACKOFF_MIN.length ? 'FAILED' : 'PENDING',
        nextAt: new Date(Date.now() + (BACKOFF_MIN[attempts - 1] ?? 0) * 60_000),
      });
    }
    return due.length;
  }

  /** "Send a test" from the app or the page: tells the employee at once whether this device receives. */
  async test(device: PushDevice) {
    const tc = await this.keys.forTenant(device.tenantId);
    const t = TEXT[lang(device.locale)];
    return this.send(device, tc.decrypt(device.targetEnc, 'push.target')!, t.testTitle, t.testBody);
  }

  private async send(device: PushDevice, target: string, title: string, body: string): Promise<SendResult> {
    const result = device.kind === 'expo' ? await this.sendExpo(target, title, body) : await this.sendWeb(target, title, body);
    if (result === 'GONE') await this.devices.delete(device.id);
    if (result === 'RETRY') this.log.warn(`Push to ${device.kind} device ${device.id} failed`);
    return result;
  }

  private async sendExpo(token: string, title: string, body: string): Promise<SendResult> {
    try {
      const res = await fetch(this.cfg.push.expoUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(this.cfg.push.expoAccessToken ? { Authorization: `Bearer ${this.cfg.push.expoAccessToken}` } : {}) },
        body: JSON.stringify([{ to: token, title, body, sound: 'default', priority: 'high', channelId: 'arrivals' }]),
      });
      if (!res.ok) return 'RETRY';
      const ticket = ((await res.json()) as { data?: { status: string; details?: { error?: string } }[] }).data?.[0];
      if (ticket?.status === 'ok') return 'OK';
      return ticket?.details?.error === 'DeviceNotRegistered' ? 'GONE' : 'RETRY';
    } catch { return 'RETRY'; }
  }

  private async sendWeb(subscriptionJson: string, title: string, body: string): Promise<SendResult> {
    const sub = JSON.parse(subscriptionJson) as WebSubscription;
    try { this.checkWebSubscription(sub); } catch { return 'GONE'; }
    try {
      const vapid = await this.vapid();
      // web-push only builds the encrypted request; sending it ourselves keeps the timeout and no-redirect rules.
      const r = webpush.generateRequestDetails(sub, JSON.stringify({ title, body, url: '/badge' }), {
        vapidDetails: { subject: this.cfg.push.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 900, urgency: 'high',
      });
      const res = await fetch(r.endpoint, { method: r.method, headers: r.headers as Record<string, string>, body: r.body as Buffer, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status >= 200 && res.status < 300) return 'OK';
      return res.status === 404 || res.status === 410 ? 'GONE' : 'RETRY';
    } catch { return 'RETRY'; }
  }
}
