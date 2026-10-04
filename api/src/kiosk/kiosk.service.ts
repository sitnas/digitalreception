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
import { exitQrSvg } from '../common/exit-qr';
import { InvitationsService } from '../invitations/invitations.service';
import { PushService } from '../common/push.service';
import { SiteDocumentsService } from '../common/site-documents.service';
import { WebhooksService } from '../common/webhooks.service';
import { CountryPolicy, Device, DocumentType, FileKind, Host, NoticeEmailStatus, PairingCode, PrivacyNotice, Site, StoredFile, Tenant, TravelDistance, Visit, VisitPurpose, VisitStatus } from '../entities';
import { CheckInDto, CheckOutDto, PreregisteredCheckInDto } from './kiosk.dto';

type Image = { mime: string; data: Buffer };
/** What the guest typed on the phone, kept encrypted on the invitation until arrival. */
export interface PreregistrationData {
  firstName: string; lastName: string; company: string | null; travelDistance: TravelDistance;
  documentType: DocumentType | null; documentNumber: string | null;
}
interface NewVisit {
  locale: string; firstName: string; lastName: string; company?: string; email?: string; sendNoticeEmail: boolean;
  hostId?: string; host?: string; purpose: VisitPurpose; travelDistance: TravelDistance; documentType?: DocumentType; documentNumber?: string;
  notice: { id: string; version: number }; acceptedAt: Date; documents: { documentId: string; versionId: string }[];
  signature: Image | null; documentPhoto: Image | null; assetPhoto: Image | null;
  invitationCode?: string; preregisteredFrom?: string;
}

const MAX_KIOSK_HOSTS = 2000;
/** A check-out surname search must be this specific: broader prefixes return nothing (anti-enumeration). */
const MAX_OPEN_MATCHES = 5;

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
    private readonly invitations: InvitationsService,
    private readonly webhooks: WebhooksService,
    private readonly push: PushService,
    private readonly documents: SiteDocumentsService,
  ) {}

  async pair(tenant: AuthTenant, code: string, req: AppRequest) {
    const pc = await this.codes.findOne({ where: { tenantId: tenant.id, codeHash: this.crypto.sha256(code), usedAt: IsNull(), expiresAt: MoreThan(new Date()), doorId: IsNull() } });
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
    const tenant = await this.tenants.findOneOrFail({ where: { id: device.tenantId }, select: { id: true, name: true, logoDataUrl: true, primaryColor: true, secondaryColor: true } });
    const notices: Record<string, { id: string; version: number; title: string; body: string }> = {};
    for (const locale of policy.locales) {
      const n = await this.latestNotice(device.tenantId, site.countryCode, locale);
      if (n) notices[locale] = { id: n.id, version: n.version, title: n.title, body: renderNotice(n.body, policy) };
    }
    const locales = policy.locales.filter((l) => notices[l]);
    return {
      organisation: { name: tenant.name, logo: tenant.logoDataUrl, primaryColor: tenant.primaryColor, secondaryColor: tenant.secondaryColor },
      device: { name: device.name },
      site: { name: site.name, countryCode: site.countryCode, timezone: site.timezone },
      policy: {
        locales, defaultLocale: policy.defaultLocale,
        documentDataEnabled: policy.documentDataEnabled, documentPhotoEnabled: documentPhotoRequired(policy), assetPhotosRequired: policy.assetPhotosRequired,
      },
      notices,
      documents: await this.documents.forSite(device.tenantId, site.id, locales, policy.defaultLocale),
      hosts: (await this.siteHosts(device)).map((h) => ({ id: h.id, firstName: h.firstName, lastName: h.lastName, department: h.department, jobTitle: h.jobTitle })),
      emailAvailable: this.mail.enabled,
    };
  }

  async checkIn(device: AuthDevice, dto: CheckInDto, req: AppRequest) {
    const { site, policy } = await this.siteAndPolicy(device);

    // Only the current notice version can be accepted: a tablet showing stale text must reload.
    const notice = await this.latestNotice(device.tenantId, site.countryCode, dto.locale);
    if (!notice || notice.id !== dto.privacyNoticeId) throw new ConflictException('NOTICE_OUTDATED');
    const documents = (await this.documents.forSite(device.tenantId, site.id, [dto.locale], policy.defaultLocale))[dto.locale];
    this.documents.assertAccepted(documents, dto.acceptedDocuments);

    // Server-side data minimisation: fields not allowed by the country policy are discarded, never stored.
    if (policy.documentDataEnabled && (!dto.documentType || !dto.documentNumber)) throw new BadRequestException('DOCUMENT_REQUIRED');
    if (documentPhotoRequired(policy) && !dto.documentPhoto) throw new BadRequestException('DOCUMENT_PHOTO_REQUIRED');
    if (policy.assetPhotosRequired && !dto.assetPhoto) throw new BadRequestException('ASSET_PHOTO_REQUIRED');
    if (dto.sendNoticeEmail && !dto.email) throw new BadRequestException('EMAIL_REQUIRED');

    return this.persist(device, site, policy, {
      locale: dto.locale, firstName: dto.firstName, lastName: dto.lastName, company: dto.company, email: dto.email,
      sendNoticeEmail: dto.sendNoticeEmail, hostId: dto.hostId, host: dto.host, purpose: dto.purpose, travelDistance: dto.travelDistance,
      documentType: dto.documentType, documentNumber: dto.documentNumber,
      notice: { id: notice.id, version: notice.version }, acceptedAt: new Date(),
      documents: documents.map((d) => ({ documentId: d.documentId, versionId: d.id })),
      signature: this.files.parseImage(dto.signature, 'signature'),
      documentPhoto: documentPhotoRequired(policy) && dto.documentPhoto ? this.files.parseImage(dto.documentPhoto, 'documentPhoto') : null,
      assetPhoto: policy.assetPhotosRequired && dto.assetPhoto ? this.files.parseImage(dto.assetPhoto, 'assetPhoto') : null,
      invitationCode: dto.invitationCode,
    }, req);
  }

  /**
   * The guest pre-registered from the phone: the tablet only confirms the arrival (and takes the
   * laptop serial photo where the policy asks for it). Details, signature and acceptances come from
   * the invitation; its files move to the visit.
   */
  async checkInPreregistered(device: AuthDevice, dto: PreregisteredCheckInDto, req: AppRequest) {
    const { site, policy } = await this.siteAndPolicy(device);
    const pre = await this.preregistration(device, site, policy, dto.invitationCode);
    if (!pre) throw new ConflictException('PREREGISTRATION_INCOMPLETE');
    if (policy.assetPhotosRequired && !dto.assetPhoto) throw new BadRequestException('ASSET_PHOTO_REQUIRED');
    const { inv, data } = pre;
    return this.persist(device, site, policy, {
      locale: inv.preLocale!, firstName: data.firstName, lastName: data.lastName, company: data.company ?? undefined, email: pre.email ?? undefined,
      sendNoticeEmail: false, hostId: inv.hostId, purpose: inv.purpose, travelDistance: data.travelDistance,
      documentType: policy.documentDataEnabled ? data.documentType ?? undefined : undefined,
      documentNumber: policy.documentDataEnabled ? data.documentNumber ?? undefined : undefined,
      notice: { id: inv.preNoticeId!, version: inv.preNoticeVersion! }, acceptedAt: inv.preregisteredAt!,
      documents: inv.preDocuments ?? [],
      signature: null, documentPhoto: null,
      assetPhoto: policy.assetPhotosRequired && dto.assetPhoto ? this.files.parseImage(dto.assetPhoto, 'assetPhoto') : null,
      invitationCode: dto.invitationCode, preregisteredFrom: inv.id,
    }, req);
  }

  /**
   * The stored pre-registration of an invitation, if it still covers what the site asks today
   * (documents added since, or a policy that now wants the identity document, send the guest
   * through the normal form with the details prefilled).
   */
  private async preregistration(device: AuthDevice, site: Site, policy: CountryPolicy, code: string) {
    const inv = await this.invitations.usable(device, code);
    if (!inv.preregisteredAt || !inv.preDataEnc || !inv.preLocale || !inv.preNoticeId) return null;
    const tc = await this.keys.forTenant(device.tenantId);
    const data = JSON.parse(tc.decrypt(inv.preDataEnc, 'invitation.preregistration') ?? '{}') as PreregistrationData;
    if (policy.documentDataEnabled && (!data.documentType || !data.documentNumber)) return null;
    const files = await this.ds.getRepository(StoredFile).find({ where: { tenantId: device.tenantId, invitationId: inv.id, purgedAt: IsNull() } });
    if (!files.some((f) => f.kind === FileKind.SIGNATURE)) return null;
    if (documentPhotoRequired(policy) && !files.some((f) => f.kind === FileKind.DOCUMENT)) return null;
    const required = (await this.documents.forSite(device.tenantId, site.id, [inv.preLocale], policy.defaultLocale))[inv.preLocale];
    if (!this.documents.covers(required, inv.preDocuments)) return null;
    return { inv, data, email: tc.decrypt(inv.emailEnc, 'invitation.email') };
  }

  /** Tablet lookup of an invitation, telling whether the guest already completed it from the phone. */
  async invitation(device: AuthDevice, code: string) {
    const { site, policy } = await this.siteAndPolicy(device);
    const out = await this.invitations.forKiosk(device, code);
    return { ...out, preregistered: !!(await this.preregistration(device, site, policy, code)) };
  }

  private async persist(device: AuthDevice, site: Site, policy: CountryPolicy, v: NewVisit, req: AppRequest) {
    // When the site has a host directory the visitor must pick from it; free text is accepted only without one.
    const directory = await this.siteHosts(device);
    let hostName: string;
    let hostId: string | null = null;
    let hostEmail: string | null = null;
    if (directory.length) {
      const host = v.hostId ? directory.find((h) => h.id === v.hostId) : undefined;
      if (!host) throw new BadRequestException(v.hostId ? 'HOST_NOT_FOUND' : 'HOST_REQUIRED');
      hostName = `${host.firstName} ${host.lastName}`;
      hostId = host.id;
      hostEmail = host.email;
    } else {
      if (!v.host) throw new BadRequestException('HOST_REQUIRED');
      hostName = v.host;
    }

    const tc = await this.keys.forTenant(device.tenantId);
    const now = new Date();
    const wantsEmail = v.sendNoticeEmail && this.mail.enabled;
    // Whoever leaves an email address receives the exit badge (visit code) there.
    const wantsBadge = !!v.email && this.mail.enabled;
    // The host picked from the directory is told that their visitor has arrived.
    const wantsHostNotice = !!hostEmail && this.mail.enabled;

    let pushQueued = false;
    let movedDocPhoto = false;
    const visit = await this.ds.transaction(async (em) => {
      const saved = await em.save(em.create(Visit, {
        tenantId: device.tenantId, siteId: site.id, status: VisitStatus.OPEN, code: await this.uniqueCode(device.tenantId, site.id),
        checkInAt: now, checkOutAt: null, checkInDeviceId: device.id, checkOutBy: null,
        firstNameEnc: tc.encrypt(v.firstName, 'visit.firstName'),
        lastNameEnc: tc.encrypt(v.lastName, 'visit.lastName'),
        lastNameIndex: tc.blindIndex(v.lastName, 'visit.lastName'),
        companyEnc: tc.encrypt(v.company, 'visit.company'),
        emailEnc: tc.encrypt(v.email, 'visit.email'),
        emailIndex: tc.blindIndex(v.email, 'visit.email'),
        hostEnc: tc.encrypt(hostName, 'visit.host'),
        hostId,
        purpose: v.purpose,
        travelDistance: v.travelDistance,
        documentType: policy.documentDataEnabled ? v.documentType! : null,
        documentNumberEnc: policy.documentDataEnabled ? tc.encrypt(v.documentNumber, 'visit.documentNumber') : null,
        locale: v.locale, privacyNoticeId: v.notice.id, privacyNoticeVersion: v.notice.version, privacyAcceptedAt: v.acceptedAt,
        // PENDING = queued in the transactional outbox; the mail worker delivers it (retries survive restarts).
        noticeEmailStatus: v.sendNoticeEmail ? (wantsEmail ? NoticeEmailStatus.PENDING : NoticeEmailStatus.SKIPPED) : NoticeEmailStatus.NOT_REQUESTED,
        noticeEmailAttempts: 0,
        badgeEmailStatus: v.email ? (wantsBadge ? NoticeEmailStatus.PENDING : NoticeEmailStatus.SKIPPED) : NoticeEmailStatus.NOT_REQUESTED,
        badgeEmailAttempts: 0,
        hostEmailStatus: hostEmail ? (wantsHostNotice ? NoticeEmailStatus.PENDING : NoticeEmailStatus.SKIPPED) : NoticeEmailStatus.NOT_REQUESTED,
        hostEmailAttempts: 0, anonymizedAt: null,
      }));
      if (v.signature) await this.files.store(em, tc, saved.id, FileKind.SIGNATURE, v.signature, addDays(now, policy.visitRetentionDays));
      if (v.documentPhoto) await this.files.store(em, tc, saved.id, FileKind.DOCUMENT, v.documentPhoto, addDays(now, Math.min(policy.documentPhotoRetentionDays, policy.visitRetentionDays)));
      if (v.preregisteredFrom) {
        // Signature and document photo taken on the phone now belong to the visit, with the visit's retention.
        const files = await em.find(StoredFile, { where: { tenantId: device.tenantId, invitationId: v.preregisteredFrom, purgedAt: IsNull() } });
        for (const f of files) {
          const keep = f.kind === FileKind.DOCUMENT ? (documentPhotoRequired(policy) ? Math.min(policy.documentPhotoRetentionDays, policy.visitRetentionDays) : 0) : policy.visitRetentionDays;
          await em.update(StoredFile, { id: f.id }, { visitId: saved.id, invitationId: null, purgeAfter: addDays(now, keep) });
          if (f.kind === FileKind.DOCUMENT && keep > 0) movedDocPhoto = true;
        }
      }
      if (v.assetPhoto) await this.files.store(em, tc, saved.id, FileKind.ASSET_IN, v.assetPhoto, addDays(now, Math.min(policy.assetPhotoRetentionDays, policy.visitRetentionDays)));
      await this.documents.record(em, device.tenantId, saved.id, v.documents, v.acceptedAt);
      if (v.invitationCode) await this.invitations.consume(em, device, v.invitationCode, saved.id);
      // Teams / Slack / HTTPS notification, queued with the visit: delivered by the outbox worker.
      await this.webhooks.enqueue(em, device.tenantId, site.id, 'visit.arrived', {
        site: site.name, locale: policy.defaultLocale, host: hostName,
        visitor: `${v.firstName} ${v.lastName}`, company: v.company || null,
      });
      // Push to the phone of the visited employee, if they turned it on in the app or on /badge.
      pushQueued = await this.push.enqueueArrival(em, device.tenantId, hostId, { site: site.name, visitor: `${v.firstName} ${v.lastName}`, company: v.company || null });
      return saved;
    });
    if (pushQueued) this.push.kick();

    await this.audit.fromRequest(req, {
      action: 'VISIT_CHECK_IN', entityType: 'visit', entityId: visit.id, siteId: site.id,
      details: {
        noticeVersion: v.notice.version, documents: v.documents.map((d) => d.versionId), locale: v.locale, invitation: !!v.invitationCode,
        preregistered: !!v.preregisteredFrom, documentPhoto: !!v.documentPhoto || movedDocPhoto, assetPhoto: !!v.assetPhoto, hostId, travelDistance: v.travelDistance,
      },
    });
    return { code: visit.code, qrSvg: await exitQrSvg(visit.code), checkInAt: visit.checkInAt, emailQueued: wantsEmail, badgeEmailQueued: wantsBadge, hostNotified: wantsHostNotice };
  }

  private async uniqueCode(tenantId: string, siteId: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = this.crypto.randomCode(5);
      if (!(await this.visits.exist({ where: { tenantId, siteId, code, status: VisitStatus.OPEN } }))) return code;
    }
    throw new ConflictException('Could not allocate a visit code');
  }

  /**
   * Check-out lookup. Never lists everyone on site: the visitor types the exit code, or enough of
   * the surname to be specific. A surname prefix that matches more than MAX_OPEN_MATCHES people
   * returns nothing, so the present list cannot be dumped by sweeping short prefixes; only
   * "Surname N." is ever returned. The exact code is the primary, unambiguous path.
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
      const hits = open.filter((v) => norm(tc.decrypt(v.lastNameEnc, 'visit.lastName') ?? '').startsWith(norm(query)));
      // Too broad a prefix reveals nobody: the visitor must type more of the surname (or use the code).
      matches = hits.length > MAX_OPEN_MATCHES ? [] : hits;
    }
    return matches.slice(0, MAX_OPEN_MATCHES).map((v) => {
      const first = tc.decrypt(v.firstNameEnc, 'visit.firstName') ?? '';
      const last = tc.decrypt(v.lastNameEnc, 'visit.lastName') ?? '';
      return { id: v.id, label: `${last} ${first.charAt(0)}.`, checkInAt: v.checkInAt, assetPhotoRequired: policy.assetPhotosRequired };
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
