import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * An evacuation of one site: started from the console when the alarm sounds, ended when everyone
 * is accounted for. The list of people comes live from open visits and today's door passages; the
 * roll call (who reached the assembly point) is stored here.
 */
@Entity('evacuations')
@Index('IDX_evacuations_site', ['tenantId', 'siteId', 'startedAt'])
export class Evacuation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'datetime', precision: 3 }) startedAt: Date;
  @Column({ type: 'uuid' }) startedByUserId: string;
  @Column({ type: 'datetime', precision: 3, nullable: true }) endedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) endedByUserId: string | null;
  /** Counts at the end, kept after the visits themselves are anonymised. */
  @Column({ type: 'int', nullable: true }) peopleCount: number | null;
  @Column({ type: 'int', nullable: true }) safeCount: number | null;
}

/** One person found safe at the assembly point during an evacuation. */
@Entity('evacuation_checks')
@Index('IDX_evacuation_checks_person', ['evacuationId', 'kind', 'refId'], { unique: true })
export class EvacuationCheck {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) evacuationId: string;
  /** visit = a guest (visit id); employee = an employee who passed a door of the site today. */
  @Column({ type: 'varchar', length: 8 }) kind: 'visit' | 'employee';
  @Column({ type: 'uuid' }) refId: string;
  @Column({ type: 'uuid' }) checkedByUserId: string;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) checkedAt: Date;
}
