import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { AdminAuthGuard, CurrentUser, visibleSiteIds } from '../common/guards';
import { AuthUser } from '../common/request-context';
import { DAY_MS, between, localDay, midnight, shift } from './dashboard-days';
import { AccessEvent, AccessResult, Parcel, ParkingBooking, ParkingSpot, Role, Site, Tenant, Visit, VisitPurpose, VisitStatus } from '../entities';

/** Roles that read each app's numbers, as on the app's own pages. */
const VISITS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];
const ACCESS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR];
const PARCELS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];
const PARKING = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];

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
    // A fixed order: the labels follow the first site, so it must not change between requests.
    const sites = (await this.ds.getRepository(Site).find({ where: { tenantId: user.tenantId }, select: { id: true, timezone: true }, order: { name: 'ASC', id: 'ASC' } }))
      .filter((s) => !ids || ids.includes(s.id));
    const tz = new Map(sites.map((s) => [s.id, s.timezone || 'UTC']));
    const now = new Date();
    // Each site counts in its own calendar: "today" there, and a row's day relative to it. The labels
    // follow the first site the person sees.
    const siteToday = new Map(sites.map((s) => [s.id, localDay(now, tz.get(s.id)!)]));
    const today = localDay(now, sites[0]?.timezone || 'UTC');
    const days = Array.from({ length: 7 }, (_, i) => shift(today, i - 6));
    const ago = (siteId: string, at: Date) => { const z = tz.get(siteId) ?? 'UTC'; return between(localDay(at, z), siteToday.get(siteId) ?? localDay(now, z)); };
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
      // Index by days ago: 0 today, -6 the first day of the week, -13 the first of the week before.
      const perDay = new Map<number, number>();
      const purposes = Object.fromEntries(Object.values(VisitPurpose).map((p) => [p, 0])) as Record<string, number>;
      for (const v of rows) {
        const d = ago(v.siteId, v.checkInAt);
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
        if (d >= -6 && d <= 0) purposes[v.purpose] = (purposes[v.purpose] ?? 0) + 1;
      }
      const sum = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => perDay.get(from + i) ?? 0).reduce((a, b) => a + b, 0);
      out.reception = {
        present,
        today: perDay.get(0) ?? 0, sameDayLastWeek: perDay.get(-7) ?? 0,
        week: days.map((d, i) => ({ date: d, count: perDay.get(i - 6) ?? 0 })), weekTotal: sum(-6, 0), previousWeekTotal: sum(-13, -7),
        purposes,
      };
    }
    if (has('access', ACCESS)) {
      // Door events can be many: counted by the database, one query per site with that site's day limits.
      const access = { today: 0, sameDayLastWeek: 0, deniedWeek: 0, deniedPreviousWeek: 0 };
      for (const s of sites) {
        const z = tz.get(s.id)!, t0 = siteToday.get(s.id)!;
        const b = (n: number) => midnight(shift(t0, n), z);
        const r = await this.ds.getRepository(AccessEvent).createQueryBuilder('e')
          .select("SUM(e.result = :g AND e.at >= :d0 AND e.at < :d1)", 'today')
          .addSelect("SUM(e.result = :g AND e.at >= :w7 AND e.at < :w6)", 'sameDay')
          .addSelect("SUM(e.result = :x AND e.at >= :w6 AND e.at < :d1)", 'denied')
          .addSelect("SUM(e.result = :x AND e.at >= :w13 AND e.at < :w6)", 'deniedBefore')
          .where('e.tenantId = :tid AND e.siteId = :sid AND e.at >= :w13 AND e.at < :d1', { tid: user.tenantId, sid: s.id })
          .setParameters({ g: AccessResult.GRANTED, x: AccessResult.DENIED, d0: b(0), d1: b(1), w6: b(-6), w7: b(-7), w13: b(-13) })
          .getRawOne<{ today: string | null; sameDay: string | null; denied: string | null; deniedBefore: string | null }>();
        access.today += Number(r?.today ?? 0); access.sameDayLastWeek += Number(r?.sameDay ?? 0);
        access.deniedWeek += Number(r?.denied ?? 0); access.deniedPreviousWeek += Number(r?.deniedBefore ?? 0);
      }
      out.access = access;
    }
    if (has('parcels', PARCELS)) {
      const waiting = await scoped(this.ds.getRepository(Parcel).createQueryBuilder('p'), 'p').andWhere('p.status = :s', { s: 'WAITING' }).getCount();
      const rows = await scoped(this.ds.getRepository(Parcel).createQueryBuilder('p'), 'p').andWhere('p.receivedAt >= :since', { since }).select(['p.siteId', 'p.receivedAt']).getMany();
      const inRange = (from: number, to: number) => rows.filter((p) => { const d = ago(p.siteId, p.receivedAt); return d >= from && d <= to; }).length;
      out.parcels = { waiting, arrivedWeek: inRange(-6, 0), arrivedPreviousWeek: inRange(-13, -7) };
    }
    if (has('parking', PARKING)) {
      const spots = await scoped(this.ds.getRepository(ParkingSpot).createQueryBuilder('s'), 's').andWhere('s.active = 1').getCount();
      // Booked on each site's own today.
      const qb = scoped(this.ds.getRepository(ParkingBooking).createQueryBuilder('b'), 'b');
      if (sites.length) qb.andWhere(new Brackets((w) => sites.forEach((s, i) => w.orWhere(`(b.siteId = :ps${i} AND b.date = :pd${i})`, { [`ps${i}`]: s.id, [`pd${i}`]: siteToday.get(s.id) }))));
      else qb.andWhere('1=0');
      const booked = await qb.getCount();
      out.parking = { spots, bookedToday: booked };
    }
    return out;
  }
}
