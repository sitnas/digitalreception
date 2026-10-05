import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A parking spot of a site (e.g. "P12"), entered in the console. */
@Entity('parking_spots')
@Index('IDX_parking_spots_code', ['tenantId', 'siteId', 'code'], { unique: true })
export class ParkingSpot {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'varchar', length: 20 }) code: string;
  /** Where it is or what it is (covered, charging point…): shown to the employee. */
  @Column({ type: 'varchar', length: 120, nullable: true }) note: string | null;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

export type BookingSource = 'AUTO' | 'MANUAL';

/** One spot, one person, one day (local date at the site). The unique indexes keep both sides single. */
@Entity('parking_bookings')
@Index('IDX_parking_bookings_spot_day', ['tenantId', 'spotId', 'date'], { unique: true })
@Index('IDX_parking_bookings_person_day', ['tenantId', 'employeeId', 'date'], { unique: true })
@Index('IDX_parking_bookings_site_day', ['tenantId', 'siteId', 'date'])
export class ParkingBooking {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'uuid' }) spotId: string;
  @Column({ type: 'uuid' }) employeeId: string;
  @Column({ type: 'date' }) date: string;
  /** AUTO = the manager's weekly booking, MANUAL = booked by the person (or by reception). */
  @Column({ type: 'varchar', length: 8 }) source: BookingSource;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

/**
 * The managers' spots have been booked for this week at this site. Kept so that the weekly job
 * runs once per week: a day a manager gives back is not booked again.
 */
@Entity('parking_weeks')
@Index('IDX_parking_weeks', ['tenantId', 'siteId', 'monday'], { unique: true })
export class ParkingWeek {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'date' }) monday: string;
  @Column({ type: 'smallint', default: 0 }) booked: number;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
