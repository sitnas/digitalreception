import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type WebhookKind = 'teams' | 'slack' | 'generic';
export type WebhookEvent = 'visit.arrived' | 'access.denied';
export const WEBHOOK_EVENTS: WebhookEvent[] = ['visit.arrived', 'access.denied'];

/**
 * Where the organisation wants to be told about events: a Microsoft Teams or Slack channel, or any
 * HTTPS endpoint (signed). The address carries its own secret, so it is stored encrypted.
 */
@Entity('webhooks')
@Index('IDX_webhooks_tenant', ['tenantId'])
export class Webhook {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ type: 'varchar', length: 10 }) kind: WebhookKind;
  @Column({ type: 'text' }) urlEnc: string;
  /** Host of the address, to recognise it in the console without showing the secret part. */
  @Column({ type: 'varchar', length: 190 }) urlHost: string;
  /** Comma-separated WebhookEvent values. */
  @Column({ type: 'varchar', length: 200 }) events: string;
  /** Only events of this site; null = every site. */
  @Column({ type: 'uuid', nullable: true }) siteId: string | null;
  /** Off by default: a channel is read by many people, visitor names are personal data. */
  @Column({ default: false }) includeNames: boolean;
  /** HMAC key for the generic kind (X-DR-Signature). */
  @Column({ type: 'text', nullable: true }) secretEnc: string | null;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'varchar', length: 60, nullable: true }) lastResult: string | null;
  @Column({ type: 'datetime', precision: 3, nullable: true }) lastAt: Date | null;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

/** Outbox: written in the same transaction as the event, delivered by a worker with retries. */
@Entity('webhook_deliveries')
@Index('IDX_webhook_deliveries_due', ['status', 'nextAt'])
@Index('IDX_webhook_deliveries_created', ['createdAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) tenantId: string;
  @Column({ type: 'uuid' }) webhookId: string;
  @Column({ type: 'varchar', length: 30 }) event: WebhookEvent | 'test';
  /** JSON of the event, encrypted (it may hold names). */
  @Column({ type: 'text' }) payloadEnc: string;
  @Column({ type: 'varchar', length: 8 }) status: 'PENDING' | 'SENT' | 'FAILED';
  @Column({ type: 'tinyint', default: 0 }) attempts: number;
  @Column({ type: 'datetime', precision: 3 }) nextAt: Date;
  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
