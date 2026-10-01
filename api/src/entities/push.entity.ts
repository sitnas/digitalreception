import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

export type PushKind = 'expo' | 'web';

/**
 * A phone or browser where an employee wants to be told that their guest has arrived: the Expo push
 * token of the app, or the Web Push subscription of the /badge page. Both are secrets that let anyone
 * write to that device, so they are stored encrypted; the hash only finds duplicates.
 */
@Entity('push_devices')
@Index('IDX_push_devices_employee', ['tenantId', 'employeeId'])
export class PushDevice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) employeeId: string;
  @Column({ type: 'varchar', length: 8 }) kind: PushKind;
  /** SHA-256 of the token or endpoint. */
  @Index('IDX_push_devices_target', { unique: true }) @Column({ type: 'char', length: 64 }) targetHash: string;
  /** Expo token, or the Web Push subscription as JSON. */
  @Column({ type: 'text' }) targetEnc: string;
  /** Language of the notification text (the phone's language at registration). */
  @Column({ type: 'varchar', length: 5 }) locale: string;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

/** Outbox, written in the check-in transaction; sent right after it commits, retried by a worker. */
@Entity('push_deliveries')
@Index('IDX_push_deliveries_due', ['status', 'nextAt'])
@Index('IDX_push_deliveries_created', ['createdAt'])
export class PushDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) employeeId: string;
  /** JSON of the arrival (site, visitor, company), encrypted. */
  @Column({ type: 'text' }) payloadEnc: string;
  @Column({ type: 'varchar', length: 8 }) status: 'PENDING' | 'SENT' | 'FAILED';
  @Column({ type: 'tinyint', default: 0 }) attempts: number;
  @Column({ type: 'datetime', precision: 3 }) nextAt: Date;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

/**
 * Secrets of the whole platform that the server creates itself, wrapped with the master key like the
 * tenant keys (rewrap-keys re-wraps them too). Today: the VAPID key pair that signs Web Push.
 */
@Entity('platform_secrets')
export class PlatformSecret {
  @PrimaryColumn({ type: 'varchar', length: 40 }) name: string;
  @Column({ type: 'text' }) valueWrapped: string;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
