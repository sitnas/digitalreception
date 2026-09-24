import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum TenantStatus { ACTIVE = 'ACTIVE', SUSPENDED = 'SUSPENDED' }

/**
 * A customer organisation. Each tenant has its OWN data-encryption and blind-index keys,
 * stored only wrapped by the platform master key. Deleting these two columns makes every
 * encrypted value of the tenant unrecoverable (crypto-shredding on contract termination).
 */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** Used as sub-domain: <slug>.<BASE_DOMAIN> */
  @Index({ unique: true }) @Column({ length: 40 }) slug: string;
  @Column({ length: 120 }) name: string;
  @Column({ type: 'varchar', length: 12, default: TenantStatus.ACTIVE }) status: TenantStatus;
  @Column({ type: 'varchar', length: 8 }) dataKeyId: string;
  @Column({ type: 'text', select: false }) dataKeysWrapped: string;   // JSON {"d1":"<wrapped>", ...}
  @Column({ type: 'text', select: false }) blindIndexKeyWrapped: string;
  /** Commercial plan limits (null = unlimited). */
  @Column({ type: 'int', nullable: true }) maxSites: number | null;
  @Column({ type: 'int', nullable: true }) maxDevices: number | null;
  @Column({ type: 'int', nullable: true }) maxUsers: number | null;
  /** White-label: PNG/JPEG data URL shown on tablet and login page. */
  @Column({ type: 'mediumtext', nullable: true }) logoDataUrl: string | null;
  /** White-label colours (#RRGGBB). Null = product defaults. Text colour on top is derived for contrast. */
  @Column({ type: 'varchar', length: 7, nullable: true }) primaryColor: string | null;
  @Column({ type: 'varchar', length: 7, nullable: true }) secondaryColor: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
