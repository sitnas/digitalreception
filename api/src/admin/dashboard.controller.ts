import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { AdminAuthGuard, CurrentUser, visibleSiteIds } from '../common/guards';
import { AuthUser } from '../common/request-context';
import { AccessEvent, AccessResult, Parcel, ParkingBooking, ParkingSpot, Role, Site, Tenant, Visit, VisitPurpose, VisitStatus } from '../entities';

const DAY_MS = 86_400_000;
/** Roles that read each app's numbers, as on the app's own pages. */
const VISITS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];
const ACCESS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR];
const PARCELS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];
const PARKING = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];

/** Calendar day (YYYY-MM-DD) of an instant in a time zone. */
const dayFmt = new Map<string, Intl.DateTimeFormat>();
function localDay(d: Date, tz: string) {
  let f = dayFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); dayFmt.set(tz, f); }
  return f.format(d);
}
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The console's home: a few numbers per app, for the sites the person can see. Counts only, nothing
 * personal: it is shown to every console role. Days are the sites' local days; the week is the last
 * seven days including today, compared with the seven before.
 */
@Controller('admin/dashboard')
@UseGuards(AdminAuthGuard)
export class DashboardController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const tenant = await this.ds.getRepository(Tenant).findOneOrFail({ where: { id: user.tenantId }, select: { id: true, apps: true } });
    const ids = visibleSiteIds(user);
    const sites = (await this.ds.getRepository(Site).find({ where: { tenantId: user.tenantId }, select: { id: true, timezone: true } }))
      .filter((s) => !ids || ids.includes(s.id));
    const tz = new Map(sites.map((s) => [s.id, s.timezone || 'UTC']));
    const now = new Date();
    // Labels follow the first site the person sees; each row is counted in its own site's day.
    const today = localDay(now, sites[0]?.timezone || 'UTC');
    const days = Array.from({ length: 7 }, (_, i) => shift(today, i - 6));
    const since = new Date(now.getTime() - 15 * DAY_MS);
    const scoped = <T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string) => {
      qb.where(`${alias}.tenantId = :tid`, { tid: user.tenantId });
      if (ids) qb.andWhere(ids.length ? `${alias}.siteId IN (:...ids)` : '1=0', { ids });
      return qb;
    };
    const has = (app: string, roles: Role[]) => tenant.apps.includes(app as never) && roles.includes(user.role);
    const out: Record<string, unknown> = { today, days };

    if (has('reception', VISITS)) {
      const rows = await scoped(this.ds.getRepository(Visit).createQueryBuilder('v'), 'v')
        .andWhere('v.checkInAt >= :since', { since }).select(['v.siteId', 'v.checkInAt', 'v.purpose']).getMany();
      const present = await scoped(this.ds.getRepository(Visit).createQueryBuilder('v'), 'v').andWhere('v.status = :s', { s: VisitStatus.OPEN }).getCount();
      const perDay = new Map<string, number>();
      const purposes = Object.fromEntries(Object.values(VisitPurpose).map((p) => [p, 0])) as Record<string, number>;
      for (const v of rows) {
        const d = localDay(v.checkInAt, tz.get(v.siteId) ?? 'UTC');
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
        if (d >= days[0]) purposes[v.purpose] = (purposes[v.purpose] ?? 0) + 1;
      }
      const sum = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => perDay.get(shift(today, from + i)) ?? 0).reduce((a, b) => a + b, 0);
      out.reception = {
        present,
        today: perDay.get(today) ?? 0, sameDayLastWeek: perDay.get(shift(today, -7)) ?? 0,
        week: days.map((d) => ({ date: d, count: perDay.get(d) ?? 0 })), weekTotal: sum(-6, 0), previousWeekTotal: sum(-13, -7),
        purposes,
      };
    }
    if (has('access', ACCESS)) {
      const rows = await scoped(this.ds.getRepository(AccessEvent).createQueryBuilder('e'), 'e')
        .andWhere('e.at >= :since', { since }).select(['e.siteId', 'e.at', 'e.result']).getMany();
      const count = (from: number, to: number, result?: AccessResult) => rows.filter((e) => {
        const d = localDay(e.at, tz.get(e.siteId) ?? 'UTC');
        return d >= shift(today, from) && d <= shift(today, to) && (!result || e.result === result);
      }).length;
      out.access = { today: count(0, 0, AccessResult.GRANTED), sameDayLastWeek: count(-7, -7, AccessResult.GRANTED), deniedWeek: count(-6, 0, AccessResult.DENIED), deniedPreviousWeek: count(-13, -7, AccessResult.DENIED) };
    }
    if (has('parcels', PARCELS)) {
      const waiting = await scoped(this.ds.getRepository(Parcel).createQueryBuilder('p'), 'p').andWhere('p.status = :s', { s: 'WAITING' }).getCount();
      const rows = await scoped(this.ds.getRepository(Parcel).createQueryBuilder('p'), 'p').andWhere('p.receivedAt >= :since', { since }).select(['p.siteId', 'p.receivedAt']).getMany();
      const inRange = (from: number, to: number) => rows.filter((p) => { const d = localDay(p.receivedAt, tz.get(p.siteId) ?? 'UTC'); return d >= shift(today, from) && d <= shift(today, to); }).length;
      out.parcels = { waiting, arrivedWeek: inRange(-6, 0), arrivedPreviousWeek: inRange(-13, -7) };
    }
    if (has('parking', PARKING)) {
      const spots = await scoped(this.ds.getRepository(ParkingSpot).createQueryBuilder('s'), 's').andWhere('s.active = 1').getCount();
      const booked = await scoped(this.ds.getRepository(ParkingBooking).createQueryBuilder('b'), 'b').andWhere('b.date = :d', { d: today }).getCount();
      out.parking = { spots, bookedToday: booked };
    }
    return out;
  }
}
