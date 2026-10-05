import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FileKind } from './enums';
import { Visit } from './visit.entity';

/** Metadata of an encrypted image on disk. The file itself is never served statically. */
@Entity('stored_files')
@Index(['purgeAfter', 'purgedAt'])
export class StoredFile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  /** Null only while the file belongs to a pre-registration (invitationId), before the guest arrives. */
  @Column({ type: 'uuid', nullable: true }) visitId: string | null;
  @ManyToOne(() => Visit, (v) => v.files) @JoinColumn({ name: 'visitId' }) visit?: Visit;
  @Index('IDX_stored_files_invitation') @Column({ type: 'uuid', nullable: true }) invitationId: string | null;
  /** Photo of a parcel left at reception. */
  @Index('IDX_stored_files_parcel') @Column({ type: 'uuid', nullable: true }) parcelId: string | null;
  @Column({ type: 'varchar', length: 16 }) kind: FileKind;
  @Column({ type: 'varchar', length: 8 }) keyId: string;
  @Column({ type: 'varchar', length: 32 }) mime: string;
  @Column({ type: 'int' }) size: number;
  @Column({ type: 'varchar', length: 255 }) storagePath: string;
  @Column({ type: 'datetime', precision: 3 }) purgeAfter: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) purgedAt: Date | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
