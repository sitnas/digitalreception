import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThanOrEqual, Not } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { withDbLock } from '../common/db-lock';
import { Employee, ParkingBooking, ParkingSpot, ParkingWeek, Site, Tenant } from '../entities';
import { addDays, bookableDays, localDay, MAX_ACTIVE, mondayOf, nextMonday, opensOn, workingDays, type ParkingRole } from './parking-rules';

const isDuplicate = (e: unknown) => (e as { code?: string })?.code === 'ER_DUP_ENTRY';

/**
 * Company parking. Managers get their fixed spot booked every week (the job below); standard
 * users book day by day from the app. The rules on dates are in parking-rules.ts.
 */
@Injectable()
export class ParkingService {
  private readonly log = new Logger(ParkingService.name);

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, @InjectDataSource() private readonly ds: DataSource) {}

  /** The clock of the rules (fixed in the tests). */
  now() { return this.cfg.testNow ?? new Date(); }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduled() {
    if (!this.cfg.jobs.enabled) return;
    try { await withDbLock(this.ds, 'parking-weekly', async () => { await this.weekly(); }); }
    catch (e) { this.log.error(`Parking weekly booking failed: ${(e as Error).message}`); }
  }

  /**
   * Once per week and site, from the Monday on: the managers' fixed spots are booked Monday to
   * Friday of the week after. The week is recorded, so a day a manager gives back stays free.
   */
  async weekly(tenantId?: string) {
    const now = this.now();
    const tenants = (await this.ds.getRepository(Tenant).find({ select: { id: true, apps: true }, ...(tenantId ? { where: { id: tenantId } } : {}) }))
      .filter((t) => t.apps.includes('parking'));
    let booked = 0;
    for (const t of tenants) {
      const spots = await this.ds.getRepository(ParkingSpot).find({ where: { tenantId: t.id, active: true } });
      const siteIds = [...new Set(spots.map((s) => s.siteId))];
      if (!siteIds.length) continue;
      const sites = await this.ds.getRepository(Site).find({ where: { tenantId: t.id, id: In(siteIds), active: true } });
      for (const site of sites) {
        const monday = nextMonday(now, site.timezone);
        booked += await this.ds.transaction(async (em) => {
          try { await em.insert(ParkingWeek, { tenantId: t.id, siteId: site.id, monday, booked: 0 }); }
          catch (e) { if (isDuplicate(e)) return 0; throw e; } // already done this week
          const n = await this.bookManagers(em, t.id, site.id, spots.filter((s) => s.siteId === site.id), workingDays(monday));
          await em.update(ParkingWeek, { tenantId: t.id, siteId: site.id, monday }, { booked: n });
          return n;
        });
      }
    }
    return { booked };
  }

  /** Books each manager's fixed spot on the given days, skipping what is already taken. */
  private async bookManagers(em: EntityManager, tenantId: string, siteId: string, spots: ParkingSpot[], days: string[], only?: string) {
    const managers = await em.find(Employee, {
      where: { tenantId, active: true, parkingRole: 'MANAGER', parkingSpotId: In(spots.map((s) => s.id).concat('-')), ...(only ? { id: only } : {}) },
      select: { id: true, parkingSpotId: true, appsOff: true },
    });
    let n = 0;
    for (const m of managers) {
      if (m.appsOff.includes('parking')) continue;
      for (const date of days) {
        try { await em.insert(ParkingBooking, { tenantId, siteId, spotId: m.parkingSpotId!, employeeId: m.id, date, source: 'AUTO' }); n++; }
        catch (e) { if (!isDuplicate(e)) throw e; } // spot or person already booked that day
      }
    }
    return n;
  }

  /**
   * After the benefit changes: the person's future weekly bookings go, and a manager gets their
   * new spot right away for the rest of this week and the weeks already handed out.
   */
  async benefitChanged(tenantId: string, employeeId: string) {
    const e = await this.ds.getRepository(Employee).findOneOrFail({ where: { id: employeeId, tenantId }, select: { id: true, parkingRole: true, parkingSpotId: true } });
    const auto = await this.ds.getRepository(ParkingBooking).find({ where: { tenantId, employeeId, source: 'AUTO' } });
    const sites = await this.siteZones(tenantId, auto.map((b) => b.siteId));
    const future = auto.filter((b) => b.date >= localDay(this.now(), sites.get(b.siteId) ?? 'UTC').date);
    if (future.length) await this.ds.getRepository(ParkingBooking).delete({ id: In(future.map((b) => b.id)) });
    if (e.parkingRole !== 'MANAGER' || !e.parkingSpotId) return;
    const spot = await this.ds.getRepository(ParkingSpot).findOne({ where: { id: e.parkingSpotId, tenantId, active: true } });
    if (!spot) return;
    const tz = (await this.siteZones(tenantId, [spot.siteId])).get(spot.siteId) ?? 'UTC';
    const today = localDay(this.now(), tz).date;
    const done = await this.ds.getRepository(ParkingWeek).find({ where: { tenantId, siteId: spot.siteId, monday: MoreThanOrEqual(mondayOf(today)) } });
    const days = [mondayOf(today), ...done.map((w) => w.monday)].flatMap(workingDays).filter((d, i, all) => d >= today && all.indexOf(d) === i);
    await this.ds.transaction((em) => this.bookManagers(em, tenantId, spot.siteId, [spot], days, e.id));
  }

  private async siteZones(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    return new Map((await this.ds.getRepository(Site).find({ where: { tenantId, id: In(unique) }, select: { id: true, timezone: true } })).map((s) => [s.id, s.timezone]));
  }

  /** A spot is turned off: its bookings from today on go. */
  async spotOff(tenantId: string, spot: ParkingSpot) {
    const tz = (await this.siteZones(tenantId, [spot.siteId])).get(spot.siteId) ?? 'UTC';
    await this.ds.getRepository(ParkingBooking).delete({ tenantId, spotId: spot.id, date: MoreThanOrEqual(localDay(this.now(), tz).date) });
  }

  private async person(tenantId: string, employeeId: string) {
    const e = await this.ds.getRepository(Employee).findOneOrFail({ where: { id: employeeId, tenantId }, select: { id: true, parkingRole: true, parkingSpotId: true, appsOff: true, active: true } });
    if (e.parkingRole === 'NONE' || e.appsOff.includes('parking')) throw new ForbiddenException('NO_PARKING');
    return e;
  }

  /** Sites with active spots, the one of the manager's spot first. */
  private async parkingSites(tenantId: string, preferSpotId: string | null) {
    const spots = await this.ds.getRepository(ParkingSpot).find({ where: { tenantId, active: true } });
    const sites = await this.ds.getRepository(Site).find({ where: { tenantId, id: In([...new Set(spots.map((s) => s.siteId))].concat('-')), active: true }, order: { name: 'ASC' } });
    const preferred = spots.find((s) => s.id === preferSpotId)?.siteId;
    return { spots, sites: preferred ? [...sites.filter((s) => s.id === preferred), ...sites.filter((s) => s.id !== preferred)] : sites };
  }

  /** What the app shows: the days that can be booked at a site and the person's bookings. */
  async mine(tenantId: string, employeeId: string, siteId?: string) {
    const e = await this.person(tenantId, employeeId);
    const { spots, sites } = await this.parkingSites(tenantId, e.parkingSpotId);
    const site = sites.find((s) => s.id === siteId) ?? sites[0];
    const role = e.parkingRole as ParkingRole;
    const fixed = spots.find((s) => s.id === e.parkingSpotId) ?? null;
    if (!site) return { role, fixedSpot: null, sites: [], site: null, days: [], active: 0, maxActive: role === 'USER' ? MAX_ACTIVE : null, opensOn: null };
    const now = this.now();
    const today = localDay(now, site.timezone).date;
    const window = bookableDays(now, site.timezone);
    // This week and the next one, so a booked day after the window still shows.
    const days = [...workingDays(mondayOf(today)), ...workingDays(addDays(mondayOf(today), 7))].filter((d) => d >= today);
    const siteSpots = spots.filter((s) => s.siteId === site.id);
    const mine = await this.ds.getRepository(ParkingBooking).find({ where: { tenantId, employeeId, date: MoreThanOrEqual(today) }, order: { date: 'ASC' } });
    const taken = await this.ds.getRepository(ParkingBooking).find({ where: { tenantId, siteId: site.id, date: In(days.concat('1970-01-01')) }, select: { id: true, date: true, spotId: true } });
    const allSpots = new Map(spots.map((s) => [s.id, s]));
    const siteNames = new Map(sites.map((s) => [s.id, s.name]));
    return {
      role, maxActive: role === 'USER' ? MAX_ACTIVE : null, active: mine.length, opensOn: opensOn(now, site.timezone),
      fixedSpot: fixed ? { code: fixed.code, note: fixed.note, site: siteNames.get(fixed.siteId) ?? null } : null,
      sites: sites.map((s) => ({ id: s.id, name: s.name })), site: { id: site.id, name: site.name },
      days: days.map((date) => {
        const b = mine.find((x) => x.date === date);
        const spot = b ? allSpots.get(b.spotId) : null;
        return {
          date, bookable: window.includes(date),
          free: siteSpots.length - taken.filter((x) => x.date === date).length,
          booking: b ? { id: b.id, source: b.source, spot: spot?.code ?? '—', note: spot?.note ?? null, site: siteNames.get(b.siteId) ?? null } : null,
        };
      }),
    };
  }

  /** One day, one spot: the manager's own spot first, otherwise the first free one by code. */
  async book(tenantId: string, employeeId: string, date: string, siteId: string) {
    const e = await this.person(tenantId, employeeId);
    const site = await this.ds.getRepository(Site).findOne({ where: { id: siteId, tenantId, active: true } });
    if (!site) throw new BadRequestException('SITE_NOT_FOUND');
    const now = this.now();
    if (!bookableDays(now, site.timezone).includes(date)) throw new BadRequestException('PARKING_DAY_CLOSED');
    const today = localDay(now, site.timezone).date;
    const repo = this.ds.getRepository(ParkingBooking);
    if (await repo.exist({ where: { tenantId, employeeId, date } })) throw new ConflictException('PARKING_ALREADY_BOOKED');
    if (e.parkingRole === 'USER' && (await repo.count({ where: { tenantId, employeeId, date: MoreThanOrEqual(today) } })) >= MAX_ACTIVE) {
      throw new ConflictException('PARKING_LIMIT');
    }
    const spots = (await this.ds.getRepository(ParkingSpot).find({ where: { tenantId, siteId, active: true } }))
      .sort((a, b) => Number(b.id === e.parkingSpotId) - Number(a.id === e.parkingSpotId) || a.code.localeCompare(b.code, undefined, { numeric: true }));
    const taken = new Set((await repo.find({ where: { tenantId, siteId, date }, select: { id: true, spotId: true } })).map((b) => b.spotId));
    // Another manager's fixed spot is offered last: they may have just given the day back.
    const managers = new Set((await this.ds.getRepository(Employee).find({ where: { tenantId, parkingRole: 'MANAGER', id: Not(employeeId) }, select: { id: true, parkingSpotId: true } })).map((m) => m.parkingSpotId));
    const order = [...spots.filter((s) => !managers.has(s.id)), ...spots.filter((s) => managers.has(s.id))];
    for (const spot of order) {
      if (taken.has(spot.id)) continue;
      try {
        const b = await repo.save(repo.create({ tenantId, siteId, spotId: spot.id, employeeId, date, source: 'MANUAL' }));
        return { id: b.id, date, spot: spot.code, note: spot.note };
      } catch (err) {
        if (!isDuplicate(err)) throw err;
        if (await repo.exist({ where: { tenantId, employeeId, date } })) throw new ConflictException('PARKING_ALREADY_BOOKED');
      }
    }
    throw new ConflictException('PARKING_FULL');
  }

  /** The person gives a day back (a manager too: the weekly job does not take it again). */
  async cancel(tenantId: string, employeeId: string | null, id: string) {
    const repo = this.ds.getRepository(ParkingBooking);
    const b = await repo.findOne({ where: { id, tenantId, ...(employeeId ? { employeeId } : {}) } });
    if (!b) throw new NotFoundException();
    const tz = (await this.siteZones(tenantId, [b.siteId])).get(b.siteId) ?? 'UTC';
    if (b.date < localDay(this.now(), tz).date) throw new ConflictException('PARKING_DAY_PAST');
    await repo.delete({ id: b.id });
    return b;
  }
}
