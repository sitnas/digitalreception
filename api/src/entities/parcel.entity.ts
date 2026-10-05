import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NoticeEmailStatus } from './enums';

export type ParcelStatus = 'WAITING' | 'COLLECTED';
export const CARRIERS = ['DHL', 'UPS', 'FEDEX', 'TNT', 'GLS', 'BRT', 'SDA', 'POSTE', 'AMAZON', 'SEUR', 'CORREOS', 'OTHER'] as const;
export type Carrier = (typeof CARRIERS)[number];
/** How the carrier is written in notices; OTHER is not named. */
export const CARRIER_NAMES: Record<Carrier, string | null> = {
  DHL: 'DHL', UPS: 'UPS', FEDEX: 'FedEx', TNT: 'TNT', GLS: 'GLS', BRT: 'BRT', SDA: 'SDA', POSTE: 'Poste', AMAZON: 'Amazon', SEUR: 'SEUR', CORREOS: 'Correos', OTHER: null,
};

/**
 * A parcel or letter left at reception for an employee. The employee hears it on the phone (push)
 * and by email, and collects it at reception, where the staff mark it as handed over.
 */
@Entity('parcels')
@Index('IDX_parcels_site_status', ['tenantId', 'siteId', 'status', 'receivedAt'])
@Index('IDX_parcels_employee_status', ['tenantId', 'employeeId', 'status'])
@Index('IDX_parcels_email_status', ['emailStatus'])
export class Parcel {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'uuid' }) employeeId: string;
  @Column({ type: 'varchar', length: 12 }) carrier: Carrier;
  @Column({ type: 'tinyint', default: 1 }) pieces: number;
  /** Tracking number and note can name the sender or the content: encrypted like any free text. */
  @Column({ type: 'text', nullable: true }) trackingEnc: string | null;
  @Column({ type: 'text', nullable: true }) noteEnc: string | null;
  @Column({ type: 'varchar', length: 12 }) status: ParcelStatus;
  @Column({ type: 'datetime', precision: 3 }) receivedAt: Date;
  @Column({ type: 'uuid' }) receivedByUserId: string;
  @Column({ type: 'datetime', precision: 3, nullable: true }) collectedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) collectedByUserId: string | null;
  @Column({ type: 'varchar', length: 16 }) emailStatus: NoticeEmailStatus;
  @Column({ type: 'tinyint', default: 0 }) emailAttempts: number;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
