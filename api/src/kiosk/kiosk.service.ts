import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { FilesService } from '../common/files.service';
import { MailService } from '../common/mail.service';
import { AppRequest, AuthDevice, AuthTenant } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { addDays } from '../common/time.util';
import { CountryPolicy, Device, FileKind, Host, NoticeEmailStatus, PairingCode, PrivacyNotice, Site, Tenant, Visit, VisitStatus } from '../entities';
import { CheckInDto, CheckOutDto } from './kiosk.dto';

const MAX_KIOSK_HOSTS = 2000;

/** Fills runtime placeholders so the text always matches the configured policy. */
/** The document request always includes its photo; the photo can also be requested on its own. */
export const documentPhotoRequired = (p: CountryPolicy) => p.documentDataEnabled || p.documentPhotoEnabled;

export function renderNotice(body: string, policy: CountryPolicy): string {
  return body.split('{{visitRetentionDays}}').join(String(policy.visitRetentionDays));
}

@Injectable()
export class KioskService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(CountryPolicy) private readonly policies: Repository<CountryPolicy>,
    @InjectRepository(PrivacyNotice) private readonly notices: Repository<PrivacyNotice>,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(PairingCode) private readonly codes: Repository<PairingCode>,
    @InjectRepository(Host) private readonly hosts: Repository<Host>,
    private readonly crypto: CryptoService,
    private readonly keys: TenantKeysService,
    private readonly files: FilesService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async pair(tenant: AuthTenant, code: string, req: AppRequest) {
    const pc = await this.codes.findOne({ where: { tenantId: tenant.id, codeHash: this.crypto.sha256(code), usedAt: IsNull(), expiresAt: MoreThan(new Date()) } });
    if (!pc) {
      await this.audit.fromRequest(req, { action: 'DEVICE_PAIR_FAILED' });
      throw new UnauthorizedException('PAIRING_CODE_INVALID');
    }
    const token = this.crypto.randomToken(32);
    const device = await this.ds.transaction(async (em) => {
      const res = await em.update(PairingCode, { id: pc.id, usedAt: IsNull() }, { usedAt: new Date() });
      if (!res.affected) throw new UnauthorizedException('PAIRING_CODE_INVALID'); // concurrent use
      return em.save(em.create(Device, { tenantId: tenant.id, siteId: pc.siteId, name: pc.deviceName, tokenHash: this.crypto.sha256(token), createdBy: pc.createdBy, lastSeenAt: new Date() }));
    });
    req.device = { id: device.id, tenantId: tenant.id, name: device.name, siteId: device.siteId };
    await this.audit.fromRequest(req, { action: 'DEVICE_PAIRED', entityType: 'device', entityId: device.id, siteId: device.siteId });
    return { deviceToken: token, deviceName: device.name };
  }

  private async siteAndPolicy(device: AuthDevice) {
    const site = await this.sites.findOne({ where: { id: device.siteId, tenantId: device.tenantId } });
    if (!site || !site.active) throw new UnauthorizedException('SITE_INACTIVE');
    const policy = await this.policies.findOneOrFail({ where: { tenantId: device.tenantId, countryCode: site.countryCode } });
    return { site, policy };
  }

  private latestNotice(tenantId: string, countryCode: string, locale: string) {
    return this.notices.findOne({ where: { tenantId, countryCode, locale }, order: { version: 'DESC' } });
  }

  /** Active hosts of the tablet's site. Only name and profile go to the tablet, never contact details. */
  private siteHosts(device: AuthDevice) {
    return this.hosts.createQueryBuilder('h')
      .innerJoin('h.sites', 's', 's.id = :siteId', { siteId: device.siteId })
      .where('h.tenantId = :tid AND h.active = :active', { tid: device.tenantId, active: true })
      .orderBy('h.lastName', 'ASC').addOrderBy('h.firstName', 'ASC')
      .take(MAX_KIOSK_HOSTS)
      .getMany();
  }

  async config(device: AuthDevice) {
    const { site, policy } = await this.siteAndPolicy(device);
    const tenant = await this.tenants.findOneOrFail({ where: { id: device.tenantId }, select: { id: true, name: true, logoDataUrl: true } });
    const notices: Record<string, { id: string; version: number; title: string; body: string }> = {};
    for (const locale of policy.locales) {
      const n = await this.latestNotice(device.tenantId, site.countryCode, locale);
      if (n) notices[locale] = { id: n.id, version: n.version, title: n.title, body: renderNotice(n.body, policy) };
    }
    return {
      organisation: { name: tenant.name, logo: tenant.logoDataUrl },
      device: { name: device.name },
      site: { name: site.name, countryCode: site.countryCode, timezone: site.timezone },
      policy: {
        locales: policy.locales.filter((l) => notices[l]), defaultLocale: policy.defaultLocale,
        documentDataEnabled: policy.documentDataEnabled, documentPhotoEnabled: documentPhotoRequired(policy), assetPhotosRequired: policy.assetPhotosRequired,
      },
      notices,
      hosts: (await this.siteHosts(device)).map((h) => ({ id: h.id, firstName: h.firstName, lastName: h.lastName, department: h.department, jobTitle: h.jobTitle })),
      emailAvailable: this.mail.enabled,
    };
  }

  async checkIn(device: AuthDevice, dto: CheckInDto, req: AppRequest) {
    const { site, policy } = await this.siteAndPolicy(device);

    // Only the current notice version can be accepted: a tablet showing stale text must reload.
    const notice = await this.latestNotice(device.tenantId, site.countryCode, dto.locale);
    if (!notice || notice.id !== dto.privacyNoticeId) throw new ConflictException('NOTICE_OUTDATED');

    // Server-side data minimisation: fields not allowed by the country policy are discarded, never stored.
    if (policy.documentDataEnabled && (!dto.documentType || !dto.documentNumber)) throw new BadRequestException('DOCUMENT_REQUIRED');
    if (documentPhotoRequired(policy) && !dto.documentPhoto) throw new BadRequestException('DOCUMENT_PHOTO_REQUIRED');
    if (policy.assetPhotosRequired && !dto.assetPhoto) throw new BadRequestException('ASSET_PHOTO_REQUIRED');
    if (dto.sendNoticeEmail && !dto.email) throw new BadRequestException('EMAIL_REQUIRED');

    // When the site has a host directory the visitor must pick from it; free text is accepted only without one.
    const directory = await this.siteHosts(device);
    let hostName: string;
    let hostId: string | null = null;
    if (directory.length) {
      const host = dto.hostId ? directory.find((h) => h.id === dto.hostId) : undefined;
      if (!host) throw new BadRequestException(dto.hostId ? 'HOST_NOT_FOUND' : 'HOST_REQUIRED');
      hostName = `${host.firstName} ${host.lastName}`;
      hostId = host.id;
    } else {
      if (!dto.host) throw new BadRequestException('HOST_REQUIRED');
      hostName = dto.host;
    }

    const signature = this.files.parseImage(dto.signature, 'signature');
    const docPhoto = documentPhotoRequired(policy) && dto.documentPhoto ? this.files.parseImage(dto.documentPhoto, 'documentPhoto') : null;
    const assetPhoto = policy.assetPhotosRequired && dto.assetPhoto ? this.files.parseImage(dto.assetPhoto, 'assetPhoto') : null;

    const tc = await this.keys.forTenant(device.tenantId);
    const now = new Date();
    const wantsEmail = dto.sendNoticeEmail && this.mail.enabled;
    // Whoever leaves an email address receives the exit badge (visit code) there.
    const wantsBadge = !!dto.email && this.mail.enabled;

    const visit = await this.ds.transaction(async (em) => {
      const saved = await em.save(em.create(Visit, {
        tenantId: device.tenantId, siteId: site.id, status: VisitStatus.OPEN, code: await this.uniqueCode(device.tenantId, site.id),
        checkInAt: now, checkOutAt: null, checkInDeviceId: device.id, checkOutBy: null,
        firstNameEnc: tc.encrypt(dto.firstName, 'visit.firstName'),
        lastNameEnc: tc.encrypt(dto.lastName, 'visit.lastName'),
        lastNameIndex: tc.blindIndex(dto.lastName, 'visit.lastName'),
        companyEnc: tc.encrypt(dto.company, 'visit.company'),
        emailEnc: tc.encrypt(dto.email, 'visit.email'),
        emailIndex: tc.blindIndex(dto.email, 'visit.email'),
        hostEnc: tc.encrypt(hostName, 'visit.host'),
        hostId,
        purpose: dto.purpose,
        travelDistance: dto.travelDistance,
        documentType: policy.documentDataEnabled ? dto.documentType! : null,
        documentNumberEnc: policy.documentDataEnabled ? tc.encrypt(dto.documentNumber, 'visit.documentNumber') : null,
        locale: dto.locale, privacyNoticeId: notice.id, privacyNoticeVersion: notice.version, privacyAcceptedAt: now,
        // PENDING = queued in the transactional outbox; the mail worker delivers it (retries survive restarts).
        noticeEmailStatus: dto.sendNoticeEmail ? (wantsEmail ? NoticeEmailStatus.PENDING : NoticeEmailStatus.SKIPPED) : NoticeEmailStatus.NOT_REQUESTED,
        noticeEmailAttempts: 0,
        badgeEmailStatus: dto.email ? (wantsBadge ? NoticeEmailStatus.PENDING : NoticeEmailStatus.SKIPPED) : NoticeEmailStatus.NOT_REQUESTED,
        badgeEmailAttempts: 0, anonymizedAt: null,
      }));
      await this.files.store(em, tc, saved.id, FileKind.SIGNATURE, signature, addDays(now, policy.visitRetentionDays));
      if (docPhoto) await this.files.store(em, tc, saved.id, FileKind.DOCUMENT, docPhoto, addDays(now, Math.min(policy.documentPhotoRetentionDays, policy.visitRetentionDays)));
      if (assetPhoto) await this.files.store(em, tc, saved.id, FileKind.ASSET_IN, assetPhoto, addDays(now, Math.min(policy.assetPhotoRetentionDays, policy.visitRetentionDays)));
      return saved;
    });

    await this.audit.fromRequest(req, {
      action: 'VISIT_CHECK_IN', entityType: 'visit', entityId: visit.id, siteId: site.id,
      details: { noticeVersion: notice.version, locale: dto.locale, documentPhoto: !!docPhoto, assetPhoto: !!assetPhoto, hostId, travelDistance: dto.travelDistance },
    });
    return { code: visit.code, checkInAt: visit.checkInAt, emailQueued: wantsEmail, badgeEmailQueued: wantsBadge };
  }

  private async uniqueCode(tenantId: string, siteId: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = this.crypto.randomCode(5);
      if (!(await this.visits.exist({ where: { tenantId, siteId, code, status: VisitStatus.OPEN } }))) return code;
    }
    throw new ConflictException('Could not allocate a visit code');
  }

  /**
   * Check-out lookup. Never lists everyone on site: the visitor types the code or at least
   * the first two letters of the surname, and only "Name S." is returned.
   */
  async findOpen(device: AuthDevice, q: string) {
    const { policy } = await this.siteAndPolicy(device);
    const tc = await this.keys.forTenant(device.tenantId);
    const scope = { tenantId: device.tenantId, siteId: device.siteId, status: VisitStatus.OPEN };
    const query = q.trim();
    let matches = /^[A-Za-z0-9]{5}$/.test(query) ? await this.visits.find({ where: { ...scope, code: query.toUpperCase() } }) : [];
    if (!matches.length) {
      const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const open = await this.visits.find({ where: scope, order: { checkInAt: 'DESC' }, take: 500 });
      matches = open.filter((v) => norm(tc.decrypt(v.lastNameEnc, 'visit.lastName') ?? '').startsWith(norm(query)));
    }
    return matches.slice(0, 8).map((v) => {
      const first = tc.decrypt(v.firstNameEnc, 'visit.firstName') ?? '';
      const last = tc.decrypt(v.lastNameEnc, 'visit.lastName') ?? '';
      return { id: v.id, label: `${first} ${last.charAt(0)}.`, checkInAt: v.checkInAt, assetPhotoRequired: policy.assetPhotosRequired };
    });
  }

  async checkOut(device: AuthDevice, visitId: string, dto: CheckOutDto, req: AppRequest) {
    const { policy } = await this.siteAndPolicy(device);
    const visit = await this.visits.findOne({ where: { id: visitId, tenantId: device.tenantId, siteId: device.siteId } });
    if (!visit) throw new NotFoundException();
    if (visit.status !== VisitStatus.OPEN) throw new ConflictException('VISIT_ALREADY_CLOSED');
    if (policy.assetPhotosRequired && !dto.assetPhoto) throw new BadRequestException('ASSET_PHOTO_REQUIRED');
    const photo = policy.assetPhotosRequired && dto.assetPhoto ? this.files.parseImage(dto.assetPhoto, 'assetPhoto') : null;
    const tc = await this.keys.forTenant(device.tenantId);
    const now = new Date();

    await this.ds.transaction(async (em) => {
      const res = await em.update(Visit, { id: visit.id, tenantId: device.tenantId, status: VisitStatus.OPEN }, { status: VisitStatus.CLOSED, checkOutAt: now, checkOutBy: `device:${device.name}`.slice(0, 80) });
      if (!res.affected) throw new ConflictException('VISIT_ALREADY_CLOSED');
      if (photo) await this.files.store(em, tc, visit.id, FileKind.ASSET_OUT, photo, addDays(visit.checkInAt, Math.min(policy.assetPhotoRetentionDays, policy.visitRetentionDays)));
    });
    await this.audit.fromRequest(req, { action: 'VISIT_CHECK_OUT', entityType: 'visit', entityId: visit.id, siteId: visit.siteId, details: { assetPhoto: !!photo } });
    return { ok: true, checkOutAt: now };
  }
}
