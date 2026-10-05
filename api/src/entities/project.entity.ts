import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A job / contract ("commessa") the employees work on. Each employee belongs to at most one.
 * Kept in the console or pushed by the HR system with its own code; code and name are business
 * data, not personal data, so they are stored in clear.
 */
@Entity('projects')
@Index('IDX_projects_code', ['tenantId', 'code'], { unique: true })
export class Project {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'varchar', length: 40 }) code: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) client: string | null;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) updatedAt: Date;
}
