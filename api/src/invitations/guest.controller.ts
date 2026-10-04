import { BadRequestException, Body, ConflictException, Controller, HttpCode, NotFoundException, Post, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, Equals, IsArray, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { DataSource, IsNull } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { FilesService } from '../common/files.service';
import { CurrentTenant } from '../common/guards';
import { AppRequest, AuthTenant } from '../common/request-context';
import { SiteDocumentsService } from '../common/site-documents.service';
import { TenantKeysService } from '../common/tenant-keys.service';
import { addDays } from '../common/time.util';
import { CountryPolicy, DocumentType, FileKind, Host, Invitation, InvitationStatus, PrivacyNotice, Site, StoredFile, Tenant, TravelDistance } from '../entities';
import { SUPPORTED_LOCALES } from '../kiosk/kiosk.dto';
import { PreregistrationData, documentPhotoRequired, renderNotice } from '../kiosk/kiosk.service';
import { INVITATION_KEEP_DAYS, normaliseInviteCode } from './invitations.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const NAME = /^[\p{L}\p{M}' .-]+$/u;

export class GuestCodeDto {
  @IsString() @Transform(({ value }) => (typeof value === 'string' ? normaliseInviteCode(value) : value)) @Length(8, 8) code: string;
}

export class GuestPreregisterDto extends GuestCodeDto {
  @IsIn(SUPPORTED_LOCALES) locale: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) firstName: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) lastName: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) company?: string;
  @IsEnum(TravelDistance) travelDistance: TravelDistance;
  @IsOptional() @IsEnum(DocumentType) documentType?: DocumentType;
  @IsOptional() @Transform(trim) @IsString() @Length(3, 40) @Matches(/^[A-Za-z0-9 .\-/]+$/) documentNumber?: string;
  @IsUUID() privacyNoticeId: string;
  @Equals(true) privacyAccepted: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) acceptedDocuments?: string[];
  @IsString() @MaxLength(5_000_000) signature: string;
  @IsOptional() @IsString() @MaxLength(5_000_000) documentPhoto?: string;
}

/**
 * Pre-registration from the guest's phone, opened from the link in the invitation email. The
 * invitation code is the only credential: it is long, single-use, valid until the end of the
 * expected day, and lookups are rate-limited. The page shows only what the guest already knows
 * (their own details, who they are meeting, when and where).
 */
@Controller('guest/invitation')
export class GuestController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly keys: TenantKeysService,
    private readonly crypto: CryptoService,
    private readonly files: FilesService,
    private readonly documents: SiteDocumentsService,
    private readonly audit: AuditService,
  ) {}

  private async load(tenant: AuthTenant, code: string) {
    const inv = await this.ds.getRepository(Invitation).findOne({ where: { tenantId: tenant.id, codeHash: this.crypto.sha256(code) } });
    if (!inv || inv.status === InvitationStatus.CANCELLED) throw new NotFoundException('INVITATION_NOT_FOUND');
    if (inv.status === InvitationStatus.USED) throw new ConflictException('INVITATION_USED');
    if (inv.validUntil <= new Date()) throw new ConflictException('INVITATION_EXPIRED');
    const site = await this.ds.getRepository(Site).findOneOrFail({ where: { id: inv.siteId, tenantId: tenant.id } });
    const policy = await this.ds.getRepository(CountryPolicy).findOneOrFail({ where: { tenantId: tenant.id, countryCode: site.countryCode } });
    return { inv, site, policy };
  }

  private latestNotice(tenantId: string, countryCode: string, locale: string) {
    return this.ds.getRepository(PrivacyNotice).findOne({ where: { tenantId, countryCode, locale }, order: { version: 'DESC' } });
  }

  @Post('open')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async open(@CurrentTenant() tenant: AuthTenant, @Body() dto: GuestCodeDto) {
    const { inv, site, policy } = await this.load(tenant, dto.code);
    const tc = await this.keys.forTenant(tenant.id);
    const org = await this.ds.getRepository(Tenant).findOneOrFail({ where: { id: tenant.id }, select: { id: true, name: true, logoDataUrl: true, primaryColor: true, secondaryColor: true } });
    const host = await this.ds.getRepository(Host).findOne({ where: { id: inv.hostId, tenantId: tenant.id } });
    const notices: Record<string, { id: string; version: number; title: string; body: string }> = {};
    for (const locale of policy.locales) {
      const n = await this.latestNotice(tenant.id, site.countryCode, locale);
      if (n) notices[locale] = { id: n.id, version: n.version, title: n.title, body: renderNotice(n.body, policy) };
    }
    const locales = policy.locales.filter((l) => notices[l]);
    const pre = inv.preDataEnc ? JSON.parse(tc.decrypt(inv.preDataEnc, 'invitation.preregistration') ?? '{}') as PreregistrationData : null;
    return {
      organisation: { name: org.name, logo: org.logoDataUrl, primaryColor: org.primaryColor, secondaryColor: org.secondaryColor },
      site: { name: site.name, timezone: site.timezone },
      expectedAt: inv.expectedAt, host: host ? `${host.firstName} ${host.lastName}` : null, purpose: inv.purpose,
      locale: locales.includes(inv.preLocale ?? inv.locale) ? inv.preLocale ?? inv.locale : policy.defaultLocale,
      guest: {
        firstName: pre?.firstName ?? tc.decrypt(inv.firstNameEnc, 'invitation.firstName'), lastName: pre?.lastName ?? tc.decrypt(inv.lastNameEnc, 'invitation.lastName'),
        company: pre ? pre.company : tc.decrypt(inv.companyEnc, 'invitation.company'), travelDistance: pre?.travelDistance ?? null,
      },
      policy: { locales, defaultLocale: policy.defaultLocale, documentDataEnabled: policy.documentDataEnabled, documentPhotoEnabled: documentPhotoRequired(policy), assetPhotosRequired: policy.assetPhotosRequired },
      notices,
      documents: await this.documents.forSite(tenant.id, site.id, locales, policy.defaultLocale),
      preregisteredAt: inv.preregisteredAt,
    };
  }

  /** Saves (or replaces) the pre-registration. Nothing becomes a visit until the guest arrives. */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async submit(@CurrentTenant() tenant: AuthTenant, @Body() dto: GuestPreregisterDto, @Req() req: AppRequest) {
    const { inv, site, policy } = await this.load(tenant, dto.code);
    if (!policy.locales.includes(dto.locale)) throw new BadRequestException('LOCALE_NOT_ENABLED');
    const notice = await this.latestNotice(tenant.id, site.countryCode, dto.locale);
    if (!notice || notice.id !== dto.privacyNoticeId) throw new ConflictException('NOTICE_OUTDATED');
    const documents = (await this.documents.forSite(tenant.id, site.id, [dto.locale], policy.defaultLocale))[dto.locale];
    this.documents.assertAccepted(documents, dto.acceptedDocuments);
    // Same data minimisation as the tablet: what the country policy does not ask is never stored.
    if (policy.documentDataEnabled && (!dto.documentType || !dto.documentNumber)) throw new BadRequestException('DOCUMENT_REQUIRED');
    if (documentPhotoRequired(policy) && !dto.documentPhoto) throw new BadRequestException('DOCUMENT_PHOTO_REQUIRED');
    const signature = this.files.parseImage(dto.signature, 'signature');
    const docPhoto = documentPhotoRequired(policy) && dto.documentPhoto ? this.files.parseImage(dto.documentPhoto, 'documentPhoto') : null;

    const tc = await this.keys.forTenant(tenant.id);
    const data: PreregistrationData = {
      firstName: dto.firstName, lastName: dto.lastName, company: dto.company || null, travelDistance: dto.travelDistance,
      documentType: policy.documentDataEnabled ? dto.documentType! : null, documentNumber: policy.documentDataEnabled ? dto.documentNumber! : null,
    };
    // Files wait for the guest no longer than the invitation itself.
    const purgeAfter = addDays(inv.validUntil, INVITATION_KEEP_DAYS);
    const now = new Date();
    const replaced = await this.ds.transaction(async (em) => {
      const old = await em.find(StoredFile, { where: { tenantId: tenant.id, invitationId: inv.id, purgedAt: IsNull() } });
      const res = await em.update(Invitation, { id: inv.id, status: InvitationStatus.PENDING }, {
        preregisteredAt: now, preLocale: dto.locale, preNoticeId: notice.id, preNoticeVersion: notice.version,
        preDocuments: documents.map((d) => ({ documentId: d.documentId, versionId: d.id })),
        preDataEnc: tc.encrypt(JSON.stringify(data), 'invitation.preregistration'),
      });
      if (!res.affected) throw new ConflictException('INVITATION_USED');
      await this.files.store(em, tc, { invitationId: inv.id }, FileKind.SIGNATURE, signature, purgeAfter);
      if (docPhoto) await this.files.store(em, tc, { invitationId: inv.id }, FileKind.DOCUMENT, docPhoto, purgeAfter);
      return old;
    });
    // A second submission replaces the first: the old images go at once.
    for (const f of replaced) await this.files.purge(f);
    await this.audit.fromRequest(req, {
      action: 'INVITATION_PREREGISTERED', entityType: 'invitation', entityId: inv.id, siteId: site.id,
      details: { noticeVersion: notice.version, documents: documents.map((d) => d.id), locale: dto.locale, documentPhoto: !!docPhoto, replaced: replaced.length > 0 },
    });
    return { ok: true, preregisteredAt: now };
  }
}
