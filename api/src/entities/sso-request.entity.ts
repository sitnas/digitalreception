import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One single sign-on attempt, from the redirect to the provider until the session is opened
 * (10 minutes at most). Only hashes of the state, of the browser binding and of the hand-off code
 * are stored; the row is deleted when used.
 */
@Entity('sso_requests')
@Index('IDX_sso_requests_state', ['stateHash'], { unique: true })
@Index('IDX_sso_requests_handoff', ['handoffHash'], { unique: true })
@Index('IDX_sso_requests_expires', ['expiresAt'])
export class SsoRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'varchar', length: 12 }) provider: 'microsoft' | 'google';
  /**
   * login = open a session; link = a SUPER_ADMIN connects the organisation's directory;
   * badge = the phone app activates the employee's badge (PKCE challenge in browserHash).
   */
  @Column({ type: 'varchar', length: 8 }) mode: 'login' | 'link' | 'badge';
  /** The SUPER_ADMIN who started a link. */
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column({ type: 'char', length: 64 }) stateHash: string;
  /** login/link: hash of the browser cookie; badge: SHA-256 of the verifier only the app knows. */
  @Column({ type: 'char', length: 64 }) browserHash: string;
  /** badge: the app's own address (drbadge://…, exp://… in development) that receives the hand-off code. */
  @Column({ type: 'varchar', length: 300, nullable: true }) returnTo: string | null;
  @Column({ type: 'varchar', length: 64 }) nonce: string;
  @Column({ type: 'varchar', length: 128 }) codeVerifier: string;
  /** Filled by the callback: what the provider confirmed, and the one-time code the browser brings back. */
  @Column({ type: 'char', length: 64, nullable: true }) handoffHash: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) subject: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) orgId: string | null;
  @Column({ type: 'varchar', length: 190, nullable: true }) orgLabel: string | null;
  @Column({ type: 'varchar', length: 190, nullable: true }) email: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) error: string | null;
  @Column({ type: 'datetime', precision: 3 }) expiresAt: Date;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
