import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { FileKind } from './enums';
import { Visit } from './visit.entity';

/** Metadata of an encrypted image on disk. The file itself is never served statically. */
@Entity('stored_files')
@Index(['purgeAfter', 'purgedAt'])
export class StoredFile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) visitId: string;
  @ManyToOne(() => Visit, (v) => v.files) @JoinColumn({ name: 'visitId' }) visit?: Visit;
  @Column({ type: 'varchar', length: 16 }) kind: FileKind;
  @Column({ type: 'varchar', length: 8 }) keyId: string;
  @Column({ type: 'varchar', length: 32 }) mime: string;
  @Column({ type: 'int' }) size: number;
  @Column({ type: 'varchar', length: 255 }) storagePath: string;
  @Column({ type: 'datetime', precision: 3 }) purgeAfter: Date;
  @Column({ type: 'datetime', precision: 3, nullable: true }) purgedAt: Date | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
