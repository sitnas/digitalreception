import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { withDbLock } from '../common/db-lock';
import { markJobRun } from '../common/job-runs';
import { PushService } from '../common/push.service';

/** Retries push notices that could not be sent right after the check-in, every minute, on one replica at a time. */
@Injectable()
export class PushOutboxService {
  private readonly log = new Logger(PushOutboxService.name);

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, @InjectDataSource() private readonly ds: DataSource, private readonly push: PushService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduled() {
    if (this.cfg.jobs.enabled) await this.run();
  }

  async run() {
    try { await withDbLock(this.ds, 'push-outbox', async () => { while ((await this.push.deliverDue()) === 100); await markJobRun(this.ds, 'push-outbox'); }); }
    catch (e) { this.log.error(`Push outbox failed: ${(e as Error).message}`); await markJobRun(this.ds, 'push-outbox', e); }
  }
}
