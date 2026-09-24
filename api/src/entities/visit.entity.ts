import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { DocumentType, NoticeEmailStatus, TravelDistance, VisitPurpose, VisitStatus } from './enums';
import { Host } from './host.entity';
import { Site } from './site.entity';
import { StoredFile } from './stored-file.entity';

/**
 * A visit. Every column holding personal data ends in "Enc" and is encrypted
 * by CryptoService with a column-bound context; "*Index" columns are blind indexes.
 */
@Entity('visits')
@Index(['tenantId', 'siteId', 'checkInAt'])
@Index(['tenantId', 'siteId', 'status'])
@Index(['tenantId', 'checkInAt'])
@Index(['noticeEmailStatus'])
@Index('IDX_visits_badge_email_status', ['badgeEmailStatus'])
@Index('IDX_visits_host_email_status', ['hostEmailStatus'])
export class Visit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @ManyToOne(() => Site) @JoinColumn({ name: 'siteId' }) site?: Site;
  @Column({ type: 'varchar', length: 12 }) status: VisitStatus;
  /** Short code shown to the visitor, used to check out. Not personal data. */
  @Column({ type: 'varchar', length: 8 }) code: string;
  @Column({ type: 'datetime', precision: 3 }) checkInAt: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) checkOutAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) checkInDeviceId: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) checkOutBy: string | null;

  @Column({ type: 'text', nullable: true }) firstNameEnc: string | null;
  @Column({ type: 'text', nullable: true }) lastNameEnc: string | null;
  @Index() @Column({ type: 'char', length: 64, nullable: true }) lastNameIndex: string | null;
  @Column({ type: 'text', nullable: true }) companyEnc: string | null;
  @Column({ type: 'text', nullable: true }) emailEnc: string | null;
  @Index() @Column({ type: 'char', length: 64, nullable: true }) emailIndex: string | null;
  @Column({ type: 'text', nullable: true }) hostEnc: string | null;
  /** Host picked from the directory; hostEnc keeps a snapshot of the name shown at check-in. */
  @Column({ type: 'uuid', nullable: true }) hostId: string | null;
  @ManyToOne(() => Host, { nullable: true }) @JoinColumn({ name: 'hostId', foreignKeyConstraintName: 'FK_visits_host' }) hostRef?: Host | null;
  /** Null only for visits registered before the question existed. */
  @Column({ type: 'varchar', length: 20, nullable: true }) travelDistance: TravelDistance | null;
  @Column({ type: 'varchar', length: 20 }) purpose: VisitPurpose;
  @Column({ type: 'varchar', length: 20, nullable: true }) documentType: DocumentType | null;
  @Column({ type: 'text', nullable: true }) documentNumberEnc: string | null;

  @Column({ type: 'varchar', length: 5 }) locale: string;
  @Column({ type: 'uuid' }) privacyNoticeId: string;
  @Column({ type: 'int' }) privacyNoticeVersion: number;
  @Column({ type: 'datetime', precision: 3 }) privacyAcceptedAt: Date;
  @Column({ type: 'varchar', length: 16 }) noticeEmailStatus: NoticeEmailStatus;
  @Column({ type: 'tinyint', default: 0 }) noticeEmailAttempts: number;
  /** Exit badge (visit code) sent to the email given at check-in, through the same outbox. */
  @Column({ type: 'varchar', length: 16, default: NoticeEmailStatus.NOT_REQUESTED }) badgeEmailStatus: NoticeEmailStatus;
  @Column({ type: 'tinyint', default: 0 }) badgeEmailAttempts: number;
  /** Arrival notice to the host picked from the directory (when the host has an email). */
  @Column({ type: 'varchar', length: 16, default: NoticeEmailStatus.NOT_REQUESTED }) hostEmailStatus: NoticeEmailStatus;
  @Column({ type: 'tinyint', default: 0 }) hostEmailAttempts: number;

  @Column({ type: 'datetime', precision: 3, nullable: true }) anonymizedAt: Date | null;
  @OneToMany(() => StoredFile, (f) => f.visit) files?: StoredFile[];
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
