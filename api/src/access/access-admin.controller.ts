import { APP_KEYS, RequireApp, type AppKey } from '../common/apps';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Between, In, IsNull, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AdminAuthGuard, CurrentUser, Roles, assertSiteAccess, visibleSiteIds } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { AccessEvent, AccessRule, ApiKey, Door, DoorReader, Employee, PairingCode, ParkingSpot, Project, PushDevice, Role, Site, Tenant } from '../entities';
import { AccessService } from './access.service';
import { PARKING_ROLES, type ParkingRole } from '../parking/parking-rules';
import { ParkingService } from '../parking/parking.service';
import { EXTERNAL_ID, PROJECT_CODE, PutEmployeeDto } from './integration.controller';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const PAIRING_TTL_MIN = 15;
const NONE = ['00000000-0000-0000-0000-000000000000'];

export class CreateDoorDto {
  @IsUUID() siteId: string;
  @Transform(trim) @IsString() @Length(1, 80) name: string;
  @IsString() @Matches(EXTERNAL_ID) externalId: string;
}
export class UpdateDoorDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
/** Same fields as the integration API; the console may leave the code empty and get one generated. */
export class CreateEmployeeDto extends PutEmployeeDto {
  @IsOptional() @Transform(trim) @IsString() @Matches(EXTERNAL_ID) externalId?: string;
}
export class ReaderCodeDto {
  @Transform(trim) @IsString() @Length(2, 80) name: string;
}
export class ApiKeyDto {
  @Transform(trim) @IsString() @Length(2, 80) name: string;
}
export class CreateProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Matches(PROJECT_CODE) code: string;
  @Transform(trim) @IsString() @Length(1, 120) name: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) client?: string | null;
}
export class UpdateProjectDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) client?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class AccessEventsQuery {
  @IsISO8601() from: string;
  @IsISO8601() to: string;
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsIn(['GRANTED', 'DENIED']) result?: 'GRANTED' | 'DENIED';
  /** Only people of this job / contract. */
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2000) limit?: number;
}

export class EmployeeAppsDto {
  @IsArray() @ArrayUnique() @IsIn(APP_KEYS, { each: true }) appsOff: AppKey[];
}

export class EmployeeParkingDto {
  @IsIn(PARKING_ROLES) role: ParkingRole;
  /** The manager's fixed spot (ignored for the other roles). */
  @IsOptional() @IsUUID() spotId?: string | null;
}

export class AccessSettingsDto {
  @IsBoolean() selfRemove: boolean;
}

const MANAGE = [Role.SUPER_ADMIN, Role.SITE_MANAGER];
const READ = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR];

/** Console side of employee access control: what the external system sent, doors, readers, log, API keys. */
@Controller('admin/access')
@UseGuards(AdminAuthGuard)
export class AccessAdminController {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Door) private readonly doors: Repository<Door>,
    @InjectRepository(AccessRule) private readonly rules: Repository<AccessRule>,
    @InjectRepository(DoorReader) private readonly readers: Repository<DoorReader>,
    @InjectRepository(AccessEvent) private readonly events: Repository<AccessEvent>,
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    @InjectRepository(PairingCode) private readonly codes: Repository<PairingCode>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly keys: TenantKeysService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly parking: ParkingService,
  ) {}

  private async visibleDoors(user: AuthUser) {
    const ids = visibleSiteIds(user);
    return this.doors.find({ where: { tenantId: user.tenantId, ...(ids ? { siteId: In(ids.length ? ids : NONE) } : {}) }, order: { name: 'ASC' } });
  }

  // ------------------------------------------------------------------ settings
  /** Whether employees may remove the phone badge themselves. */
  @Get('settings')
  @Roles(...READ)
  async settings(@CurrentUser() user: AuthUser) {
    const t = await this.employees.manager.findOneOrFail(Tenant, { where: { id: user.tenantId }, select: { id: true, badgeSelfRemove: true } });
    return { selfRemove: t.badgeSelfRemove };
  }

  @Patch('settings')
  @Roles(Role.SUPER_ADMIN)
  async updateSettings(@CurrentUser() user: AuthUser, @Body() dto: AccessSettingsDto, @Req() req: AppRequest) {
    await this.employees.manager.update(Tenant, { id: user.tenantId }, { badgeSelfRemove: dto.selfRemove });
    await this.audit.fromRequest(req, { action: 'ACCESS_SETTINGS_UPDATED', details: { selfRemove: dto.selfRemove } });
    return { selfRemove: dto.selfRemove };
  }

  // ------------------------------------------------------------------ doors and readers
  @Get('doors')
  @RequireApp('access')
  @Roles(...READ)
  async listDoors(@CurrentUser() user: AuthUser) {
    const doors = await this.visibleDoors(user);
    const sites = new Map((await this.sites.find({ where: { tenantId: user.tenantId } })).map((s) => [s.id, s]));
    const readers = doors.length ? await this.readers.find({ where: { tenantId: user.tenantId, doorId: In(doors.map((d) => d.id)), revokedAt: IsNull() }, order: { createdAt: 'ASC' } }) : [];
    return doors.map((d) => ({
      id: d.id, externalId: d.externalId, name: d.name, active: d.active, siteId: d.siteId, siteName: sites.get(d.siteId)?.name ?? '—',
      readers: readers.filter((r) => r.doorId === d.id).map((r) => ({ id: r.id, name: r.name, lastSeenAt: r.lastSeenAt, createdAt: r.createdAt })),
    }));
  }

  @Post('doors')
  @RequireApp('access')
  @Roles(...MANAGE)
  async createDoor(@CurrentUser() user: AuthUser, @Body() dto: CreateDoorDto, @Req() req: AppRequest) {
    assertSiteAccess(user, dto.siteId);
    if (!(await this.sites.exist({ where: { id: dto.siteId, tenantId: user.tenantId, active: true } }))) throw new NotFoundException('SITE_NOT_FOUND');
    if (await this.doors.exist({ where: { tenantId: user.tenantId, externalId: dto.externalId } })) throw new ConflictException('DOOR_ID_EXISTS');
    const door = await this.doors.save(this.doors.create({ tenantId: user.tenantId, siteId: dto.siteId, name: dto.name, externalId: dto.externalId, active: true }));
    await this.audit.fromRequest(req, { action: 'DOOR_CREATED', entityType: 'door', entityId: door.id, siteId: door.siteId, details: { externalId: door.externalId } });
    return door;
  }

  @Patch('doors/:id')
  @RequireApp('access')
  @Roles(...MANAGE)
  async updateDoor(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoorDto, @Req() req: AppRequest) {
    const door = await this.doors.findOne({ where: { id, tenantId: user.tenantId } });
    if (!door) throw new NotFoundException();
    assertSiteAccess(user, door.siteId);
    await this.doors.update(door.id, { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.active !== undefined ? { active: dto.active } : {}) });
    await this.audit.fromRequest(req, { action: 'DOOR_UPDATED', entityType: 'door', entityId: door.id, siteId: door.siteId, details: { ...dto } });
    return { ok: true };
  }

  /** One-time code to enrol a reader at this door (same flow as reception tablets). */
  @Post('doors/:id/reader-code')
  @RequireApp('access')
  @Roles(...MANAGE)
  async readerCode(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReaderCodeDto, @Req() req: AppRequest) {
    const door = await this.doors.findOne({ where: { id, tenantId: user.tenantId } });
    if (!door) throw new NotFoundException();
    assertSiteAccess(user, door.siteId);
    const code = this.crypto.randomCode(8);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MIN * 60_000);
    await this.codes.save(this.codes.create({ tenantId: user.tenantId, siteId: door.siteId, doorId: door.id, deviceName: dto.name, codeHash: this.crypto.sha256(code), expiresAt, usedAt: null, createdBy: user.id }));
    await this.audit.fromRequest(req, { action: 'READER_CODE_CREATED', entityType: 'door', entityId: door.id, siteId: door.siteId, details: { name: dto.name } });
    return { code, expiresAt };
  }

  @Post('readers/:id/revoke')
  @RequireApp('access')
  @HttpCode(200)
  @Roles(...MANAGE)
  async revokeReader(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const r = await this.readers.findOne({ where: { id, tenantId: user.tenantId } });
    if (!r) throw new NotFoundException();
    assertSiteAccess(user, r.siteId);
    await this.readers.update({ id, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.audit.fromRequest(req, { action: 'READER_REVOKED', entityType: 'reader', entityId: id, siteId: r.siteId });
    return { ok: true };
  }

  // ------------------------------------------------------------------ jobs / contracts ("commesse")
  @Get('projects')
  @Roles(...READ)
  async listProjects(@CurrentUser() user: AuthUser) {
    const projects = await this.projects().find({ where: { tenantId: user.tenantId }, order: { active: 'DESC', code: 'ASC' } });
    const counts = await this.employees.createQueryBuilder('e').select('e.projectId', 'projectId').addSelect('COUNT(*)', 'n')
      .where('e.tenantId = :t AND e.projectId IS NOT NULL', { t: user.tenantId }).groupBy('e.projectId').getRawMany<{ projectId: string; n: string }>();
    return projects.map((p) => ({ id: p.id, code: p.code, name: p.name, client: p.client, active: p.active, employees: Number(counts.find((c) => c.projectId === p.id)?.n ?? 0) }));
  }

  @Post('projects')
  @Roles(Role.SUPER_ADMIN)
  async createProject(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto, @Req() req: AppRequest) {
    if (await this.projects().exist({ where: { tenantId: user.tenantId, code: dto.code } })) throw new ConflictException('PROJECT_CODE_EXISTS');
    const { project } = await this.access.upsertProject(user.tenantId, dto.code, dto);
    await this.audit.fromRequest(req, { action: 'PROJECT_CREATED', entityType: 'project', entityId: project.id, details: { code: project.code } });
    return project;
  }

  @Patch('projects/:id')
  @Roles(Role.SUPER_ADMIN)
  async updateProject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto, @Req() req: AppRequest) {
    const p = await this.projects().findOne({ where: { id, tenantId: user.tenantId } });
    if (!p) throw new NotFoundException();
    if (dto.name !== undefined) p.name = dto.name;
    if (dto.client !== undefined) p.client = dto.client || null;
    if (dto.active !== undefined) p.active = dto.active;
    await this.projects().save(p);
    await this.audit.fromRequest(req, { action: 'PROJECT_UPDATED', entityType: 'project', entityId: p.id, details: { code: p.code, ...dto } });
    return p;
  }

  /** Only a job nobody is on; otherwise close it (active: false) and the history stays readable. */
  @Delete('projects/:id')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN)
  async deleteProject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const p = await this.projects().findOne({ where: { id, tenantId: user.tenantId } });
    if (!p) throw new NotFoundException();
    if (await this.employees.exist({ where: { tenantId: user.tenantId, projectId: p.id } })) throw new ConflictException('PROJECT_IN_USE');
    await this.projects().delete({ id: p.id });
    await this.audit.fromRequest(req, { action: 'PROJECT_DELETED', entityType: 'project', entityId: p.id, details: { code: p.code } });
    return { ok: true };
  }

  private projects() { return this.employees.manager.getRepository(Project); }

  // ------------------------------------------------------------------ employees
  @Get('employees')
  @Roles(...READ)
  async listEmployees(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    const doors = await this.visibleDoors(user);
    const doorById = new Map(doors.map((d) => [d.id, d]));
    const sites = new Map((await this.sites.find({ where: { tenantId: user.tenantId } })).map((s) => [s.id, s.name]));
    const all = await this.employees.find({ where: { tenantId: user.tenantId }, order: { externalId: 'ASC' } });
    const rules = all.length ? await this.rules.find({ where: { tenantId: user.tenantId, employeeId: In(all.map((e) => e.id)) } }) : [];
    // A site manager sees the employees who can open at least one door of their sites.
    const visible = visibleSiteIds(user) ? all.filter((e) => rules.some((r) => r.employeeId === e.id && doorById.has(r.doorId))) : all;
    const projects = new Map((await this.projects().find({ where: { tenantId: user.tenantId } })).map((p) => [p.id, p]));
    const tc = await this.keys.forTenant(user.tenantId);
    await this.audit.fromRequest(req, { action: 'EMPLOYEES_VIEW', details: { count: visible.length } });
    return visible.map((e) => ({
      id: e.id, externalId: e.externalId,
      firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'),
      email: tc.decrypt(e.emailEnc, 'employee.email'), department: tc.decrypt(e.departmentEnc, 'employee.department'), jobTitle: tc.decrypt(e.jobTitleEnc, 'employee.jobTitle'),
      source: e.source, active: e.active, validFrom: e.validFrom, validUntil: e.validUntil,
      project: e.projectId && projects.has(e.projectId) ? { id: e.projectId, code: projects.get(e.projectId)!.code, name: projects.get(e.projectId)!.name } : null,
      appsOff: e.appsOff, parkingRole: e.parkingRole, parkingSpotId: e.parkingSpotId, badgeHint: e.badgeHint, phoneBadge: !!e.credentialSecretEnc, phoneBadgeIssuedAt: e.credentialIssuedAt, updatedAt: e.updatedAt,
      permissions: rules.filter((r) => r.employeeId === e.id && doorById.has(r.doorId)).map((r) => {
        const d = doorById.get(r.doorId)!;
        return { doorExternalId: d.externalId, door: d.name, site: sites.get(d.siteId) ?? '—', days: r.days ? r.days.split(',').map(Number) : null, from: r.fromTime, to: r.toTime };
      }),
    }));
  }

  /**
   * By hand, for organisations without an HR system (or for a consultant it does not know).
   * Same rules as the integration API; only the administrator, since permissions span every site.
   */
  @Post('employees')
  @Roles(Role.SUPER_ADMIN)
  async createEmployee(@CurrentUser() user: AuthUser, @Body() dto: CreateEmployeeDto, @Req() req: AppRequest) {
    const { externalId: given, ...data } = dto;
    const externalId = given || `MAN-${this.crypto.randomCode(8)}`;
    if (await this.employees.exist({ where: { tenantId: user.tenantId, externalId } })) throw new ConflictException('EMPLOYEE_ID_EXISTS');
    await this.assertEmailFree(user.tenantId, data.email, null);
    const { employee } = await this.access.upsertEmployee(user.tenantId, externalId, data, 'CONSOLE');
    await this.audit.fromRequest(req, { action: 'EMPLOYEE_CREATED', entityType: 'employee', entityId: employee.id, details: { externalId, permissions: data.permissions.length } });
    return { id: employee.id, externalId };
  }

  /** Replaces the whole record like the API does. badgeUid: undefined keeps the card, null removes it. */
  @Put('employees/:id')
  @Roles(Role.SUPER_ADMIN)
  async updateEmployee(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PutEmployeeDto, @Req() req: AppRequest) {
    const e = await this.employees.findOne({ where: { id, tenantId: user.tenantId } });
    if (!e) throw new NotFoundException('EMPLOYEE_NOT_FOUND');
    await this.assertEmailFree(user.tenantId, dto.email, e.id);
    await this.access.upsertEmployee(user.tenantId, e.externalId, dto, 'CONSOLE');
    await this.audit.fromRequest(req, { action: 'EMPLOYEE_UPDATED', entityType: 'employee', entityId: e.id, details: { externalId: e.externalId, wasFromApi: e.source === 'API', permissions: dto.permissions.length, badge: dto.badgeUid === undefined ? 'kept' : dto.badgeUid ? 'set' : 'removed' } });
    return { ok: true };
  }

  /** Apps turned off for this person (console only: the HR system does not send it and never resets it). */
  @Put('employees/:id/apps')
  @Roles(Role.SUPER_ADMIN)
  async employeeApps(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EmployeeAppsDto, @Req() req: AppRequest) {
    const e = await this.employees.findOne({ where: { id, tenantId: user.tenantId }, select: { id: true, appsOff: true } });
    if (!e) throw new NotFoundException('EMPLOYEE_NOT_FOUND');
    const appsOff = APP_KEYS.filter((a) => dto.appsOff.includes(a));
    await this.employees.update(e.id, { appsOff });
    await this.audit.fromRequest(req, { action: 'EMPLOYEE_APPS_UPDATED', entityType: 'employee', entityId: e.id, details: { before: e.appsOff, after: appsOff } });
    return { appsOff };
  }

  /** Parking benefit: none, standard or manager with a fixed spot (one manager per spot). */
  @Put('employees/:id/parking')
  @Roles(Role.SUPER_ADMIN)
  @RequireApp('parking')
  async employeeParking(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EmployeeParkingDto, @Req() req: AppRequest) {
    const e = await this.employees.findOne({ where: { id, tenantId: user.tenantId }, select: { id: true, parkingRole: true, parkingSpotId: true } });
    if (!e) throw new NotFoundException('EMPLOYEE_NOT_FOUND');
    const spotId = dto.role === 'MANAGER' ? dto.spotId ?? null : null;
    if (dto.role === 'MANAGER' && !spotId) throw new BadRequestException('SPOT_REQUIRED');
    if (spotId) {
      if (!(await this.employees.manager.getRepository(ParkingSpot).exist({ where: { id: spotId, tenantId: user.tenantId, active: true } }))) throw new BadRequestException('SPOT_NOT_FOUND');
      const other = await this.employees.findOne({ where: { tenantId: user.tenantId, parkingRole: 'MANAGER', parkingSpotId: spotId }, select: { id: true } });
      if (other && other.id !== e.id) throw new ConflictException('SPOT_TAKEN');
    }
    await this.employees.update(e.id, { parkingRole: dto.role, parkingSpotId: spotId });
    if (e.parkingRole !== dto.role || e.parkingSpotId !== spotId) await this.parking.benefitChanged(user.tenantId, e.id);
    await this.audit.fromRequest(req, { action: 'EMPLOYEE_PARKING_UPDATED', entityType: 'employee', entityId: e.id, details: { before: { role: e.parkingRole, spotId: e.parkingSpotId }, after: { role: dto.role, spotId } } });
    return { role: dto.role, spotId };
  }

  @Delete('employees/:id')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN)
  async deleteEmployee(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const e = await this.employees.findOne({ where: { id, tenantId: user.tenantId } });
    if (!e) throw new NotFoundException('EMPLOYEE_NOT_FOUND');
    await this.access.deleteEmployee(user.tenantId, e.externalId);
    await this.audit.fromRequest(req, { action: 'EMPLOYEE_DELETED', entityType: 'employee', entityId: e.id, details: { externalId: e.externalId } });
    return { ok: true };
  }

  /** The email activates the phone badge: two people with the same one could not be told apart. */
  private async assertEmailFree(tenantId: string, email: string | null | undefined, selfId: string | null) {
    const clean = email?.trim().toLowerCase();
    if (!clean) return;
    const tc = await this.keys.forTenant(tenantId);
    const other = await this.employees.findOne({ where: { tenantId, emailIndex: tc.blindIndex(clean, 'employee.email')! }, select: { id: true } });
    if (other && other.id !== selfId) throw new ConflictException('EMPLOYEE_EMAIL_IN_USE');
  }

  /** Lost or changed phone: the current phone badge stops working; the employee activates it again. */
  @Post('employees/:id/revoke-phone')
  @HttpCode(200)
  @Roles(...MANAGE)
  async revokePhone(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const e = await this.employees.findOne({ where: { id, tenantId: user.tenantId } });
    if (!e) throw new NotFoundException();
    // Same visibility as the employee list: a site manager reaches only people who can open a door of their sites.
    if (visibleSiteIds(user)) {
      const doors = await this.visibleDoors(user);
      const reachable = doors.length > 0 && (await this.rules.exist({ where: { tenantId: user.tenantId, employeeId: e.id, doorId: In(doors.map((d) => d.id)) } }));
      if (!reachable) throw new NotFoundException();
    }
    await this.employees.update(e.id, { credentialSecretEnc: null, credentialIssuedAt: null, appTokenHash: null });
    await this.employees.manager.delete(PushDevice, { tenantId: user.tenantId, employeeId: e.id });
    await this.audit.fromRequest(req, { action: 'PHONE_BADGE_REVOKED', entityType: 'employee', entityId: e.id });
    return { ok: true };
  }

  // ------------------------------------------------------------------ access log
  @Get('events')
  @RequireApp('access')
  @Roles(...READ)
  async listEvents(@CurrentUser() user: AuthUser, @Query() q: AccessEventsQuery, @Req() req: AppRequest) {
    const from = new Date(q.from), to = new Date(q.to);
    if (!(from < to)) throw new BadRequestException('INVALID_RANGE');
    if (q.siteId) assertSiteAccess(user, q.siteId);
    const ids = q.siteId ? [q.siteId] : visibleSiteIds(user);
    // People of a job / contract: their ids now (whoever moved to it later counts, as the list is about people).
    const onProject = q.projectId ? (await this.employees.find({ where: { tenantId: user.tenantId, projectId: q.projectId }, select: { id: true } })).map((e) => e.id) : null;
    const rows = await this.events.find({
      where: { tenantId: user.tenantId, at: Between(from, to), ...(ids ? { siteId: In(ids.length ? ids : NONE) } : {}), ...(q.result ? { result: q.result as AccessEvent['result'] } : {}),
        ...(onProject ? { employeeId: In(onProject.length ? onProject : NONE) } : {}) },
      order: { at: 'DESC' }, take: q.limit ?? 500,
    });
    const tc = await this.keys.forTenant(user.tenantId);
    const emps = new Map((rows.length ? await this.employees.find({ where: { tenantId: user.tenantId, id: In([...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[]) } }) : []).map((e) => [e.id, e]));
    const doors = new Map((rows.length ? await this.doors.find({ where: { tenantId: user.tenantId, id: In([...new Set(rows.map((r) => r.doorId))]) } }) : []).map((d) => [d.id, d]));
    const sites = new Map((await this.sites.find({ where: { tenantId: user.tenantId } })).map((s) => [s.id, s]));
    const projects = new Map((await this.projects().find({ where: { tenantId: user.tenantId } })).map((p) => [p.id, p]));
    await this.audit.fromRequest(req, { action: 'ACCESS_LOG_VIEW', siteId: q.siteId ?? null, details: { from: q.from, to: q.to, rows: rows.length } });
    return rows.map((r) => {
      const e = r.employeeId ? emps.get(r.employeeId) : undefined;
      return {
        id: r.id, at: r.at, method: r.method, result: r.result, reason: r.reason,
        door: doors.get(r.doorId)?.name ?? '—', site: sites.get(r.siteId)?.name ?? '—', timezone: sites.get(r.siteId)?.timezone ?? 'UTC',
        employee: e ? `${tc.decrypt(e.lastNameEnc, 'employee.lastName')} ${tc.decrypt(e.firstNameEnc, 'employee.firstName')}` : null,
        externalId: e?.externalId ?? null,
        project: e?.projectId ? projects.get(e.projectId)?.code ?? null : null,
      };
    });
  }

  // ------------------------------------------------------------------ integration API keys
  @Get('api-keys')
  @Roles(Role.SUPER_ADMIN)
  listKeys(@CurrentUser() user: AuthUser) {
    return this.apiKeys.find({ where: { tenantId: user.tenantId }, order: { createdAt: 'DESC' }, select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true } });
  }

  /** The key is shown once: only its hash is stored. */
  @Post('api-keys')
  @Roles(Role.SUPER_ADMIN)
  async createKey(@CurrentUser() user: AuthUser, @Body() dto: ApiKeyDto, @Req() req: AppRequest) {
    const key = `drk_${this.crypto.randomToken(32)}`;
    const saved = await this.apiKeys.save(this.apiKeys.create({ tenantId: user.tenantId, name: dto.name, prefix: key.slice(0, 12), keyHash: this.crypto.sha256(key), createdBy: user.id, lastUsedAt: null, revokedAt: null }));
    await this.audit.fromRequest(req, { action: 'API_KEY_CREATED', entityType: 'api_key', entityId: saved.id, details: { name: dto.name } });
    return { id: saved.id, key };
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN)
  async revokeKey(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const res = await this.apiKeys.update({ id, tenantId: user.tenantId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!res.affected) throw new NotFoundException();
    await this.audit.fromRequest(req, { action: 'API_KEY_REVOKED', entityType: 'api_key', entityId: id });
    return { ok: true };
  }
}
