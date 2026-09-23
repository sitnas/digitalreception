import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Site } from './site.entity';

/** A reception tablet, bound to exactly one site. Only the SHA-256 of its token is stored. */
@Entity('devices')
@Index(['tenantId', 'siteId'])
export class Device {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @ManyToOne(() => Site) @JoinColumn({ name: 'siteId' }) site?: Site;
  @Column({ length: 80 }) name: string;
  @Index({ unique: true }) @Column({ type: 'char', length: 64, select: false }) tokenHash: string;
  @Column({ type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) lastSeenAt: Date | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) revokedAt: Date | null;
}

/** One-time, short-lived code used to enrol a tablet. Only its hash is stored. */
@Entity('pairing_codes')
export class PairingCode {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ length: 80 }) deviceName: string;
  @Index({ unique: true }) @Column({ type: 'char', length: 64 }) codeHash: string;
  @Column({ type: 'datetime', precision: 3 }) expiresAt: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) usedAt: Date | null;
  @Column({ type: 'uuid' }) createdBy: string;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
