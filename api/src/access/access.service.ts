import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { CryptoService } from '../common/crypto.service';
import { MailService } from '../common/mail.service';
import { TenantKeysService } from '../common/tenant-keys.service';
import { AccessEvent, AccessMethod, AccessResult, AccessRule, Door, Employee, Site, Tenant } from '../entities';

/** Phone badge QR: DRE1:<employeeId>.<time step>.<signature>; a new code every QR_STEP_S seconds. */
export const QR_PREFIX = 'DRE1:';
export const QR_STEP_S = 30;
const QR_SIG_HEX = 16;
/** Codes up to this many steps old are reported as "expired" (a photo or screenshot), older ones as invalid. */
const QR_EXPIRED_WINDOW = 20;
const LOGIN_CODE_TTL_MIN = 10;
const LOGIN_CODE_MAX_ATTEMPTS = 5;

export interface PermissionInput { door: string; days?: number[]; from?: string; to?: string }
export interface EmployeeInput {
  firstName: string; lastName: string; email?: string | null; badgeUid?: string | null; active?: boolean;
  validFrom?: string | null; validUntil?: string | null; permissions: PermissionInput[];
}
export interface ReaderContext { id: string; tenantId: string; siteId: string; doorId: string }

/** NFC UIDs arrive as "04:A2:1B…", "04a21b…" or with dashes: compare them as bare upper-case hex. */
export const normaliseBadgeUid = (uid: string) => uid.toUpperCase().replace(/[^0-9A-F]/g, '');

export function qrSignature(secret: Buffer, employeeId: string, step: number): string {
  return createHmac('sha256', secret).update(`${employeeId}.${step}`).digest('hex').slice(0, QR_SIG_HEX);
}

/** Local weekday (1 = Monday) and minutes since midnight at the site. */
function localNow(date: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A rule allows the moment if the weekday matches and the time is inside [from, to); windows may cross midnight. */
export function ruleAllows(rule: Pick<AccessRule, 'days' | 'fromTime' | 'toTime'>, at: Date, timeZone: string): boolean {
  const { weekday, minutes } = localNow(at, timeZone);
  if (rule.days && !rule.days.split(',').map(Number).includes(weekday)) return false;
  if (!rule.fromTime || !rule.toTime) return true;
  const from = toMinutes(rule.fromTime), to = toMinutes(rule.toTime);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

@Injectable()
export class AccessService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Door) private readonly doors: Repository<Door>,
    @InjectRepository(AccessRule) private readonly rules: Repository<AccessRule>,
    @InjectRepository(AccessEvent) private readonly events: Repository<AccessEvent>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly keys: TenantKeysService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
  ) {}

  // ------------------------------------------------------------ sync from the external system

  async upsertDoor(tenantId: string, externalId: string, dto: { siteCode: string; name: string; active?: boolean }) {
    const site = await this.sites.findOne({ where: { tenantId, code: dto.siteCode } });
    if (!site) throw new BadRequestException('UNKNOWN_SITE');
    const existing = await this.doors.findOne({ where: { tenantId, externalId } });
    const door = existing ?? this.doors.create({ tenantId, externalId });
    Object.assign(door, { siteId: site.id, name: dto.name, active: dto.active ?? true });
    const saved = await this.doors.save(door);
    return { created: !existing, door: saved };
  }

  /** Creates or replaces an employee and all their permissions in one transaction (idempotent). */
  async upsertEmployee(tenantId: string, externalId: string, dto: EmployeeInput) {
    const doorIds = [...new Set(dto.permissions.map((p) => p.door))];
    const doors = doorIds.length ? await this.doors.find({ where: { tenantId, externalId: In(doorIds) } }) : [];
    const missing = doorIds.filter((d) => !doors.some((x) => x.externalId === d));
    if (missing.length) throw new BadRequestException({ message: 'UNKNOWN_DOOR', doors: missing });
    for (const p of dto.permissions) if ((p.from && !p.to) || (!p.from && p.to)) throw new BadRequestException('TIME_WINDOW_INCOMPLETE');
    const tc = await this.keys.forTenant(tenantId);
    const badge = dto.badgeUid ? normaliseBadgeUid(dto.badgeUid) : null;
    if (dto.badgeUid && (!badge || badge.length < 4)) throw new BadRequestException('INVALID_BADGE_UID');

    const badgeIndex = badge ? tc.blindIndex(badge, 'employee.badgeUid')! : null;
    return this.ds.transaction(async (em) => {
      const existing = await em.findOne(Employee, { where: { tenantId, externalId } });
      // One card, one person: otherwise the reader could not tell who is at the door.
      if (badgeIndex) {
        const owner = await em.findOne(Employee, { where: { tenantId, badgeIndex }, select: { id: true, externalId: true } });
        if (owner && owner.externalId !== externalId) throw new ConflictException({ message: 'BADGE_IN_USE', employee: owner.externalId });
      }
      const e = existing ?? em.create(Employee, { tenantId, externalId, credentialSecretEnc: null, credentialIssuedAt: null, loginCodeHash: null, loginCodeExpiresAt: null, loginCodeAttempts: 0 });
      const email = dto.email?.trim().toLowerCase() || null;
      Object.assign(e, {
        firstNameEnc: tc.encrypt(dto.firstName, 'employee.firstName'), lastNameEnc: tc.encrypt(dto.lastName, 'employee.lastName'),
        emailEnc: tc.encrypt(email, 'employee.email'), emailIndex: email ? tc.blindIndex(email, 'employee.email') : null,
        active: dto.active ?? true,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null, validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      });
      // undefined leaves the badge as is, null removes it
      if (dto.badgeUid !== undefined) Object.assign(e, { badgeIndex, badgeHint: badge ? badge.slice(-4) : null });
      const saved = await em.save(e);
      await em.delete(AccessRule, { tenantId, employeeId: saved.id });
      for (const p of dto.permissions) {
        await em.save(em.create(AccessRule, {
          tenantId, employeeId: saved.id, doorId: doors.find((d) => d.externalId === p.door)!.id,
          days: p.days?.length ? [...new Set(p.days)].sort().join(',') : null, fromTime: p.from ?? null, toTime: p.to ?? null,
        }));
      }
      return { created: !existing, employee: saved };
    });
  }

  /** Removes the employee and their permissions; past access events lose the link to the person. */
  async deleteEmployee(tenantId: string, externalId: string) {
    const e = await this.employees.findOne({ where: { tenantId, externalId } });
    if (!e) throw new NotFoundException('EMPLOYEE_NOT_FOUND');
    await this.ds.transaction(async (em) => {
      await em.delete(AccessRule, { tenantId, employeeId: e.id });
      await em.update(AccessEvent, { tenantId, employeeId: e.id }, { employeeId: null });
      await em.delete(Employee, { id: e.id });
    });
    return e;
  }

  // ------------------------------------------------------------ phone badge activation

  /** Sends a one-time code to the work email. The caller answers the same way whatever the result. */
  async requestLoginCode(tenantId: string, email: string, locale: string): Promise<{ result: 'SENT' | 'UNKNOWN_EMAIL' | 'EMAIL_DISABLED' | 'SEND_FAILED'; employeeId?: string }> {
    const tc = await this.keys.forTenant(tenantId);
    const e = await this.employees.findOne({ where: { tenantId, emailIndex: tc.blindIndex(email.trim().toLowerCase(), 'employee.email')!, active: true } });
    if (!e) return { result: 'UNKNOWN_EMAIL' };
    if (!this.mail.enabled) return { result: 'EMAIL_DISABLED', employeeId: e.id };
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.employees.update(e.id, { loginCodeHash: this.crypto.sha256(`${e.id}|${code}`), loginCodeExpiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MIN * 60_000), loginCodeAttempts: 0 });
    const tenant = await this.tenants.findOneOrFail({ where: { id: tenantId }, select: { id: true, name: true, primaryColor: true } });
    const ok = await this.mail.sendBadgeCode(email, tenant.name, { locale, code, firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName') ?? '', minutes: LOGIN_CODE_TTL_MIN, primaryColor: tenant.primaryColor });
    return { result: ok ? 'SENT' : 'SEND_FAILED', employeeId: e.id };
  }

  /** Checks the code and issues a new QR secret for this phone (any previous phone stops working). */
  async activateBadge(tenantId: string, email: string, code: string) {
    const tc = await this.keys.forTenant(tenantId);
    const e = await this.employees.findOne({ where: { tenantId, emailIndex: tc.blindIndex(email.trim().toLowerCase(), 'employee.email')!, active: true, loginCodeExpiresAt: MoreThan(new Date()) } });
    if (!e || !e.loginCodeHash || e.loginCodeAttempts >= LOGIN_CODE_MAX_ATTEMPTS) throw new BadRequestException('CODE_INVALID');
    const ok = timingSafeEqual(Buffer.from(e.loginCodeHash), Buffer.from(this.crypto.sha256(`${e.id}|${code}`)));
    if (!ok) {
      await this.employees.increment({ id: e.id }, 'loginCodeAttempts', 1);
      throw new BadRequestException('CODE_INVALID');
    }
    const secret = randomBytes(32);
    await this.employees.update(e.id, { credentialSecretEnc: tc.encrypt(secret.toString('base64'), 'employee.credentialSecret'), credentialIssuedAt: new Date(), loginCodeHash: null, loginCodeExpiresAt: null, loginCodeAttempts: 0 });
    const tenant = await this.tenants.findOneOrFail({ where: { id: tenantId }, select: { id: true, name: true } });
    return {
      employeeId: e.id, secret: secret.toString('base64'), step: QR_STEP_S, organisation: tenant.name,
      firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'),
    };
  }

  // ------------------------------------------------------------ verification at the door

  /** Identifies the employee from a QR or an NFC UID, applies validity and permissions, logs the attempt. */
  async verify(reader: ReaderContext, input: { qr?: string; nfc?: string }, now = new Date()) {
    const method = input.qr ? AccessMethod.QR : AccessMethod.NFC;
    const tc = await this.keys.forTenant(reader.tenantId);
    let employee: Employee | null = null;
    let reason: string | null = null;

    if (input.qr) {
      const m = new RegExp(`^${QR_PREFIX}([0-9a-f-]{36})\\.(\\d{1,12})\\.([0-9a-f]{${QR_SIG_HEX}})$`).exec(input.qr.trim());
      if (!m) reason = 'QR_INVALID';
      else {
        employee = await this.employees.findOne({ where: { id: m[1], tenantId: reader.tenantId } });
        const secretB64 = employee && tc.decrypt(employee.credentialSecretEnc, 'employee.credentialSecret');
        if (!employee || !secretB64) { reason = 'UNKNOWN_CREDENTIAL'; employee = null; }
        else {
          const secret = Buffer.from(secretB64, 'base64');
          const step = Math.floor(now.getTime() / 1000 / QR_STEP_S);
          const claimed = Number(m[2]);
          const sigOk = timingSafeEqual(Buffer.from(qrSignature(secret, employee.id, claimed)), Buffer.from(m[3]));
          if (!sigOk) reason = 'QR_INVALID';
          else if (claimed > step + 1) reason = 'QR_INVALID';
          else if (claimed < step - 1) reason = step - claimed <= QR_EXPIRED_WINDOW ? 'QR_EXPIRED' : 'QR_INVALID';
        }
      }
    } else {
      const uid = normaliseBadgeUid(input.nfc ?? '');
      employee = uid.length >= 4 ? await this.employees.findOne({ where: { tenantId: reader.tenantId, badgeIndex: tc.blindIndex(uid, 'employee.badgeUid')! } }) : null;
      if (!employee) reason = 'UNKNOWN_CREDENTIAL';
    }

    const door = await this.doors.findOneOrFail({ where: { id: reader.doorId, tenantId: reader.tenantId } });
    const site = await this.sites.findOneOrFail({ where: { id: door.siteId, tenantId: reader.tenantId } });
    if (!reason && employee) {
      if (!employee.active) reason = 'EMPLOYEE_INACTIVE';
      else if (employee.validFrom && now < employee.validFrom) reason = 'NOT_YET_VALID';
      else if (employee.validUntil && now >= employee.validUntil) reason = 'EXPIRED';
      else if (!door.active) reason = 'DOOR_INACTIVE';
      else {
        const rules = await this.rules.find({ where: { tenantId: reader.tenantId, employeeId: employee.id, doorId: door.id } });
        if (!rules.length) reason = 'NO_PERMISSION';
        else if (!rules.some((r) => ruleAllows(r, now, site.timezone))) reason = 'OUTSIDE_SCHEDULE';
      }
    }

    const result = reason ? AccessResult.DENIED : AccessResult.GRANTED;
    await this.events.save(this.events.create({
      tenantId: reader.tenantId, siteId: door.siteId, doorId: door.id, readerId: reader.id,
      employeeId: employee?.id ?? null, method, result, reason: reason ?? 'OK', at: now,
    }));
    const first = employee && tc.decrypt(employee.firstNameEnc, 'employee.firstName');
    const last = employee && tc.decrypt(employee.lastNameEnc, 'employee.lastName');
    // The reader shows who it recognised only to the person standing there: first name and initial.
    return { result, reason: reason ?? 'OK', name: first && last ? `${first} ${last.charAt(0)}.` : null, door: door.name, at: now };
  }

  // ------------------------------------------------------------ reads

  async eventsSince(tenantId: string, since: Date, limit: number) {
    const rows = await this.events.find({ where: { tenantId, at: MoreThan(since) }, order: { at: 'ASC' }, take: limit });
    const emp = new Map((await this.employees.find({ where: { tenantId, id: In([...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[]) }, select: { id: true, externalId: true } })).map((e) => [e.id, e.externalId]));
    const drs = new Map((await this.doors.find({ where: { tenantId, id: In([...new Set(rows.map((r) => r.doorId))]) }, select: { id: true, externalId: true } })).map((d) => [d.id, d.externalId]));
    return rows.map((r) => ({ id: r.id, at: r.at, door: drs.get(r.doorId) ?? null, employee: r.employeeId ? emp.get(r.employeeId) ?? null : null, method: r.method, result: r.result, reason: r.reason }));
  }
}
