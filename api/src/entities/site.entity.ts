import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sites')
@Index(['tenantId', 'code'], { unique: true })
export class Site {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ length: 16 }) code: string;
  @Column({ length: 120 }) name: string;
  @Column({ type: 'varchar', length: 2 }) countryCode: string;
  /** IANA time zone, e.g. Europe/Rome, America/Lima, America/Bogota */
  @Column({ length: 64 }) timezone: string;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
