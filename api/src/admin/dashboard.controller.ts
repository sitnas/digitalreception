import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { AdminAuthGuard, CurrentUser, visibleSiteIds } from '../common/guards';
import { AuthUser } from '../common/request-context';
import { localDay, midnight, shift } from './dashboard-days';
import { AccessEvent, AccessResult, Parcel, ParkingBooking, ParkingSpot, Role, Site, Tenant, Visit, VisitPurpose, VisitStatus } from '../entities';

/** Roles that read each app's numbers, as on the app's own pages. */
const VISITS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];
const ACCESS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.AUDITOR];
const PARCELS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];
const PARKING = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST, Role.AUDITOR];

/**
 * Door counts, kept for a minute per organisation and set of sites. At the morning peak the readers
 * write into the very index range these counts read, and each count then costs seconds (measured in
 * docs/CARICO.md); a home page a minute behind on passages is fine. Per process: each replica keeps
 * its own.
 */
const ACCESS_TTL_MS = 60_000;
const accessCache = new Map<string, { at: number; rows: { k: string; n: string }[] }>();

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
    const scoped = <T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string) => {
      qb.where(`${alias}.tenantId = :tid`, { tid: user.tenantId });
      if (ids) qb.andWhere(ids.length ? `${alias}.siteId IN (:...ids)` : '1=0', { ids });
      return qb;
    };
    const has = (app: string, roles: Role[]) => tenant.apps.includes(app as never) && roles.includes(user.role);
    const out: Record<string, unknown> = { today, days };

    // Sites sharing a time zone (usually all of them) are counted together, with that zone's day limits:
    // b(0) is today's midnight there, b(1) tomorrow's. One query per zone, not per site.
    const zones = [...new Set(sites.map((s) => tz.get(s.id)!))].map((z) => {
      const ids = sites.filter((s) => tz.get(s.id) === z).map((s) => s.id), t0 = localDay(now, z);
      return { ids, b: (n: number) => midnight(shift(t0, n), z) };
    });
    if (has('reception', VISITS)) {
      // Counted by the database on the (tenant, site, check-in) index: no visit is loaded.
      const present = await scoped(this.ds.getRepository(Visit).createQueryBuilder('v'), 'v').andWhere('v.status = :s', { s: VisitStatus.OPEN }).getCount();
      const perDay = new Map<number, number>(); // 0 today, -6 the first day of the week, -13 the first of the week before
      const purposes = Object.fromEntries(Object.values(VisitPurpose).map((p) => [p, 0])) as Record<string, number>;
      for (const { ids: sids, b } of zones) {
        // select() first: without it the query builder also asks for every column of the visit, and the
        // database has to read whole rows instead of answering from the index.
        const qb = this.ds.getRepository(Visit).createQueryBuilder('v').select('COUNT(*)', 'all')
          .where('v.tenantId = :tid AND v.siteId IN (:...sids) AND v.checkInAt >= :from AND v.checkInAt < :to', { tid: user.tenantId, sids, from: b(-13), to: b(1) });
        for (let d = -13; d <= 0; d++) qb.addSelect(`SUM(v.checkInAt >= :b${d + 13} AND v.checkInAt < :b${d + 14})`, `d${d + 13}`).setParameter(`b${d + 13}`, b(d));
        qb.setParameter('b14', b(1));
        const r = (await qb.getRawOne<Record<string, string | null>>()) ?? {};
        for (let d = -13; d <= 0; d++) perDay.set(d, (perDay.get(d) ?? 0) + Number(r[`d${d + 13}`] ?? 0));
        const reasons = await this.ds.getRepository(Visit).createQueryBuilder('v').select('v.purpose', 'purpose').addSelect('COUNT(*)', 'n')
          .where('v.tenantId = :tid AND v.siteId IN (:...sids) AND v.checkInAt >= :from AND v.checkInAt < :to', { tid: user.tenantId, sids, from: b(-6), to: b(1) })
          .groupBy('v.purpose').getRawMany<{ purpose: string; n: string }>();
        for (const x of reasons) purposes[x.purpose] = (purposes[x.purpose] ?? 0) + Number(x.n);
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
      // Door events can be many. Four plain counts, each an exact range of the (tenant, site, result,
      // time) index, in one statement: only today, the same day last week and the denied entries are
      // read. (A single query with OR-ed conditions made the database scan every row of the site.)
      const access = { today: 0, sameDayLastWeek: 0, deniedWeek: 0, deniedPreviousWeek: 0 };
      for (const { ids: sids, b } of zones) {
        const inSites = sids.map(() => '?').join(',');
        const part = (key: string) => `SELECT '${key}' AS k, COUNT(*) AS n FROM access_events WHERE tenantId = ? AND siteId IN (${inSites}) AND result = ? AND at >= ? AND at < ?`;
        const key = `${user.tenantId}|${sids.join(',')}|${b(0).toISOString()}`;
        const hit = accessCache.get(key);
        const rows = hit && Date.now() - hit.at < ACCESS_TTL_MS ? hit.rows : await this.ds.query(
          ['today', 'sameDayLastWeek', 'deniedWeek', 'deniedPreviousWeek'].map(part).join(' UNION ALL '),
          [
            user.tenantId, ...sids, AccessResult.GRANTED, b(0), b(1),
            user.tenantId, ...sids, AccessResult.GRANTED, b(-7), b(-6),
            user.tenantId, ...sids, AccessResult.DENIED, b(-6), b(1),
            user.tenantId, ...sids, AccessResult.DENIED, b(-13), b(-6),
          ]);
        if (rows !== hit?.rows) {
          if (accessCache.size > 1000) accessCache.clear();
          accessCache.set(key, { at: Date.now(), rows });
        }
        for (const r of rows as { k: keyof typeof access; n: string }[]) access[r.k] += Number(r.n);
      }
      out.access = access;
    }
    if (has('parcels', PARCELS)) {
      const waiting = await scoped(this.ds.getRepository(Parcel).createQueryBuilder('p'), 'p').andWhere('p.status = :s', { s: 'WAITING' }).getCount();
      let arrivedWeek = 0, arrivedPreviousWeek = 0;
      for (const { ids: sids, b } of zones) {
        const r = await this.ds.getRepository(Parcel).createQueryBuilder('p')
          .select('SUM(p.receivedAt >= :w6)', 'week').addSelect('SUM(p.receivedAt < :w6)', 'before')
          .where('p.tenantId = :tid AND p.siteId IN (:...sids) AND p.receivedAt >= :w13 AND p.receivedAt < :d1', { tid: user.tenantId, sids, w6: b(-6), w13: b(-13), d1: b(1) })
          .getRawOne<{ week: string | null; before: string | null }>();
        arrivedWeek += Number(r?.week ?? 0); arrivedPreviousWeek += Number(r?.before ?? 0);
      }
      out.parcels = { waiting, arrivedWeek, arrivedPreviousWeek };
    }
    if (has('parking', PARKING)) {
      const spots = await scoped(this.ds.getRepository(ParkingSpot).createQueryBuilder('s'), 's').andWhere('s.active = 1').getCount();
      // Booked on each site's own today.
      const qb = scoped(this.ds.getRepository(ParkingBooking).createQueryBuilder('b'), 'b');
      if (zones.length) qb.andWhere(new Brackets((w) => zones.forEach((zn, i) => w.orWhere(`(b.siteId IN (:...pz${i}) AND b.date = :pd${i})`, { [`pz${i}`]: zn.ids, [`pd${i}`]: siteToday.get(zn.ids[0]) }))));
      else qb.andWhere('1=0');
      const booked = await qb.getCount();
      out.parking = { spots, bookedToday: booked };
    }
    return out;
  }
}
