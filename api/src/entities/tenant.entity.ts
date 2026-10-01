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
  /** Every console user must use two-step verification. */
  @Column({ default: false }) mfaRequired: boolean;
  /**
   * Single sign-on: the provider and the directory linked by a SUPER_ADMIN (Microsoft Entra tenant id
   * or Google Workspace domain). Only accounts of that directory are accepted.
   */
  @Column({ type: 'varchar', length: 12, nullable: true }) ssoProvider: 'microsoft' | 'google' | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) ssoOrgId: string | null;
  /** Shown in the console to recognise the directory (a domain). */
  @Column({ type: 'varchar', length: 190, nullable: true }) ssoOrgLabel: string | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) ssoLinkedAt: Date | null;
  /** Password sign-in refused except for users marked `ssoExempt` (emergency access). */
  @Column({ default: false }) ssoEnforced: boolean;
  /** Push to the visited employee: show the guest's name on the lock screen too (off by default). */
  @Column({ default: false }) pushIncludeNames: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
