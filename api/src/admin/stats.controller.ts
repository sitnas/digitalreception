import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { AuditService } from '../common/audit.service';
import { AdminAuthGuard, CurrentUser, Roles, assertSiteAccess, visibleSiteIds } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { Role, Site, TravelDistance, Visit, VisitPurpose, VisitStatus } from '../entities';

export class StatsQueryDto {
  @IsOptional() @IsUUID() siteId?: string;
  @IsISO8601() from: string;
  @IsISO8601() to: string;
}

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

/**
 * Aggregate statistics. Reads only non-personal columns (site, times, purpose, distance, status),
 * so the numbers stay valid after visits are anonymised and never expose who visited.
 */
@Controller('admin/stats')
@UseGuards(AdminAuthGuard)
export class StatsController {
  constructor(
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR)
  async stats(@CurrentUser() user: AuthUser, @Query() q: StatsQueryDto, @Req() req: AppRequest) {
    const from = new Date(q.from), to = new Date(q.to);
    if (!(from < to)) throw new BadRequestException('INVALID_RANGE');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) throw new BadRequestException('RANGE_TOO_LARGE');

    const qb = this.visits.createQueryBuilder('v')
      .select(['v.siteId', 'v.checkInAt', 'v.checkOutAt', 'v.purpose', 'v.travelDistance', 'v.status'])
      .where('v.tenantId = :tid', { tid: user.tenantId })
      .andWhere('v.checkInAt >= :from AND v.checkInAt < :to', { from, to });
    if (q.siteId) { assertSiteAccess(user, q.siteId); qb.andWhere('v.siteId = :siteId', { siteId: q.siteId }); }
    else {
      const ids = visibleSiteIds(user);
      if (ids) qb.andWhere(ids.length ? 'v.siteId IN (:...ids)' : '1=0', { ids });
    }
    const rows = await qb.getMany();
    const siteList = await this.sites.find({ where: { tenantId: user.tenantId }, select: { id: true, name: true, timezone: true } });
    const siteById = new Map(siteList.map((s) => [s.id, s]));

    // Local calendar day / hour / weekday of each arrival, in the time zone of its site.
    const fmt = new Map<string, Intl.DateTimeFormat>();
    const local = (d: Date, tz: string) => {
      let f = fmt.get(tz);
      if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }); fmt.set(tz, f); }
      const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
      return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
    };

    const byDay = new Map<string, number>();
    const byHour = new Array<number>(24).fill(0);
    const byWeekday = new Array<number>(7).fill(0);
    const byPurpose = Object.fromEntries(Object.values(VisitPurpose).map((p) => [p, 0])) as Record<VisitPurpose, number>;
    const byDistance = { ...Object.fromEntries(Object.values(TravelDistance).map((d) => [d, 0])), UNKNOWN: 0 } as Record<TravelDistance | 'UNKNOWN', number>;
    const bySite = new Map<string, number>();
    const durations: number[] = [];

    for (const v of rows) {
      const tz = siteById.get(v.siteId)?.timezone ?? 'UTC';
      const l = local(v.checkInAt, tz);
      byDay.set(l.day, (byDay.get(l.day) ?? 0) + 1);
      byHour[l.hour]++;
      if (l.weekday >= 0) byWeekday[l.weekday]++;
      byPurpose[v.purpose] = (byPurpose[v.purpose] ?? 0) + 1;
      byDistance[v.travelDistance ?? 'UNKNOWN']++;
      bySite.set(v.siteId, (bySite.get(v.siteId) ?? 0) + 1);
      // Only real check-outs count for duration: automatic closures would distort it.
      if (v.status === VisitStatus.CLOSED && v.checkOutAt) durations.push((v.checkOutAt.getTime() - v.checkInAt.getTime()) / 60_000);
    }

    // Every day of the range appears, including the empty ones (a gap is information).
    const tz = q.siteId ? siteById.get(q.siteId)?.timezone ?? 'UTC' : 'UTC';
    const days: { date: string; count: number }[] = [];
    for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) {
      const d = local(new Date(t), tz).day;
      if (!days.length || days[days.length - 1].date !== d) days.push({ date: d, count: byDay.get(d) ?? 0 });
    }
    for (const [d, c] of byDay) if (!days.some((x) => x.date === d)) days.push({ date: d, count: c });
    days.sort((a, b) => a.date.localeCompare(b.date));

    durations.sort((a, b) => a - b);
    const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
    const avg = durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : null;

    await this.audit.fromRequest(req, { action: 'STATS_VIEW', siteId: q.siteId ?? null, details: { from: q.from, to: q.to, visits: rows.length } });
    return {
      total: rows.length,
      days: days.length,
      avgPerDay: days.length ? rows.length / days.length : 0,
      durationMinutes: { average: avg === null ? null : Math.round(avg), median: median === null ? null : Math.round(median), sample: durations.length },
      byDay: days,
      byHour,
      byWeekday,
      byPurpose,
      byDistance,
      bySite: [...bySite].map(([id, count]) => ({ id, name: siteById.get(id)?.name ?? '—', count })).sort((a, b) => b.count - a.count),
    };
  }
}
