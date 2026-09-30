import { Column, CreateDateColumn, Entity, Index, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from './enums';
import { Site } from './site.entity';

@Entity('users')
@Index(['tenantId', 'email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ length: 190 }) email: string;
  @Column({ length: 120 }) displayName: string;
  @Column({ type: 'varchar', length: 255, select: false }) passwordHash: string;
  @Column({ type: 'varchar', length: 20 }) role: Role;
  @ManyToMany(() => Site) @JoinTable({ name: 'user_sites', joinColumn: { name: 'userId' }, inverseJoinColumn: { name: 'siteId' } }) sites: Site[];
  @Column({ default: true }) active: boolean;
  @Column({ default: true }) mustChangePassword: boolean;
  /** Incremented to revoke every session of the user (logout, password change, deactivation). */
  @Column({ type: 'int', default: 0 }) sessionVersion: number;
  @Column({ type: 'int', default: 0 }) failedLogins: number;
  @Column({ type: 'datetime', precision: 3, nullable: true }) lockedUntil: Date | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) lastLoginAt: Date | null;
  /** Two-step verification (TOTP). The secret is encrypted with the tenant key; set but not yet enabled while enrolling. */
  @Column({ type: 'text', nullable: true, select: false }) mfaSecretEnc: string | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) mfaEnabledAt: Date | null;
  /** Last accepted time step: a code is valid once only. */
  @Column({ type: 'bigint', nullable: true, select: false, transformer: { to: (v: number | null) => v, from: (v: string | null) => (v === null ? null : Number(v)) } }) mfaLastStep: number | null;
  /** JSON array of SHA-256 hashes of the unused recovery codes. */
  @Column({ type: 'text', nullable: true, select: false }) mfaRecoveryHashes: string | null;
  /** Directory account bound at the first single sign-on ("<provider>:<org>:<subject>"): a renamed or reused email cannot take it over. */
  @Column({ type: 'varchar', length: 255, nullable: true }) ssoSubject: string | null;
  /** May still sign in with the password when the organisation requires single sign-on (emergency account). */
  @Column({ default: false }) ssoExempt: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
