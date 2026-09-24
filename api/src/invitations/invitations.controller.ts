import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AdminAuthGuard, CurrentUser, Roles, assertSiteAccess, visibleSiteIds } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { Role, VisitPurpose } from '../entities';
import { SUPPORTED_LOCALES } from '../kiosk/kiosk.dto';
import { InvitationsService } from './invitations.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const NAME = /^[\p{L}\p{M}' .-]+$/u;

export class CreateInvitationDto {
  @IsUUID() siteId: string;
  @IsUUID() hostId: string;
  /** Day and time as seen at the site, in the site's time zone. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) firstName: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) lastName: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value)) @IsString() @MaxLength(120) company?: string | null;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(190) email: string;
  @IsEnum(VisitPurpose) purpose: VisitPurpose;
  @IsOptional() @IsIn(SUPPORTED_LOCALES) locale?: string;
}

export class ListInvitationsQuery {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsIn(['upcoming', 'past']) scope?: 'upcoming' | 'past';
}

export class HostsQuery {
  @IsUUID() siteId: string;
}

const STAFF = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST];

/** Pre-registered visits, managed by the reception staff on behalf of the people being visited. */
@Controller('admin/invitations')
@UseGuards(AdminAuthGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService, private readonly audit: AuditService) {}

  @Get()
  @Roles(...STAFF, Role.AUDITOR)
  list(@CurrentUser() user: AuthUser, @Query() q: ListInvitationsQuery) {
    if (q.siteId) assertSiteAccess(user, q.siteId);
    return this.invitations.list(user, q.siteId ? [q.siteId] : visibleSiteIds(user), q.scope ?? 'upcoming');
  }

  @Get('hosts')
  @Roles(...STAFF)
  hosts(@CurrentUser() user: AuthUser, @Query() q: HostsQuery) {
    assertSiteAccess(user, q.siteId);
    return this.invitations.hostsOf(user, q.siteId);
  }

  @Post()
  @Roles(...STAFF)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvitationDto, @Req() req: AppRequest) {
    assertSiteAccess(user, dto.siteId);
    const inv = await this.invitations.create(user, dto);
    await this.audit.fromRequest(req, { action: 'INVITATION_CREATED', entityType: 'invitation', entityId: inv.id, siteId: inv.siteId, details: { hostId: inv.hostId, expectedAt: inv.expectedAt } });
    return { id: inv.id, emailStatus: inv.emailStatus };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...STAFF)
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const inv = await this.invitations.get(user, id);
    assertSiteAccess(user, inv.siteId);
    await this.invitations.cancel(user, id);
    await this.audit.fromRequest(req, { action: 'INVITATION_CANCELLED', entityType: 'invitation', entityId: id, siteId: inv.siteId });
    return { ok: true };
  }

  @Post(':id/resend')
  @HttpCode(200)
  @Roles(...STAFF)
  async resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const inv = await this.invitations.get(user, id);
    assertSiteAccess(user, inv.siteId);
    await this.invitations.resend(user, id);
    await this.audit.fromRequest(req, { action: 'INVITATION_RESENT', entityType: 'invitation', entityId: id, siteId: inv.siteId });
    return { ok: true };
  }

  @Get(':id/qr')
  @Roles(...STAFF)
  async qr(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.invitations.get(user, id);
    assertSiteAccess(user, inv.siteId);
    return this.invitations.qr(user, id);
  }
}
