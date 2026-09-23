import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { withDbLock } from '../common/db-lock';
import { MailService } from '../common/mail.service';
import { TenantKeysService } from '../common/tenant-keys.service';
import { renderNotice } from '../kiosk/kiosk.service';
import { CountryPolicy, NoticeEmailStatus, PrivacyNotice, Site, Tenant, Visit } from '../entities';

const MAX_ATTEMPTS = 3;

/**
 * Transactional outbox: check-in only marks the visit PENDING; this worker delivers.
 * The tablet never waits for SMTP, and pending mails survive restarts and deploys.
 */
@Injectable()
export class MailOutboxService {
  private readonly log = new Logger(MailOutboxService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    private readonly keys: TenantKeysService,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduled() {
    if (this.cfg.jobs.enabled && this.mail.enabled) await this.run();
  }

  async run() {
    try { await withDbLock(this.ds, 'mail-outbox', () => this.execute()); }
    catch (e) { this.log.error(`Mail outbox failed: ${(e as Error).message}`); }
  }

  private async execute() {
    const pending = await this.visits.find({ where: { noticeEmailStatus: NoticeEmailStatus.PENDING }, order: { checkInAt: 'ASC' }, take: 100 });
    for (const v of pending) {
      const tc = await this.keys.forTenant(v.tenantId);
      const email = tc.decrypt(v.emailEnc, 'visit.email');
      const notice = await this.ds.getRepository(PrivacyNotice).findOne({ where: { id: v.privacyNoticeId, tenantId: v.tenantId } });
      const site = await this.ds.getRepository(Site).findOne({ where: { id: v.siteId, tenantId: v.tenantId } });
      const policy = site && await this.ds.getRepository(CountryPolicy).findOne({ where: { tenantId: v.tenantId, countryCode: site.countryCode } });
      const tenant = await this.ds.getRepository(Tenant).findOne({ where: { id: v.tenantId }, select: { id: true, name: true } });
      if (!email || !notice || !site || !policy || !tenant) {
        await this.visits.update({ id: v.id }, { noticeEmailStatus: NoticeEmailStatus.FAILED });
        continue;
      }
      // The visitor receives exactly the version they accepted.
      const ok = await this.mail.sendNotice(email, tenant.name, notice.title, renderNotice(notice.body, policy), site.name);
      const attempts = v.noticeEmailAttempts + 1;
      await this.visits.update({ id: v.id }, {
        noticeEmailAttempts: attempts,
        noticeEmailStatus: ok ? NoticeEmailStatus.SENT : attempts >= MAX_ATTEMPTS ? NoticeEmailStatus.FAILED : NoticeEmailStatus.PENDING,
      });
    }
  }
}
