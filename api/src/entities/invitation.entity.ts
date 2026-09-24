import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NoticeEmailStatus, VisitPurpose } from './enums';

export enum InvitationStatus { PENDING = 'PENDING', USED = 'USED', CANCELLED = 'CANCELLED' }

/**
 * Pre-registered visit. Staff enter the guest's details in advance; the guest receives an email
 * with a QR and, on arrival, the tablet fills the form from it. Personal data is encrypted like
 * visits ("*Enc"), and the whole row is deleted a few days after the expected day.
 * The invite code is stored as a hash (lookup) and encrypted (to resend or show the QR).
 */
@Entity('invitations')
@Index('IDX_invitations_code', ['tenantId', 'codeHash'], { unique: true })
@Index('IDX_invitations_site_day', ['tenantId', 'siteId', 'validFrom'])
@Index('IDX_invitations_email_status', ['emailStatus'])
@Index('IDX_invitations_valid_until', ['validUntil'])
export class Invitation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'uuid' }) hostId: string;
  @Column({ type: 'datetime', precision: 3 }) expectedAt: Date;
  /** The invite works on the expected local day of the site only. */
  @Column({ type: 'datetime', precision: 3 }) validFrom: Date;
  @Column({ type: 'datetime', precision: 3 }) validUntil: Date;
  @Column({ type: 'text' }) firstNameEnc: string;
  @Column({ type: 'text' }) lastNameEnc: string;
  @Column({ type: 'text', nullable: true }) companyEnc: string | null;
  @Column({ type: 'text' }) emailEnc: string;
  @Column({ type: 'varchar', length: 20 }) purpose: VisitPurpose;
  @Column({ type: 'varchar', length: 5 }) locale: string;
  @Column({ type: 'char', length: 64 }) codeHash: string;
  @Column({ type: 'text' }) codeEnc: string;
  @Column({ type: 'varchar', length: 12 }) status: InvitationStatus;
  @Column({ type: 'uuid', nullable: true }) visitId: string | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) usedAt: Date | null;
  @Column({ type: 'varchar', length: 16 }) emailStatus: NoticeEmailStatus;
  @Column({ type: 'tinyint', default: 0 }) emailAttempts: number;
  @Column({ type: 'uuid' }) createdByUserId: string;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
