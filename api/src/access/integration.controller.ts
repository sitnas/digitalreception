import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { AppRequest } from '../common/request-context';
import { AccessRule, Door, Employee, Site } from '../entities';
import { ApiKeyGuard, CurrentApiKey } from './access.guards';
import { AccessService } from './access.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const NAME = /^[\p{L}\p{M}' .-]+$/u;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const EXTERNAL_ID = /^[A-Za-z0-9._:@-]{1,100}$/;

export class PermissionDto {
  @IsString() @Matches(EXTERNAL_ID) door: string;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days?: number[];
  @IsOptional() @Matches(HHMM) from?: string;
  @IsOptional() @Matches(HHMM) to?: string;
}

export class PutEmployeeDto {
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) firstName: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) lastName: string;
  @IsOptional() @IsEmail() @MaxLength(190) email?: string | null;
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[0-9A-Fa-f:\- ]*$/) badgeUid?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsISO8601() validFrom?: string | null;
  @IsOptional() @IsISO8601() validUntil?: string | null;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PermissionDto) permissions: PermissionDto[];
}

export class PutDoorDto {
  @IsString() @Length(1, 20) siteCode: string;
  @Transform(trim) @IsString() @Length(1, 80) name: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class EventsQuery {
  @IsISO8601() since: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}

export class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

const assertId = (id: string) => { if (!EXTERNAL_ID.test(id)) throw new BadRequestException('INVALID_EXTERNAL_ID'); };
const PAGE = 500;

/**
 * Integration API for the external HR / access system. Every call is idempotent: PUT replaces the
 * whole record (permissions included), DELETE removes it. Identifiers are the external system's own.
 */
@Controller('integration/v1')
@UseGuards(ApiKeyGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class IntegrationController {
  constructor(
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Door) private readonly doors: Repository<Door>,
    @InjectRepository(AccessRule) private readonly rules: Repository<AccessRule>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
  ) {}

  @Get('doors')
  async listDoors(@CurrentApiKey() key: { tenantId: string }) {
    const doors = await this.doors.find({ where: { tenantId: key.tenantId }, order: { externalId: 'ASC' } });
    const sites = new Map((await this.sites.find({ where: { tenantId: key.tenantId } })).map((s) => [s.id, s.code]));
    return doors.map((d) => ({ id: d.externalId, name: d.name, siteCode: sites.get(d.siteId), active: d.active }));
  }

  @Put('doors/:externalId')
  async putDoor(@CurrentApiKey() key: { id: string; tenantId: string }, @Param('externalId') externalId: string, @Body() dto: PutDoorDto, @Req() req: AppRequest) {
    assertId(externalId);
    const { created, door } = await this.access.upsertDoor(key.tenantId, externalId, dto);
    await this.audit.fromRequest(req, { action: 'API_DOOR_UPSERT', entityType: 'door', entityId: door.id, siteId: door.siteId, details: { apiKey: key.id, externalId, created } });
    return { id: door.externalId, created };
  }

  @Get('employees')
  async listEmployees(@CurrentApiKey() key: { tenantId: string }, @Query() q: ListQuery) {
    const page = q.page ?? 1;
    const [rows, total] = await this.employees.findAndCount({ where: { tenantId: key.tenantId }, order: { externalId: 'ASC' }, skip: (page - 1) * PAGE, take: PAGE });
    const counts = new Map<string, number>();
    for (const r of await this.rules.find({ where: { tenantId: key.tenantId, employeeId: In(rows.map((e) => e.id)) }, select: { employeeId: true } })) counts.set(r.employeeId, (counts.get(r.employeeId) ?? 0) + 1);
    return {
      page, total,
      items: rows.map((e) => ({ id: e.externalId, active: e.active, badge: !!e.badgeIndex, phoneBadge: !!e.credentialSecretEnc, permissions: counts.get(e.id) ?? 0, updatedAt: e.updatedAt })),
    };
  }

  @Put('employees/:externalId')
  async putEmployee(@CurrentApiKey() key: { id: string; tenantId: string }, @Param('externalId') externalId: string, @Body() dto: PutEmployeeDto, @Req() req: AppRequest) {
    assertId(externalId);
    const { created, employee } = await this.access.upsertEmployee(key.tenantId, externalId, dto);
    await this.audit.fromRequest(req, { action: 'API_EMPLOYEE_UPSERT', entityType: 'employee', entityId: employee.id, details: { apiKey: key.id, externalId, created, permissions: dto.permissions.length } });
    return { id: employee.externalId, created };
  }

  @Delete('employees/:externalId')
  @HttpCode(200)
  async deleteEmployee(@CurrentApiKey() key: { id: string; tenantId: string }, @Param('externalId') externalId: string, @Req() req: AppRequest) {
    assertId(externalId);
    const e = await this.access.deleteEmployee(key.tenantId, externalId);
    await this.audit.fromRequest(req, { action: 'API_EMPLOYEE_DELETE', entityType: 'employee', entityId: e.id, details: { apiKey: key.id, externalId } });
    return { id: externalId, deleted: true };
  }

  /** Access log for the external system, in time order: poll with the "at" of the last event received. */
  @Get('events')
  events(@CurrentApiKey() key: { tenantId: string }, @Query() q: EventsQuery) {
    return this.access.eventsSince(key.tenantId, new Date(q.since), q.limit ?? 500);
  }
}
