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
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
