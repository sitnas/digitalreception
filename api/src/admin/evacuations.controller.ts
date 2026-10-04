import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsIn, IsUUID } from 'class-validator';
import { DataSource, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { AdminAuthGuard, assertSiteAccess, CurrentUser, Roles } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { TenantKeysService } from '../common/tenant-keys.service';
import { startOfLocalDay } from '../common/time.util';
import { WebhooksService } from '../common/webhooks.service';
import { AccessEvent, AccessResult, CountryPolicy, Employee, Evacuation, EvacuationCheck, Role, Site, Visit, VisitStatus } from '../entities';

export class SiteQuery {
  @IsUUID() siteId: string;
}
export class StartEvacuationDto {
  @IsUUID() siteId: string;
}
export class CheckDto {
  @IsIn(['visit', 'employee']) kind: 'visit' | 'employee';
  @IsUUID() refId: string;
  @IsBoolean() safe: boolean;
}

const MARSHALS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST];

export interface EvacuationPerson {
  kind: 'visit' | 'employee'; id: string; name: string; detail: string | null; since: Date;
  safeAt: Date | null; safeBy: string | null;
}

/**
 * Evacuation of a site. Who is inside: guests with an open visit, and employees who passed a door of
 * the site today (the readers record entries, not exits: the list says so). During the evacuation
 * the marshals tick who reached the assembly point; several phones can do it at once.
 */
@Controller('admin/evacuations')
@UseGuards(AdminAuthGuard)
@Roles(...MARSHALS)
export class EvacuationsController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Evacuation) private readonly evacuations: Repository<Evacuation>,
    @InjectRepository(EvacuationCheck) private readonly checks: Repository<EvacuationCheck>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly keys: TenantKeysService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  private async site(user: AuthUser, siteId: string) {
    assertSiteAccess(user, siteId);
    const site = await this.sites.findOne({ where: { id: siteId, tenantId: user.tenantId } });
    if (!site) throw new NotFoundException('SITE_NOT_FOUND');
    return site;
  }

  /** People inside the site right now, with the roll call of the evacuation if one is running. */
  private async people(tenantId: string, site: Site, evacuation: Evacuation | null): Promise<EvacuationPerson[]> {
    const tc = await this.keys.forTenant(tenantId);
    const visits = await this.ds.getRepository(Visit).find({ where: { tenantId, siteId: site.id, status: VisitStatus.OPEN }, order: { checkInAt: 'ASC' } });
    const since = startOfLocalDay(new Date(), site.timezone);
    const passages = await this.ds.getRepository(AccessEvent).find({ where: { tenantId, siteId: site.id, result: AccessResult.GRANTED, at: MoreThanOrEqual(since) }, order: { at: 'ASC' } });
    const firstPass = new Map<string, Date>();
    for (const p of passages) if (p.employeeId && !firstPass.has(p.employeeId)) firstPass.set(p.employeeId, p.at);
    const employees = firstPass.size ? await this.ds.getRepository(Employee).find({ where: { tenantId, id: In([...firstPass.keys()]) } }) : [];
    const checks = evacuation ? await this.checks.find({ where: { evacuationId: evacuation.id } }) : [];
    const safe = (kind: string, id: string) => checks.find((c) => c.kind === kind && c.refId === id);
    // Guests who left after the alarm stay on the list once ticked, so the count does not change under the marshals.
    const ticked = checks.filter((c) => c.kind === 'visit' && !visits.some((v) => v.id === c.refId)).map((c) => c.refId);
    if (ticked.length) visits.push(...await this.ds.getRepository(Visit).find({ where: { tenantId, id: In(ticked) } }));
    const out: EvacuationPerson[] = [
      ...visits.map((v) => {
        const c = safe('visit', v.id);
        const company = tc.decrypt(v.companyEnc, 'visit.company'), host = tc.decrypt(v.hostEnc, 'visit.host');
        return {
          kind: 'visit' as const, id: v.id, name: `${tc.decrypt(v.lastNameEnc, 'visit.lastName') ?? ''} ${tc.decrypt(v.firstNameEnc, 'visit.firstName') ?? ''}`.trim(),
          detail: [company, host].filter(Boolean).join(' · ') || null, since: v.checkInAt, safeAt: c?.checkedAt ?? null, safeBy: c?.checkedByUserId ?? null,
        };
      }),
      ...employees.map((e) => {
        const c = safe('employee', e.id);
        return {
          kind: 'employee' as const, id: e.id, name: `${tc.decrypt(e.lastNameEnc, 'employee.lastName')} ${tc.decrypt(e.firstNameEnc, 'employee.firstName')}`,
          detail: tc.decrypt(e.departmentEnc, 'employee.department'), since: firstPass.get(e.id)!, safeAt: c?.checkedAt ?? null, safeBy: c?.checkedByUserId ?? null,
        };
      }),
    ];
    return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'visit' ? -1 : 1));
  }

  private active(tenantId: string, siteId: string) {
    return this.evacuations.findOne({ where: { tenantId, siteId, endedAt: IsNull() } });
  }

  @Get('current')
  async current(@CurrentUser() user: AuthUser, @Query() q: SiteQuery, @Req() req: AppRequest) {
    const site = await this.site(user, q.siteId);
    const evacuation = await this.active(user.tenantId, site.id);
    const people = await this.people(user.tenantId, site, evacuation);
    await this.audit.fromRequest(req, { action: 'EVACUATION_LIST_VIEW', siteId: site.id, details: { people: people.length, evacuation: evacuation?.id ?? null } });
    return { evacuation, people, timezone: site.timezone };
  }

  /** The alarm: start the roll call. Teams/Slack get told at once (no names). */
  @Post()
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartEvacuationDto, @Req() req: AppRequest) {
    const site = await this.site(user, dto.siteId);
    if (await this.active(user.tenantId, site.id)) throw new ConflictException('EVACUATION_RUNNING');
    const people = await this.people(user.tenantId, site, null);
    const evacuation = await this.ds.transaction(async (em) => {
      const e = await em.save(em.create(Evacuation, { tenantId: user.tenantId, siteId: site.id, startedAt: new Date(), startedByUserId: user.id, endedAt: null, endedByUserId: null, peopleCount: null, safeCount: null }));
      const policy = await em.findOne(CountryPolicy, { where: { tenantId: user.tenantId, countryCode: site.countryCode }, select: { tenantId: true, countryCode: true, defaultLocale: true } });
      await this.webhooks.enqueue(em, user.tenantId, site.id, 'evacuation.started', {
        site: site.name, locale: policy?.defaultLocale ?? 'en', guests: people.filter((p) => p.kind === 'visit').length, employees: people.filter((p) => p.kind === 'employee').length,
      });
      return e;
    });
    await this.audit.fromRequest(req, { action: 'EVACUATION_STARTED', entityType: 'evacuation', entityId: evacuation.id, siteId: site.id, details: { people: people.length } });
    return evacuation;
  }

  /** Tick (or untick, for a mistake) a person at the assembly point. */
  @Post(':id/checks')
  @HttpCode(200)
  async check(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckDto) {
    const e = await this.evacuations.findOne({ where: { id, tenantId: user.tenantId } });
    if (!e) throw new NotFoundException();
    assertSiteAccess(user, e.siteId);
    if (e.endedAt) throw new BadRequestException('EVACUATION_ENDED');
    if (dto.safe) {
      await this.checks.createQueryBuilder().insert().orIgnore()
        .values({ tenantId: user.tenantId, evacuationId: e.id, kind: dto.kind, refId: dto.refId, checkedByUserId: user.id }).execute();
    } else {
      await this.checks.delete({ evacuationId: e.id, kind: dto.kind, refId: dto.refId });
    }
    return { ok: true };
  }

  /** Everyone accounted for (or the drill is over): close and keep the counts. */
  @Post(':id/end')
  @HttpCode(200)
  async end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const e = await this.evacuations.findOne({ where: { id, tenantId: user.tenantId } });
    if (!e) throw new NotFoundException();
    const site = await this.site(user, e.siteId);
    if (e.endedAt) return e;
    const people = await this.people(user.tenantId, site, e);
    const safeCount = people.filter((p) => p.safeAt).length;
    await this.evacuations.update(e.id, { endedAt: new Date(), endedByUserId: user.id, peopleCount: people.length, safeCount });
    await this.audit.fromRequest(req, { action: 'EVACUATION_ENDED', entityType: 'evacuation', entityId: e.id, siteId: site.id, details: { people: people.length, safe: safeCount, missing: people.length - safeCount } });
    return { ...e, endedAt: new Date(), peopleCount: people.length, safeCount };
  }

  /** Past evacuations and drills of the site, with their counts. */
  @Get()
  async history(@CurrentUser() user: AuthUser, @Query() q: SiteQuery) {
    await this.site(user, q.siteId);
    return this.evacuations.find({ where: { tenantId: user.tenantId, siteId: q.siteId }, order: { startedAt: 'DESC' }, take: 20 });
  }
}
