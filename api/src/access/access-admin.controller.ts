import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Between, In, IsNull, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { AdminAuthGuard, CurrentUser, Roles, assertSiteAccess, visibleSiteIds } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { AccessEvent, AccessRule, ApiKey, Door, DoorReader, Employee, PairingCode, Role, Site } from '../entities';
import { EXTERNAL_ID } from './integration.controller';

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
export class ReaderCodeDto {
  @Transform(trim) @IsString() @Length(2, 80) name: string;
}
export class ApiKeyDto {
  @Transform(trim) @IsString() @Length(2, 80) name: string;
}
export class AccessEventsQuery {
  @IsISO8601() from: string;
  @IsISO8601() to: string;
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsIn(['GRANTED', 'DENIED']) result?: 'GRANTED' | 'DENIED';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2000) limit?: number;
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
  ) {}

  private async visibleDoors(user: AuthUser) {
    const ids = visibleSiteIds(user);
    return this.doors.find({ where: { tenantId: user.tenantId, ...(ids ? { siteId: In(ids.length ? ids : NONE) } : {}) }, order: { name: 'ASC' } });
  }

  // ------------------------------------------------------------------ doors and readers
  @Get('doors')
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

  // ------------------------------------------------------------------ employees (read-only mirror)
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
    const tc = await this.keys.forTenant(user.tenantId);
    await this.audit.fromRequest(req, { action: 'EMPLOYEES_VIEW', details: { count: visible.length } });
    return visible.map((e) => ({
      id: e.id, externalId: e.externalId,
      firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'),
      email: tc.decrypt(e.emailEnc, 'employee.email'), active: e.active, validFrom: e.validFrom, validUntil: e.validUntil,
      badgeHint: e.badgeHint, phoneBadge: !!e.credentialSecretEnc, phoneBadgeIssuedAt: e.credentialIssuedAt, updatedAt: e.updatedAt,
      permissions: rules.filter((r) => r.employeeId === e.id && doorById.has(r.doorId)).map((r) => {
        const d = doorById.get(r.doorId)!;
        return { door: d.name, site: sites.get(d.siteId) ?? '—', days: r.days ? r.days.split(',').map(Number) : null, from: r.fromTime, to: r.toTime };
      }),
    }));
  }

  /** Lost or changed phone: the current phone badge stops working; the employee activates it again. */
  @Post('employees/:id/revoke-phone')
  @HttpCode(200)
  @Roles(...MANAGE)
  async revokePhone(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const e = await this.employees.findOne({ where: { id, tenantId: user.tenantId } });
    if (!e) throw new NotFoundException();
    await this.employees.update(e.id, { credentialSecretEnc: null, credentialIssuedAt: null });
    await this.audit.fromRequest(req, { action: 'PHONE_BADGE_REVOKED', entityType: 'employee', entityId: e.id });
    return { ok: true };
  }

  // ------------------------------------------------------------------ access log
  @Get('events')
  @Roles(...READ)
  async listEvents(@CurrentUser() user: AuthUser, @Query() q: AccessEventsQuery, @Req() req: AppRequest) {
    const from = new Date(q.from), to = new Date(q.to);
    if (!(from < to)) throw new BadRequestException('INVALID_RANGE');
    if (q.siteId) assertSiteAccess(user, q.siteId);
    const ids = q.siteId ? [q.siteId] : visibleSiteIds(user);
    const rows = await this.events.find({
      where: { tenantId: user.tenantId, at: Between(from, to), ...(ids ? { siteId: In(ids.length ? ids : NONE) } : {}), ...(q.result ? { result: q.result as AccessEvent['result'] } : {}) },
      order: { at: 'DESC' }, take: q.limit ?? 500,
    });
    const tc = await this.keys.forTenant(user.tenantId);
    const emps = new Map((rows.length ? await this.employees.find({ where: { tenantId: user.tenantId, id: In([...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[]) } }) : []).map((e) => [e.id, e]));
    const doors = new Map((rows.length ? await this.doors.find({ where: { tenantId: user.tenantId, id: In([...new Set(rows.map((r) => r.doorId))]) } }) : []).map((d) => [d.id, d]));
    const sites = new Map((await this.sites.find({ where: { tenantId: user.tenantId } })).map((s) => [s.id, s]));
    await this.audit.fromRequest(req, { action: 'ACCESS_LOG_VIEW', siteId: q.siteId ?? null, details: { from: q.from, to: q.to, rows: rows.length } });
    return rows.map((r) => {
      const e = r.employeeId ? emps.get(r.employeeId) : undefined;
      return {
        id: r.id, at: r.at, method: r.method, result: r.result, reason: r.reason,
        door: doors.get(r.doorId)?.name ?? '—', site: sites.get(r.siteId)?.name ?? '—', timezone: sites.get(r.siteId)?.timezone ?? 'UTC',
        employee: e ? `${tc.decrypt(e.lastNameEnc, 'employee.lastName')} ${tc.decrypt(e.firstNameEnc, 'employee.firstName')}` : null,
        externalId: e?.externalId ?? null,
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
