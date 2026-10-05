import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { In, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { inviteQrPayload } from '../common/exit-qr';
import { AppRequest, AuthEmployee } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { PushService } from '../common/push.service';
import { CARRIER_NAMES, Employee, Host, Parcel, PushDevice, Site, Tenant, VisitPurpose } from '../entities';
import { InvitationsService } from '../invitations/invitations.service';
import { SUPPORTED_LOCALES } from '../kiosk/kiosk.dto';
import { CurrentEmployee, EmployeeAppGuard } from './access.guards';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const NAME = /^[\p{L}\p{M}' .-]+$/u;

export class AppInvitationDto {
  @IsUUID() siteId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) firstName: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) lastName: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value)) @IsString() @MaxLength(120) company?: string | null;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(190) email: string;
  @IsEnum(VisitPurpose) purpose: VisitPurpose;
  @IsOptional() @IsIn(SUPPORTED_LOCALES) locale?: string;
}
export class AppInvitationsQuery {
  @IsOptional() @IsIn(['upcoming', 'past']) scope?: 'upcoming' | 'past';
}

class WebPushKeysDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{20,200}={0,2}$/) p256dh: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,100}={0,2}$/) auth: string;
}
class WebSubscriptionDto {
  @IsString() @MaxLength(1000) endpoint: string;
  @ValidateNested() @Type(() => WebPushKeysDto) keys: WebPushKeysDto;
  /** Sent by the browser's toJSON(); not used. */
  @IsOptional() @IsNumber() expirationTime?: number | null;
}
/** One device: the Expo token of the app, or the Web Push subscription of the browser (only its endpoint to remove it). */
export class PushDeviceDto {
  @IsIn(['expo', 'web']) kind: 'expo' | 'web';
  @ValidateIf((o) => o.kind === 'expo') @IsString() @MaxLength(200) token?: string;
  @ValidateIf((o) => o.kind === 'web') @ValidateNested() @Type(() => WebSubscriptionDto) subscription?: WebSubscriptionDto;
  @IsOptional() @IsIn(SUPPORTED_LOCALES) locale?: string;
}
export class PushTargetDto {
  @IsIn(['expo', 'web']) kind: 'expo' | 'web';
  @IsString() @MaxLength(1000) target: string;
}

/**
 * The employee's own phone app. Employees who are also people to visit (linked in the console) can
 * invite their guests here, for the sites where they can be visited, and see or cancel only their own
 * invitations. Everything else about invitations (email, QR at the tablet, one use) is unchanged.
 */
@Controller('me')
@UseGuards(EmployeeAppGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class EmployeeAppController {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Host) private readonly hosts: Repository<Host>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly invitations: InvitationsService,
    private readonly keys: TenantKeysService,
    private readonly audit: AuditService,
    private readonly push: PushService,
    @InjectRepository(PushDevice) private readonly pushDevices: Repository<PushDevice>,
  ) {}

  /** The active entry in the directory of people to visit, with its active sites. */
  private async host(me: AuthEmployee) {
    const h = await this.hosts.findOne({ where: { tenantId: me.tenantId, employeeId: me.id, active: true }, relations: { sites: true } });
    if (h) h.sites = h.sites.filter((s) => s.active);
    return h?.sites.length ? h : null;
  }

  private async requireHost(me: AuthEmployee) {
    const h = await this.host(me);
    if (!h) throw new ForbiddenException('NOT_A_HOST');
    return h;
  }

  /**
   * "Remove the badge from this phone": the phone forgets its secrets, and so does the server, so
   * nothing issued to this phone keeps working (QR, NFC, app token, arrival notices). The organisation
   * can turn this off: then only the console revokes the badge.
   */
  @Post('revoke')
  @HttpCode(200)
  async revoke(@CurrentEmployee() me: AuthEmployee, @Req() req: AppRequest) {
    const t = await this.tenants.findOneOrFail({ where: { id: me.tenantId }, select: { id: true, badgeSelfRemove: true } });
    if (!t.badgeSelfRemove) throw new ForbiddenException('SELF_REMOVE_DISABLED');
    await this.employees.manager.transaction(async (em) => {
      await em.update(Employee, { id: me.id, tenantId: me.tenantId }, { credentialSecretEnc: null, credentialIssuedAt: null, appTokenHash: null });
      await em.delete(PushDevice, { tenantId: me.tenantId, employeeId: me.id });
    });
    await this.audit.fromRequest(req, { action: 'PHONE_BADGE_REMOVED', entityType: 'employee', entityId: me.id });
    return { ok: true };
  }

  @Get()
  async profile(@CurrentEmployee() me: AuthEmployee) {
    const e = await this.employees.findOneOrFail({ where: { id: me.id, tenantId: me.tenantId } });
    const tc = await this.keys.forTenant(me.tenantId);
    const t = await this.tenants.findOneOrFail({ where: { id: me.tenantId }, select: { id: true, name: true, badgeSelfRemove: true } });
    const h = await this.host(me);
    return {
      firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'), organisation: t.name,
      canInvite: !!h,
      canRemove: t.badgeSelfRemove,
      sites: h ? h.sites.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone })) : [],
      purposes: Object.values(VisitPurpose),
    };
  }

  /** Parcels waiting for me at reception (any site), newest first. */
  @Get('parcels')
  async parcels(@CurrentEmployee() me: AuthEmployee) {
    const rows = await this.employees.manager.find(Parcel, { where: { tenantId: me.tenantId, employeeId: me.id, status: 'WAITING' }, order: { receivedAt: 'DESC' }, take: 50 });
    if (!rows.length) return [];
    const sites = new Map((await this.employees.manager.find(Site, { where: { tenantId: me.tenantId, id: In([...new Set(rows.map((r) => r.siteId))]) } })).map((s) => [s.id, s]));
    return rows.map((r) => ({ id: r.id, siteName: sites.get(r.siteId)?.name ?? '', timezone: sites.get(r.siteId)?.timezone ?? 'UTC', carrier: CARRIER_NAMES[r.carrier], pieces: r.pieces, receivedAt: r.receivedAt }));
  }

  @Get('invitations')
  async list(@CurrentEmployee() me: AuthEmployee, @Query() q: AppInvitationsQuery) {
    const h = await this.requireHost(me);
    const rows = await this.invitations.list(me, undefined, q.scope ?? 'upcoming', h.id);
    // Only what the host needs about their own guests.
    return rows.map(({ id, siteId, siteName, timezone, expectedAt, purpose, firstName, lastName, company, email, status, emailStatus }) => ({ id, siteId, siteName, timezone, expectedAt, purpose, firstName, lastName, company, email, status, emailStatus }));
  }

  @Post('invitations')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(@CurrentEmployee() me: AuthEmployee, @Body() dto: AppInvitationDto, @Req() req: AppRequest) {
    const h = await this.requireHost(me);
    if (!h.sites.some((s) => s.id === dto.siteId)) throw new ForbiddenException('NOT_A_HOST_HERE');
    const inv = await this.invitations.create({ tenantId: me.tenantId, employeeId: me.id }, { ...dto, hostId: h.id });
    await this.audit.fromRequest(req, { action: 'INVITATION_CREATED', entityType: 'invitation', entityId: inv.id, siteId: inv.siteId, details: { hostId: h.id, expectedAt: inv.expectedAt, fromApp: true } });
    return { id: inv.id, emailStatus: inv.emailStatus };
  }

  private async mine(me: AuthEmployee, id: string) {
    const h = await this.requireHost(me);
    const inv = await this.invitations.get(me, id);
    if (inv.hostId !== h.id) throw new NotFoundException();
    return inv;
  }

  @Post('invitations/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentEmployee() me: AuthEmployee, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const inv = await this.mine(me, id);
    await this.invitations.cancel(me, id);
    await this.audit.fromRequest(req, { action: 'INVITATION_CANCELLED', entityType: 'invitation', entityId: id, siteId: inv.siteId, details: { fromApp: true } });
    return { ok: true };
  }

  /** Code and QR content, for the host to forward when the email did not arrive. */
  @Get('invitations/:id/qr')
  async qr(@CurrentEmployee() me: AuthEmployee, @Param('id', ParseUUIDPipe) id: string) {
    await this.mine(me, id);
    const { code } = await this.invitations.qr(me, id);
    return { code, payload: inviteQrPayload(code) };
  }

  // ------------------------------------------------------------------ "your guest has arrived" on the phone

  /** The public key the browser needs to subscribe; only people who can be visited get notices. */
  @Get('push')
  async pushConfig(@CurrentEmployee() me: AuthEmployee) {
    await this.requireHost(me);
    return { webPushKey: (await this.push.vapid()).publicKey };
  }

  @Post('push')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async pushRegister(@CurrentEmployee() me: AuthEmployee, @Body() dto: PushDeviceDto, @Req() req: AppRequest) {
    await this.requireHost(me);
    let target: string;
    if (dto.kind === 'expo') { this.push.checkExpoToken(dto.token!); target = dto.token!; }
    else { this.push.checkWebSubscription(dto.subscription!); target = JSON.stringify({ endpoint: dto.subscription!.endpoint, keys: dto.subscription!.keys }); }
    const device = await this.push.register(me, dto.kind, target, dto.locale ?? 'en');
    await this.audit.fromRequest(req, { action: 'PUSH_DEVICE_REGISTERED', entityType: 'employee', entityId: me.id, details: { kind: dto.kind } });
    return { id: device.id };
  }

  @Delete('push')
  @HttpCode(200)
  async pushUnregister(@CurrentEmployee() me: AuthEmployee, @Body() dto: PushTargetDto) {
    await this.push.unregister(me, dto.kind, dto.target);
    return { ok: true };
  }

  /** Sends a test notice to this device now: OK, or why not. */
  @Post('push/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async pushTest(@CurrentEmployee() me: AuthEmployee, @Body() dto: PushTargetDto) {
    const hash = this.push.targetHash(dto.kind, dto.target);
    const device = await this.pushDevices.findOne({ where: { tenantId: me.tenantId, employeeId: me.id, targetHash: hash } });
    if (!device) throw new NotFoundException('PUSH_DEVICE_NOT_FOUND');
    return { result: await this.push.test(device) };
  }
}
