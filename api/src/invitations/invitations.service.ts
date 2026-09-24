import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { CryptoService } from '../common/crypto.service';
import { inviteQrPayload, qrSvg } from '../common/exit-qr';
import { MailService } from '../common/mail.service';
import { AuthDevice, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { addDays, localDateToUtc, startOfLocalDay } from '../common/time.util';
import { CountryPolicy, Host, Invitation, InvitationStatus, NoticeEmailStatus, Site, VisitPurpose } from '../entities';

export const INVITE_CODE_LENGTH = 8;
const MAX_DAYS_AHEAD = 90;
/** Invitations disappear this many days after their day: enough to see "who did not come". */
export const INVITATION_KEEP_DAYS = 7;

export interface InvitationInput {
  siteId: string; hostId: string; date: string; time: string; firstName: string; lastName: string;
  company?: string | null; email: string; purpose: VisitPurpose; locale?: string;
}

/** Normalises what a person types or a QR carries: upper case, no separators. */
export const normaliseInviteCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Host) private readonly hosts: Repository<Host>,
    @InjectRepository(CountryPolicy) private readonly policies: Repository<CountryPolicy>,
    private readonly keys: TenantKeysService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
  ) {}

  /** Local day of the site that contains `at`, as [start, end). */
  private dayWindow(at: Date, timezone: string) {
    const from = startOfLocalDay(at, timezone);
    return { from, until: startOfLocalDay(new Date(from.getTime() + 36 * 3_600_000), timezone) };
  }

  /** People of a site who can be invited for: names only, contact details stay in the directory. */
  async hostsOf(user: AuthUser, siteId: string) {
    const hosts = await this.hosts.createQueryBuilder('h')
      .innerJoin('h.sites', 's', 's.id = :siteId', { siteId })
      .where('h.tenantId = :tid AND h.active = :active', { tid: user.tenantId, active: true })
      .orderBy('h.lastName', 'ASC').addOrderBy('h.firstName', 'ASC').getMany();
    return hosts.map((h) => ({ id: h.id, firstName: h.firstName, lastName: h.lastName, department: h.department }));
  }

  async create(user: AuthUser, dto: InvitationInput) {
    const site = await this.sites.findOne({ where: { id: dto.siteId, tenantId: user.tenantId, active: true } });
    if (!site) throw new NotFoundException('SITE_NOT_FOUND');
    const host = await this.hosts.createQueryBuilder('h')
      .innerJoin('h.sites', 's', 's.id = :siteId', { siteId: site.id })
      .where('h.id = :id AND h.tenantId = :tid AND h.active = :active', { id: dto.hostId, tid: user.tenantId, active: true })
      .getOne();
    if (!host) throw new BadRequestException('HOST_NOT_FOUND');
    const [hh, mm] = dto.time.split(':').map(Number);
    const midnight = localDateToUtc(dto.date, site.timezone);
    if (Number.isNaN(midnight.getTime())) throw new BadRequestException('INVALID_DATE');
    const expectedAt = new Date(midnight.getTime() + (hh * 60 + mm) * 60_000);
    const now = new Date();
    const { from, until } = this.dayWindow(expectedAt, site.timezone);
    if (until <= now) throw new BadRequestException('INVITATION_IN_PAST');
    if (expectedAt > addDays(now, MAX_DAYS_AHEAD)) throw new BadRequestException('INVITATION_TOO_FAR');
    const policy = await this.policies.findOneOrFail({ where: { tenantId: user.tenantId, countryCode: site.countryCode } });
    const locale = dto.locale && policy.locales.includes(dto.locale) ? dto.locale : policy.defaultLocale;

    const tc = await this.keys.forTenant(user.tenantId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.crypto.randomCode(INVITE_CODE_LENGTH);
      try {
        return await this.invitations.save(this.invitations.create({
          tenantId: user.tenantId, siteId: site.id, hostId: host.id, expectedAt, validFrom: from, validUntil: until,
          firstNameEnc: tc.encrypt(dto.firstName, 'invitation.firstName')!,
          lastNameEnc: tc.encrypt(dto.lastName, 'invitation.lastName')!,
          companyEnc: tc.encrypt(dto.company || null, 'invitation.company'),
          emailEnc: tc.encrypt(dto.email, 'invitation.email')!,
          purpose: dto.purpose, locale,
          codeHash: this.crypto.sha256(code), codeEnc: tc.encrypt(code, 'invitation.code')!,
          status: InvitationStatus.PENDING, visitId: null, usedAt: null,
          emailStatus: this.mail.enabled ? NoticeEmailStatus.PENDING : NoticeEmailStatus.SKIPPED, emailAttempts: 0,
          createdByUserId: user.id,
        }));
      } catch (e) {
        if (!/Duplicate entry/i.test((e as Error).message)) throw e; // code collision: try another
      }
    }
    throw new ConflictException('Could not allocate an invite code');
  }

  /** Upcoming (today and later) or past invitations of the sites the user can see. */
  async list(user: AuthUser, siteIds: string[] | undefined, scope: 'upcoming' | 'past') {
    const now = new Date();
    const rows = await this.invitations.find({
      where: {
        tenantId: user.tenantId,
        ...(siteIds ? { siteId: In(siteIds.length ? siteIds : ['00000000-0000-0000-0000-000000000000']) } : {}),
        validUntil: scope === 'upcoming' ? MoreThanOrEqual(now) : LessThan(now),
      },
      order: { expectedAt: scope === 'upcoming' ? 'ASC' : 'DESC' },
      take: 300,
    });
    if (!rows.length) return [];
    const tc = await this.keys.forTenant(user.tenantId);
    const hostIds = [...new Set(rows.map((r) => r.hostId))];
    const siteList = [...new Set(rows.map((r) => r.siteId))];
    const hosts = new Map((await this.hosts.find({ where: { tenantId: user.tenantId, id: In(hostIds) } })).map((h) => [h.id, h]));
    const sites = new Map((await this.sites.find({ where: { tenantId: user.tenantId, id: In(siteList) } })).map((s) => [s.id, s]));
    return rows.map((r) => ({
      id: r.id, siteId: r.siteId, siteName: sites.get(r.siteId)?.name ?? '—', timezone: sites.get(r.siteId)?.timezone ?? 'UTC',
      hostName: hosts.has(r.hostId) ? `${hosts.get(r.hostId)!.firstName} ${hosts.get(r.hostId)!.lastName}` : '—',
      expectedAt: r.expectedAt, purpose: r.purpose,
      firstName: tc.decrypt(r.firstNameEnc, 'invitation.firstName'), lastName: tc.decrypt(r.lastNameEnc, 'invitation.lastName'),
      company: tc.decrypt(r.companyEnc, 'invitation.company'), email: tc.decrypt(r.emailEnc, 'invitation.email'),
      status: r.status === InvitationStatus.PENDING && r.validUntil < now ? 'EXPIRED' : r.status,
      emailStatus: r.emailStatus, visitId: r.visitId, usedAt: r.usedAt,
    }));
  }

  private async own(user: AuthUser, id: string) {
    const inv = await this.invitations.findOne({ where: { id, tenantId: user.tenantId } });
    if (!inv) throw new NotFoundException();
    return inv;
  }

  private assertOpen(inv: Invitation) {
    if (inv.status !== InvitationStatus.PENDING) throw new ConflictException(inv.status === InvitationStatus.USED ? 'INVITATION_USED' : 'INVITATION_CANCELLED');
    if (inv.validUntil < new Date()) throw new ConflictException('INVITATION_EXPIRED');
  }

  async get(user: AuthUser, id: string) { return this.own(user, id); }

  async cancel(user: AuthUser, id: string) {
    const inv = await this.own(user, id);
    this.assertOpen(inv);
    await this.invitations.update({ id: inv.id, status: InvitationStatus.PENDING }, { status: InvitationStatus.CANCELLED });
    return inv;
  }

  async resend(user: AuthUser, id: string) {
    const inv = await this.own(user, id);
    this.assertOpen(inv);
    if (!this.mail.enabled) throw new ConflictException('EMAIL_DISABLED');
    await this.invitations.update({ id: inv.id }, { emailStatus: NoticeEmailStatus.PENDING, emailAttempts: 0 });
    return inv;
  }

  /** QR to show or print in the console, for guests who did not receive the email. */
  async qr(user: AuthUser, id: string) {
    const inv = await this.own(user, id);
    this.assertOpen(inv);
    const code = (await this.keys.forTenant(user.tenantId)).decrypt(inv.codeEnc, 'invitation.code')!;
    return { code, qrSvg: await qrSvg(inviteQrPayload(code)) };
  }

  /**
   * Tablet lookup: the invitation must belong to this site and be for today. Returns only what
   * the guest needs to confirm their own details.
   */
  async forKiosk(device: AuthDevice, rawCode: string) {
    const inv = await this.invitations.findOne({ where: { tenantId: device.tenantId, codeHash: this.crypto.sha256(normaliseInviteCode(rawCode)) } });
    this.assertUsableAt(inv, device);
    const tc = await this.keys.forTenant(device.tenantId);
    return {
      firstName: tc.decrypt(inv!.firstNameEnc, 'invitation.firstName'), lastName: tc.decrypt(inv!.lastNameEnc, 'invitation.lastName'),
      company: tc.decrypt(inv!.companyEnc, 'invitation.company'), email: tc.decrypt(inv!.emailEnc, 'invitation.email'),
      hostId: inv!.hostId, purpose: inv!.purpose, locale: inv!.locale, expectedAt: inv!.expectedAt,
    };
  }

  private assertUsableAt(inv: Invitation | null, device: AuthDevice): asserts inv is Invitation {
    if (!inv) throw new NotFoundException('INVITATION_NOT_FOUND');
    if (inv.siteId !== device.siteId) throw new ConflictException('INVITATION_OTHER_SITE');
    if (inv.status === InvitationStatus.USED) throw new ConflictException('INVITATION_USED');
    if (inv.status === InvitationStatus.CANCELLED) throw new NotFoundException('INVITATION_NOT_FOUND');
    const now = new Date();
    if (now < inv.validFrom || now >= inv.validUntil) throw new ConflictException('INVITATION_NOT_TODAY');
  }

  /** Marks the invitation used by this visit, inside the check-in transaction; one use only. */
  async consume(em: EntityManager, device: AuthDevice, rawCode: string, visitId: string) {
    const inv = await em.findOne(Invitation, { where: { tenantId: device.tenantId, codeHash: this.crypto.sha256(normaliseInviteCode(rawCode)) } });
    this.assertUsableAt(inv, device);
    const res = await em.update(Invitation, { id: inv.id, status: InvitationStatus.PENDING }, { status: InvitationStatus.USED, visitId, usedAt: new Date() });
    if (!res.affected) throw new ConflictException('INVITATION_USED');
    return inv;
  }
}
