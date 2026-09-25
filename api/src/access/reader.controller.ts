import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { DataSource, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { CurrentTenant } from '../common/guards';
import { AppRequest, AuthTenant } from '../common/request-context';
import { Door, DoorReader, PairingCode, Site, Tenant } from '../entities';
import { CurrentReader, ReaderGuard } from './access.guards';
import { AccessService, QR_STEP_S, ReaderContext } from './access.service';

export class ReaderPairDto {
  @IsString() @Transform(({ value }) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')) @Length(8, 8) code: string;
}
export class VerifyDto {
  @IsOptional() @IsString() @MaxLength(120) qr?: string;
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[0-9A-Fa-f:\- ]+$/) nfc?: string;
}
export class BadgeRequestDto {
  @IsEmail() @MaxLength(190) email: string;
  @IsOptional() @IsIn(['it', 'es', 'en']) locale?: string;
}
export class BadgeActivateDto {
  @IsEmail() @MaxLength(190) email: string;
  @Matches(/^\d{6}$/) code: string;
}

/** The reader at a door: pairing, its configuration and the verification of each QR / badge. */
@Controller('reader')
export class ReaderController {
  constructor(
    private readonly access: AccessService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(PairingCode) private readonly codes: Repository<PairingCode>,
    @InjectRepository(Door) private readonly doors: Repository<Door>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  @Post('pair')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async pair(@CurrentTenant() tenant: AuthTenant, @Body() dto: ReaderPairDto, @Req() req: AppRequest) {
    const pc = await this.codes.findOne({ where: { tenantId: tenant.id, codeHash: this.crypto.sha256(dto.code), usedAt: IsNull(), expiresAt: MoreThan(new Date()), doorId: Not(IsNull()) } });
    if (!pc) {
      await this.audit.fromRequest(req, { action: 'READER_PAIR_FAILED' });
      throw new UnauthorizedException('PAIRING_CODE_INVALID');
    }
    const token = this.crypto.randomToken(32);
    const reader = await this.ds.transaction(async (em) => {
      const res = await em.update(PairingCode, { id: pc.id, usedAt: IsNull() }, { usedAt: new Date() });
      if (!res.affected) throw new UnauthorizedException('PAIRING_CODE_INVALID');
      return em.save(em.create(DoorReader, { tenantId: tenant.id, siteId: pc.siteId, doorId: pc.doorId!, name: pc.deviceName, tokenHash: this.crypto.sha256(token), createdBy: pc.createdBy, lastSeenAt: new Date() }));
    });
    await this.audit.fromRequest(req, { action: 'READER_PAIRED', entityType: 'reader', entityId: reader.id, siteId: reader.siteId, details: { doorId: reader.doorId } });
    return { readerToken: token };
  }

  @Get('config')
  @UseGuards(ReaderGuard)
  async config(@CurrentReader() r: ReaderContext) {
    const door = await this.doors.findOneOrFail({ where: { id: r.doorId, tenantId: r.tenantId } });
    const site = await this.sites.findOneOrFail({ where: { id: r.siteId, tenantId: r.tenantId } });
    const t = await this.tenants.findOneOrFail({ where: { id: r.tenantId }, select: { id: true, name: true, logoDataUrl: true, primaryColor: true, secondaryColor: true } });
    return { door: { name: door.name, active: door.active }, site: { name: site.name, timezone: site.timezone }, organisation: { name: t.name, logo: t.logoDataUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor } };
  }

  @Post('verify')
  @HttpCode(200)
  @UseGuards(ReaderGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  verify(@CurrentReader() r: ReaderContext, @Body() dto: VerifyDto) {
    if (!dto.qr === !dto.nfc) throw new UnauthorizedException('ONE_CREDENTIAL');
    return this.access.verify(r, dto);
  }
}

/** "My badge" on the employee's phone: activation with a one-time code sent to the work email. */
@Controller('badge')
export class BadgeController {
  constructor(private readonly access: AccessService, private readonly audit: AuditService) {}

  @Post('request')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async request(@CurrentTenant() tenant: AuthTenant, @Body() dto: BadgeRequestDto) {
    await this.access.requestLoginCode(tenant.id, dto.email, dto.locale ?? 'it');
    return { ok: true, step: QR_STEP_S }; // same answer whether the address is known or not
  }

  @Post('activate')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async activate(@CurrentTenant() tenant: AuthTenant, @Body() dto: BadgeActivateDto, @Req() req: AppRequest) {
    const res = await this.access.activateBadge(tenant.id, dto.email, dto.code);
    await this.audit.fromRequest(req, { action: 'PHONE_BADGE_ACTIVATED', entityType: 'employee', entityId: res.employeeId });
    return res;
  }
}
