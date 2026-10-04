import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A document the guest reads and accepts at check-in besides the privacy notice: safety rules
 * (in Italy the information of D.Lgs. 81/08), a non-disclosure agreement, house rules.
 * It applies to one site or, with siteId null, to every site of the organisation.
 */
@Entity('site_documents')
@Index('IDX_site_documents_tenant', ['tenantId', 'active'])
export class SiteDocument {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid', nullable: true }) siteId: string | null;
  /** Internal name in the console; the guest sees the title of the version in their language. */
  @Column({ length: 120 }) name: string;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ type: 'int', default: 0 }) position: number;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) updatedAt: Date;
}

/** Text of a document in one language. Immutable like privacy notices: editing publishes a new version. */
@Entity('site_document_versions')
@Index('IDX_site_document_versions_doc', ['documentId', 'locale', 'version'], { unique: true })
export class SiteDocumentVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) documentId: string;
  @Column({ type: 'varchar', length: 5 }) locale: string;
  @Column({ type: 'int' }) version: number;
  @Column({ length: 200 }) title: string;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'uuid', nullable: true }) createdBy: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

/** Proof that a visit accepted an exact version of a document. Kept after the visit is anonymised. */
@Entity('visit_documents')
@Index('IDX_visit_documents_visit', ['visitId'])
export class VisitDocument {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) visitId: string;
  @Column({ type: 'uuid' }) documentId: string;
  @Column({ type: 'uuid' }) versionId: string;
  @Column({ type: 'datetime', precision: 3 }) acceptedAt: Date;
}
