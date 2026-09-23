import { Column, CreateDateColumn, Entity, Index, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Site } from './site.entity';

/**
 * A person who can be visited (employee directory). Shown on the tablets of the assigned sites,
 * so the visitor picks who they are meeting instead of typing a name.
 * Email is used only by the reception staff and is never sent to the tablet.
 */
@Entity('hosts')
@Index('IDX_hosts_tenant_lastname', ['tenantId', 'lastName'])
export class Host {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ length: 80 }) firstName: string;
  @Column({ length: 80 }) lastName: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) department: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) jobTitle: string | null;
  @Column({ type: 'varchar', length: 190, nullable: true }) email: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) phone: string | null;
  @ManyToMany(() => Site) @JoinTable({ name: 'host_sites', joinColumn: { name: 'hostId', foreignKeyConstraintName: 'FK_host_sites_host' }, inverseJoinColumn: { name: 'siteId', foreignKeyConstraintName: 'FK_host_sites_site' } }) sites: Site[];
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
