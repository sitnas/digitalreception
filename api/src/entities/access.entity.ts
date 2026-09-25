import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Employee access control. Employees, doors and permissions are pushed by an external system
 * through the integration API; the app verifies QR codes and NFC badges at the doors and keeps a
 * short access log. Personal data is encrypted per tenant like visitor data.
 */

export enum AccessMethod { QR = 'QR', NFC = 'NFC' }
export enum AccessResult { GRANTED = 'GRANTED', DENIED = 'DENIED' }

@Entity('employees')
@Index('IDX_employees_external', ['tenantId', 'externalId'], { unique: true })
@Index('IDX_employees_email', ['tenantId', 'emailIndex'])
@Index('IDX_employees_badge', ['tenantId', 'badgeIndex'])
export class Employee {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  /** Identifier in the external system: every API call refers to it. */
  @Column({ type: 'varchar', length: 100 }) externalId: string;
  @Column({ type: 'text' }) firstNameEnc: string;
  @Column({ type: 'text' }) lastNameEnc: string;
  @Column({ type: 'text', nullable: true }) emailEnc: string | null;
  @Column({ type: 'char', length: 64, nullable: true }) emailIndex: string | null;
  /** Blind index of the NFC badge UID (lookup only) and its last 4 characters (to recognise it). */
  @Column({ type: 'char', length: 64, nullable: true }) badgeIndex: string | null;
  @Column({ type: 'varchar', length: 8, nullable: true }) badgeHint: string | null;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'datetime', precision: 3, nullable: true }) validFrom: Date | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) validUntil: Date | null;
  /** Secret shared with the employee's phone to sign the rotating QR. Null = no phone badge. */
  @Column({ type: 'text', nullable: true }) credentialSecretEnc: string | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) credentialIssuedAt: Date | null;
  /** One-time code sent by email to activate the phone badge. */
  @Column({ type: 'char', length: 64, nullable: true }) loginCodeHash: string | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) loginCodeExpiresAt: Date | null;
  @Column({ type: 'tinyint', default: 0 }) loginCodeAttempts: number;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) updatedAt: Date;
}

@Entity('doors')
@Index('IDX_doors_external', ['tenantId', 'externalId'], { unique: true })
@Index('IDX_doors_site', ['tenantId', 'siteId'])
export class Door {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'varchar', length: 100 }) externalId: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

/** Permission of one employee on one door: optional weekdays (1 = Monday) and time window, in the site's time zone. */
@Entity('access_rules')
@Index('IDX_access_rules_employee', ['tenantId', 'employeeId'])
@Index('IDX_access_rules_door', ['tenantId', 'doorId'])
export class AccessRule {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) employeeId: string;
  @Column({ type: 'uuid' }) doorId: string;
  @Column({ type: 'varchar', length: 20, nullable: true }) days: string | null;
  @Column({ type: 'char', length: 5, nullable: true }) fromTime: string | null;
  @Column({ type: 'char', length: 5, nullable: true }) toTime: string | null;
}

/** A reader at a door (Android tablet or phone). Only the SHA-256 of its token is stored. */
@Entity('door_readers')
@Index('IDX_door_readers_door', ['tenantId', 'doorId'])
export class DoorReader {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'uuid' }) doorId: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Index('IDX_door_readers_token', { unique: true }) @Column({ type: 'char', length: 64, select: false }) tokenHash: string;
  @Column({ type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) lastSeenAt: Date | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) revokedAt: Date | null;
}

@Entity('access_events')
@Index('IDX_access_events_tenant_at', ['tenantId', 'at'])
@Index('IDX_access_events_at', ['at'])
export class AccessEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'uuid' }) doorId: string;
  @Column({ type: 'uuid' }) readerId: string;
  @Column({ type: 'uuid', nullable: true }) employeeId: string | null;
  @Column({ type: 'varchar', length: 4 }) method: AccessMethod;
  @Column({ type: 'varchar', length: 8 }) result: AccessResult;
  @Column({ type: 'varchar', length: 24 }) reason: string;
  @Column({ type: 'datetime', precision: 3 }) at: Date;
}

/** Key used by the external system to call the integration API. Only its SHA-256 is stored. */
@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ type: 'varchar', length: 12 }) prefix: string;
  @Index('IDX_api_keys_hash', { unique: true }) @Column({ type: 'char', length: 64 }) keyHash: string;
  @Column({ type: 'uuid' }) createdBy: string;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) lastUsedAt: Date | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) revokedAt: Date | null;
}
