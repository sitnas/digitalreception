import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Versioned privacy notice. Versions are immutable: editing creates a new version. */
@Entity('privacy_notices')
@Index(['tenantId', 'countryCode', 'locale', 'version'], { unique: true })
export class PrivacyNotice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'varchar', length: 2 }) countryCode: string;
  @Column({ type: 'varchar', length: 5 }) locale: string;
  @Column({ type: 'int' }) version: number;
  @Column({ length: 200 }) title: string;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
