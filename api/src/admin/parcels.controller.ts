import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { DataSource, In, IsNull, LessThan } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { FilesService } from '../common/files.service';
import { AdminAuthGuard, assertSiteAccess, CurrentUser, Roles } from '../common/guards';
import { MailService } from '../common/mail.service';
import { PushService } from '../common/push.service';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { addDays } from '../common/time.util';
import { CARRIER_NAMES, CARRIERS, Employee, FileKind, NoticeEmailStatus, Parcel, Role, Site, StoredFile, type Carrier } from '../entities';

/** The photo of a parcel is kept while it waits and a week after it is collected; the record for six months. */
export const PARCEL_PHOTO_DAYS = 90;
export const PARCEL_PHOTO_AFTER_COLLECT_DAYS = 7;
export const PARCEL_KEEP_DAYS = 180;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value);

export class ParcelListQuery {
  @IsUUID() siteId: string;
  @IsOptional() @IsIn(['WAITING', 'COLLECTED']) status?: 'WAITING' | 'COLLECTED';
}
export class RecipientQuery {
  @Transform(trim) @IsString() @Length(2, 60) q: string;
}
export class CreateParcelDto {
  @IsUUID() siteId: string;
  @IsUUID() employeeId: string;
  @IsIn(CARRIERS) carrier: Carrier;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pieces?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) tracking?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsString() @MaxLength(5_000_000) photo?: string;
}

const STAFF = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST];
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Parcels and letters left at reception. The staff register them (recipient, carrier, an optional
 * photo); the employee hears it on the phone and by email and collects it, and the staff mark it handed over.
 */
@Controller('admin/parcels')
@UseGuards(AdminAuthGuard)
export class ParcelsController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly keys: TenantKeysService,
    private readonly files: FilesService,
    private readonly push: PushService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private async load(user: AuthUser, id: string) {
    const p = await this.ds.getRepository(Parcel).findOne({ where: { id, tenantId: user.tenantId } });
    if (!p) throw new NotFoundException();
    assertSiteAccess(user, p.siteId);
    return p;
  }

  /** Who a parcel can be for: active employees by name, only what is needed to pick the right one. */
  @Get('recipients')
  @Roles(...STAFF)
  async recipients(@CurrentUser() user: AuthUser, @Query() q: RecipientQuery) {
    const tc = await this.keys.forTenant(user.tenantId);
    const term = norm(q.q);
    const all = await this.ds.getRepository(Employee).find({ where: { tenantId: user.tenantId, active: true }, select: { id: true, firstNameEnc: true, lastNameEnc: true, departmentEnc: true } });
    const out: { id: string; firstName: string; lastName: string; department: string | null }[] = [];
    for (const e of all) {
      const firstName = tc.decrypt(e.firstNameEnc, 'employee.firstName') ?? '', lastName = tc.decrypt(e.lastNameEnc, 'employee.lastName') ?? '';
      const full = norm(`${firstName} ${lastName}`), rev = norm(`${lastName} ${firstName}`);
      if (full.includes(term) || rev.includes(term)) out.push({ id: e.id, firstName, lastName, department: tc.decrypt(e.departmentEnc, 'employee.department') });
    }
    return out.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)).slice(0, 12);
  }

  @Get()
  @Roles(...STAFF, Role.AUDITOR)
  async list(@CurrentUser() user: AuthUser, @Query() q: ParcelListQuery) {
    assertSiteAccess(user, q.siteId);
    const status = q.status ?? 'WAITING';
    const rows = await this.ds.getRepository(Parcel).find({
      where: { tenantId: user.tenantId, siteId: q.siteId, status }, order: { [status === 'WAITING' ? 'receivedAt' : 'collectedAt']: status === 'WAITING' ? 'ASC' : 'DESC' }, take: status === 'WAITING' ? 500 : 100,
    });
    if (!rows.length) return [];
    const tc = await this.keys.forTenant(user.tenantId);
    const employees = new Map((await this.ds.getRepository(Employee).find({ where: { tenantId: user.tenantId, id: In([...new Set(rows.map((r) => r.employeeId))]) } })).map((e) => [e.id, e]));
    const photos = new Set((await this.ds.getRepository(StoredFile).createQueryBuilder('f').select('f.parcelId', 'parcelId')
      .where('f.tenantId = :t AND f.parcelId IN (:...ids) AND f.purgedAt IS NULL', { t: user.tenantId, ids: rows.map((r) => r.id) }).getRawMany<{ parcelId: string }>()).map((r) => r.parcelId));
    return rows.map((r) => {
      const e = employees.get(r.employeeId);
      return {
        id: r.id, carrier: r.carrier, pieces: r.pieces, status: r.status, receivedAt: r.receivedAt, collectedAt: r.collectedAt, emailStatus: r.emailStatus,
        tracking: tc.decrypt(r.trackingEnc, 'parcel.tracking'), note: tc.decrypt(r.noteEnc, 'parcel.note'), hasPhoto: photos.has(r.id),
        recipient: e ? { id: e.id, firstName: tc.decrypt(e.firstNameEnc, 'employee.firstName'), lastName: tc.decrypt(e.lastNameEnc, 'employee.lastName'), department: tc.decrypt(e.departmentEnc, 'employee.department') } : null,
      };
    });
  }

  @Post()
  @Roles(...STAFF)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateParcelDto, @Req() req: AppRequest) {
    assertSiteAccess(user, dto.siteId);
    const site = await this.ds.getRepository(Site).findOne({ where: { id: dto.siteId, tenantId: user.tenantId, active: true } });
    if (!site) throw new BadRequestException('SITE_NOT_FOUND');
    const employee = await this.ds.getRepository(Employee).findOne({ where: { id: dto.employeeId, tenantId: user.tenantId, active: true } });
    if (!employee) throw new BadRequestException('EMPLOYEE_NOT_FOUND');
    const photo = dto.photo ? this.files.parseImage(dto.photo, 'photo') : null;
    const tc = await this.keys.forTenant(user.tenantId);
    const now = new Date();
    const pieces = dto.pieces ?? 1;
    // The email waits in the outbox; without SMTP or an address on file it is simply not sent.
    const emailStatus = !employee.emailEnc ? NoticeEmailStatus.NOT_REQUESTED : this.mail.enabled ? NoticeEmailStatus.PENDING : NoticeEmailStatus.SKIPPED;
    let pushQueued = false;
    const parcel = await this.ds.transaction(async (em) => {
      const p = await em.save(em.create(Parcel, {
        tenantId: user.tenantId, siteId: site.id, employeeId: employee.id, carrier: dto.carrier, pieces, status: 'WAITING',
        trackingEnc: tc.encrypt(dto.tracking ?? null, 'parcel.tracking'), noteEnc: tc.encrypt(dto.note ?? null, 'parcel.note'),
        receivedAt: now, receivedByUserId: user.id, collectedAt: null, collectedByUserId: null, emailStatus, emailAttempts: 0,
      }));
      if (photo) await this.files.store(em, tc, { parcelId: p.id }, FileKind.PARCEL, photo, addDays(now, PARCEL_PHOTO_DAYS));
      pushQueued = await this.push.enqueueParcel(em, user.tenantId, employee.id, { site: site.name, carrier: CARRIER_NAMES[dto.carrier], pieces });
      return p;
    });
    if (pushQueued) this.push.kick();
    await this.audit.fromRequest(req, { action: 'PARCEL_RECEIVED', entityType: 'parcel', entityId: parcel.id, siteId: site.id, details: { employeeId: employee.id, carrier: dto.carrier, pieces, photo: !!photo } });
    return { id: parcel.id, pushQueued, emailStatus };
  }

  /** Handed over to the employee (or to whoever they sent). */
  @Post(':id/collect')
  @HttpCode(200)
  @Roles(...STAFF)
  async collect(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const p = await this.load(user, id);
    const now = new Date();
    const res = await this.ds.getRepository(Parcel).update({ id: p.id, status: 'WAITING' }, { status: 'COLLECTED', collectedAt: now, collectedByUserId: user.id });
    if (!res.affected) throw new ConflictException('PARCEL_ALREADY_COLLECTED');
    // The photo has done its job: it goes a week later.
    await this.ds.getRepository(StoredFile).update({ tenantId: user.tenantId, parcelId: p.id, purgedAt: IsNull() }, { purgeAfter: addDays(now, PARCEL_PHOTO_AFTER_COLLECT_DAYS) });
    await this.audit.fromRequest(req, { action: 'PARCEL_COLLECTED', entityType: 'parcel', entityId: p.id, siteId: p.siteId });
    return { ok: true, collectedAt: now };
  }

  /** Registered by mistake: removed with its photo, while it is still waiting. */
  @Delete(':id')
  @Roles(...STAFF)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const p = await this.load(user, id);
    if (p.status !== 'WAITING') throw new ConflictException('PARCEL_ALREADY_COLLECTED');
    const photos = await this.ds.getRepository(StoredFile).find({ where: { tenantId: user.tenantId, parcelId: p.id, purgedAt: IsNull() } });
    for (const f of photos) await this.files.purge(f);
    await this.ds.getRepository(Parcel).delete({ id: p.id, status: 'WAITING' });
    await this.audit.fromRequest(req, { action: 'PARCEL_DELETED', entityType: 'parcel', entityId: p.id, siteId: p.siteId });
    return { ok: true };
  }

  @Get(':id/photo')
  @Roles(...STAFF, Role.AUDITOR)
  async photo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const p = await this.load(user, id);
    const f = await this.ds.getRepository(StoredFile).findOne({ where: { tenantId: user.tenantId, parcelId: p.id, purgedAt: IsNull() } });
    if (!f) throw new NotFoundException();
    const data = await this.files.read(await this.keys.forTenant(user.tenantId), f);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(data);
  }
}

/** Retention: collected parcels older than PARCEL_KEEP_DAYS disappear (their photos are already purged). */
export function expiredParcels(now: Date) {
  return { status: 'COLLECTED' as const, collectedAt: LessThan(addDays(now, -PARCEL_KEEP_DAYS)) };
}
