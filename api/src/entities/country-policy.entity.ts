import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Data-protection rules of one tenant for one country. Configurable by the tenant's SUPER_ADMIN. */
@Entity('country_policies')
@Index(['tenantId', 'countryCode'], { unique: true })
export class CountryPolicy {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'varchar', length: 2 }) countryCode: string;
  @Column({ length: 80 }) name: string;
  @Column({ type: 'varchar', length: 5 }) defaultLocale: string;
  @Column({ type: 'simple-array' }) locales: string[];
  /** Days after check-in before the visit is anonymised. */
  @Column({ type: 'int' }) visitRetentionDays: number;
  /** Collect document type + number (typed by the visitor). */
  @Column({ default: false }) documentDataEnabled: boolean;
  /** Photograph the identity document. Off by default (data minimisation). */
  @Column({ default: false }) documentPhotoEnabled: boolean;
  @Column({ type: 'int', default: 7 }) documentPhotoRetentionDays: number;
  /** Photograph the serial of the visitor's laptop at check-in and check-out. */
  @Column({ default: false }) assetPhotosRequired: boolean;
  @Column({ type: 'int', default: 30 }) assetPhotoRetentionDays: number;
  @UpdateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', onUpdate: 'CURRENT_TIMESTAMP(3)' }) updatedAt: Date;
}
