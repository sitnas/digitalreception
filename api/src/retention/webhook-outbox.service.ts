import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { withDbLock } from '../common/db-lock';
import { markJobRun } from '../common/job-runs';
import { WebhooksService } from '../common/webhooks.service';

/** Delivers queued Teams / Slack / HTTPS notifications every minute, on one replica at a time. */
@Injectable()
export class WebhookOutboxService {
  private readonly log = new Logger(WebhookOutboxService.name);

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, @InjectDataSource() private readonly ds: DataSource, private readonly webhooks: WebhooksService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduled() {
    if (this.cfg.jobs.enabled) await this.run();
  }

  async run() {
    try { await withDbLock(this.ds, 'webhook-outbox', async () => { while ((await this.webhooks.deliverDue()) === 100); await markJobRun(this.ds, 'webhook-outbox'); }); }
    catch (e) { this.log.error(`Webhook outbox failed: ${(e as Error).message}`); await markJobRun(this.ds, 'webhook-outbox', e); }
  }
}
