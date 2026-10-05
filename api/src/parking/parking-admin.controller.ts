import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { DataSource, In, Not } from 'typeorm';
import { RequireApp } from '../common/apps';
import { AuditService } from '../common/audit.service';
import { AdminAuthGuard, assertSiteAccess, CurrentUser, Roles, visibleSiteIds } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { Employee, ParkingBooking, ParkingSpot, Role, Site } from '../entities';
import { localDay, mondayOf, workingDays } from './parking-rules';
import { ParkingService } from './parking.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
export const SPOT_CODE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,19}$/;

export class SpotQuery { @IsOptional() @IsUUID() siteId?: string }
export class WeekQuery {
  @IsUUID() siteId: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) monday?: string;
}
export class CreateSpotDto {
  @IsUUID() siteId: string;
  @Transform(trim) @IsString() @Matches(SPOT_CODE) code: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value)) @IsString() @MaxLength(120) note?: string | null;
}
export class UpdateSpotDto {
  @IsOptional() @Transform(trim) @IsString() @Matches(SPOT_CODE) code?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value)) @IsString() @MaxLength(120) note?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

const MANAGE = [Role.SUPER_ADMIN, Role.SITE_MANAGER];
const READ = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];
const isDuplicate = (e: unknown) => (e as { code?: string })?.code === 'ER_DUP_ENTRY';

/** Console side of the Parking app: spots of each site, the week's bookings, who has the benefit. */
@Controller('admin/parking')
@RequireApp('parking')
@UseGuards(AdminAuthGuard)
export class ParkingAdminController {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly parking: ParkingService, private readonly keys: TenantKeysService, private readonly audit: AuditService) {}

  private spots() { return this.ds.getRepository(ParkingSpot); }

  private async spot(user: AuthUser, id: string) {
    const s = await this.spots().findOne({ where: { id, tenantId: user.tenantId } });
    if (!s) throw new NotFoundException();
    assertSiteAccess(user, s.siteId);
    return s;
  }

  @Get('spots')
  @Roles(...READ)
  async listSpots(@CurrentUser() user: AuthUser, @Query() q: SpotQuery) {
    // Without a site: every spot the user can see (the employee record picks a manager's spot from them).
    if (q.siteId) assertSiteAccess(user, q.siteId);
    const visible = visibleSiteIds(user);
    const spots = await this.spots().find({ where: { tenantId: user.tenantId, ...(q.siteId ? { siteId: q.siteId } : visible ? { siteId: In(visible.concat('-')) } : {}) } });
    const managers = await this.managersOf(user.tenantId, spots.map((s) => s.id));
    return spots.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .map((s) => ({ id: s.id, siteId: s.siteId, code: s.code, note: s.note, active: s.active, manager: managers.get(s.id) ?? null }));
  }

  /** Names of the managers holding these spots. */
  private async managersOf(tenantId: string, spotIds: string[]) {
    if (!spotIds.length) return new Map<string, { id: string; name: string }>();
    const ms = await this.ds.getRepository(Employee).find({ where: { tenantId, parkingRole: 'MANAGER', parkingSpotId: In(spotIds) }, select: { id: true, parkingSpotId: true, firstNameEnc: true, lastNameEnc: true } });
    const tc = await this.keys.forTenant(tenantId);
    return new Map(ms.map((m) => [m.parkingSpotId!, { id: m.id, name: `${tc.decrypt(m.firstNameEnc, 'employee.firstName')} ${tc.decrypt(m.lastNameEnc, 'employee.lastName')}` }]));
  }

  @Post('spots')
  @Roles(...MANAGE)
  async createSpot(@CurrentUser() user: AuthUser, @Body() dto: CreateSpotDto, @Req() req: AppRequest) {
    assertSiteAccess(user, dto.siteId);
    if (!(await this.ds.getRepository(Site).exist({ where: { id: dto.siteId, tenantId: user.tenantId } }))) throw new BadRequestException('SITE_NOT_FOUND');
    try {
      const s = await this.spots().save(this.spots().create({ tenantId: user.tenantId, siteId: dto.siteId, code: dto.code, note: dto.note ?? null, active: true }));
      await this.audit.fromRequest(req, { action: 'PARKING_SPOT_CREATED', entityType: 'parking_spot', entityId: s.id, siteId: s.siteId, details: { code: s.code } });
      return { id: s.id };
    } catch (e) { if (isDuplicate(e)) throw new ConflictException('SPOT_CODE_EXISTS'); throw e; }
  }

  @Patch('spots/:id')
  @Roles(...MANAGE)
  async updateSpot(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSpotDto, @Req() req: AppRequest) {
    const s = await this.spot(user, id);
    try { await this.spots().update(s.id, { ...(dto.code !== undefined ? { code: dto.code } : {}), ...(dto.note !== undefined ? { note: dto.note } : {}), ...(dto.active !== undefined ? { active: dto.active } : {}) }); }
    catch (e) { if (isDuplicate(e)) throw new ConflictException('SPOT_CODE_EXISTS'); throw e; }
    if (dto.active === false && s.active) await this.parking.spotOff(user.tenantId, s);
    await this.audit.fromRequest(req, { action: 'PARKING_SPOT_UPDATED', entityType: 'parking_spot', entityId: s.id, siteId: s.siteId, details: { ...dto } });
    return { ok: true };
  }

  /** Only a spot never used: otherwise turn it off, the past bookings stay readable. */
  @Delete('spots/:id')
  @Roles(...MANAGE)
  async deleteSpot(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const s = await this.spot(user, id);
    if (await this.ds.getRepository(ParkingBooking).exist({ where: { tenantId: user.tenantId, spotId: s.id } })) throw new ConflictException('SPOT_IN_USE');
    if (await this.ds.getRepository(Employee).exist({ where: { tenantId: user.tenantId, parkingSpotId: s.id } })) throw new ConflictException('SPOT_IN_USE');
    await this.spots().delete({ id: s.id });
    await this.audit.fromRequest(req, { action: 'PARKING_SPOT_DELETED', entityType: 'parking_spot', entityId: s.id, siteId: s.siteId, details: { code: s.code } });
    return { ok: true };
  }

  /** The week at a site: Monday to Friday, every spot, who has it. */
  @Get('week')
  @Roles(...READ)
  async week(@CurrentUser() user: AuthUser, @Query() q: WeekQuery) {
    assertSiteAccess(user, q.siteId);
    const site = await this.ds.getRepository(Site).findOne({ where: { id: q.siteId, tenantId: user.tenantId } });
    if (!site) throw new NotFoundException();
    const today = localDay(this.parking.now(), site.timezone).date;
    const monday = mondayOf(q.monday ?? today);
    const days = workingDays(monday);
    const spots = await this.listSpots(user, { siteId: site.id });
    const bookings = await this.ds.getRepository(ParkingBooking).find({ where: { tenantId: user.tenantId, siteId: site.id, date: In(days) } });
    const people = bookings.length ? await this.ds.getRepository(Employee).find({ where: { tenantId: user.tenantId, id: In([...new Set(bookings.map((b) => b.employeeId))]) }, select: { id: true, firstNameEnc: true, lastNameEnc: true } }) : [];
    const tc = await this.keys.forTenant(user.tenantId);
    const names = new Map(people.map((p) => [p.id, `${tc.decrypt(p.firstNameEnc, 'employee.firstName')} ${tc.decrypt(p.lastNameEnc, 'employee.lastName')}`]));
    return {
      monday, today, days, spots,
      bookings: bookings.map((b) => ({ id: b.id, spotId: b.spotId, date: b.date, source: b.source, employeeId: b.employeeId, name: names.get(b.employeeId) ?? '—' })),
    };
  }

  @Delete('bookings/:id')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST)
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const b = await this.ds.getRepository(ParkingBooking).findOne({ where: { id, tenantId: user.tenantId } });
    if (!b) throw new NotFoundException();
    assertSiteAccess(user, b.siteId);
    await this.parking.cancel(user.tenantId, null, id);
    await this.audit.fromRequest(req, { action: 'PARKING_BOOKING_CANCELLED', entityType: 'parking_booking', entityId: b.id, siteId: b.siteId, details: { date: b.date, employeeId: b.employeeId } });
    return { ok: true };
  }

  /** Books the managers' spots for the week after now, if this week's run has not done it yet. */
  @Post('weekly')
  @Roles(Role.SUPER_ADMIN)
  async weekly(@CurrentUser() user: AuthUser) {
    return this.parking.weekly(user.tenantId);
  }

  /** Who has the benefit (the role and the spot are set in each employee's record). */
  @Get('people')
  @Roles(...MANAGE, Role.AUDITOR)
  async people(@CurrentUser() user: AuthUser) {
    const all = await this.ds.getRepository(Employee).find({ where: { tenantId: user.tenantId, parkingRole: Not('NONE') }, select: { id: true, externalId: true, active: true, parkingRole: true, parkingSpotId: true, firstNameEnc: true, lastNameEnc: true } });
    const spots = new Map((await this.spots().find({ where: { tenantId: user.tenantId } })).map((s) => [s.id, s]));
    const tc = await this.keys.forTenant(user.tenantId);
    return all.map((e) => ({
      id: e.id, externalId: e.externalId, active: e.active, role: e.parkingRole,
      firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'),
      spot: e.parkingSpotId && spots.has(e.parkingSpotId) ? { id: e.parkingSpotId, code: spots.get(e.parkingSpotId)!.code, siteId: spots.get(e.parkingSpotId)!.siteId } : null,
    })).sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''));
  }
}
