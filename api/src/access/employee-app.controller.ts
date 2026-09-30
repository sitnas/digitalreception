import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { inviteQrPayload } from '../common/exit-qr';
import { AppRequest, AuthEmployee } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { Employee, Host, Tenant, VisitPurpose } from '../entities';
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

  @Get()
  async profile(@CurrentEmployee() me: AuthEmployee) {
    const e = await this.employees.findOneOrFail({ where: { id: me.id, tenantId: me.tenantId } });
    const tc = await this.keys.forTenant(me.tenantId);
    const t = await this.tenants.findOneOrFail({ where: { id: me.tenantId }, select: { id: true, name: true } });
    const h = await this.host(me);
    return {
      firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'), organisation: t.name,
      canInvite: !!h,
      sites: h ? h.sites.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone })) : [],
      purposes: Object.values(VisitPurpose),
    };
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
}
