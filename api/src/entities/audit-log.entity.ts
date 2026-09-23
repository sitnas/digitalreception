import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ActorType } from './enums';

/**
 * Append-only audit trail (who accessed which personal data, when, from where).
 * The application never updates or deletes rows; at DB level grant only INSERT/SELECT.
 * It never contains visitor personal data, only identifiers.
 */
@Entity('audit_logs')
@Index(['tenantId', 'at'])
@Index(['tenantId', 'action', 'at'])
@Index(['tenantId', 'entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  /** Null only for platform-level events (tenant provisioning). */
  @Column({ type: 'uuid', nullable: true }) tenantId: string | null;
  @Column({ type: 'datetime', precision: 3 }) at: Date;
  @Column({ type: 'varchar', length: 12 }) actorType: ActorType;
  @Column({ type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', length: 190, nullable: true }) actorLabel: string | null;
  @Column({ type: 'varchar', length: 40 }) action: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) entityType: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) entityId: string | null;
  @Column({ type: 'uuid', nullable: true }) siteId: string | null;
  @Column({ type: 'varchar', length: 45, nullable: true }) ip: string | null;
  @Column({ type: 'simple-json', nullable: true }) details: Record<string, unknown> | null;
}
