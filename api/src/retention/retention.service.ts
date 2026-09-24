import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { withDbLock } from '../common/db-lock';
import { FilesService } from '../common/files.service';
import { addDays, startOfLocalDay } from '../common/time.util';
import { VisitLifecycleService } from '../common/visit-lifecycle.service';
import { CountryPolicy, Invitation, Site, StoredFile, Visit, VisitStatus } from '../entities';
import { INVITATION_KEEP_DAYS } from '../invitations/invitations.service';

const BATCH = 500;

/**
 * Storage limitation (GDPR art. 5.1.e) enforced by code, for every tenant:
 *  1. images past their own retention are deleted;
 *  2. visits past the country retention are anonymised;
 *  3. visits still open from a previous local day are closed as AUTO_CLOSED;
 *  4. invitations are deleted INVITATION_KEEP_DAYS after their day (used, cancelled or not).
 * Runs on one replica at a time (DB lock), in bounded batches so it scales with data volume.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(StoredFile) private readonly files: Repository<StoredFile>,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(CountryPolicy) private readonly policies: Repository<CountryPolicy>,
    private readonly fileService: FilesService,
    private readonly lifecycle: VisitLifecycleService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduled() {
    if (this.cfg.jobs.enabled) await this.run();
  }

  async run(): Promise<void> {
    try {
      const ran = await withDbLock(this.ds, 'retention', () => this.execute());
      if (!ran) this.log.debug('Retention skipped: running on another replica');
    } catch (e) {
      this.log.error(`Retention run failed: ${(e as Error).message}`);
    }
  }

  private async execute() {
    const now = new Date();
    const stats = new Map<string, { filesPurged: number; visitsAnonymised: number; autoClosed: number }>();
    const bump = (tenantId: string, k: 'filesPurged' | 'visitsAnonymised' | 'autoClosed', n = 1) => {
      const s = stats.get(tenantId) ?? { filesPurged: 0, visitsAnonymised: 0, autoClosed: 0 };
      s[k] += n; stats.set(tenantId, s);
    };

    for (;;) {
      const due = await this.files.find({ where: { purgeAfter: LessThan(now), purgedAt: IsNull() }, take: BATCH });
      for (const f of due) { await this.fileService.purge(f); bump(f.tenantId, 'filesPurged'); }
      if (due.length < BATCH) break;
    }

    const policies = new Map((await this.policies.find()).map((p) => [`${p.tenantId}|${p.countryCode}`, p]));
    for (const site of await this.sites.find()) {
      const policy = policies.get(`${site.tenantId}|${site.countryCode}`);
      if (!policy) continue;
      const cutoff = addDays(now, -policy.visitRetentionDays);
      for (;;) {
        const expired = await this.visits.find({ where: { tenantId: site.tenantId, siteId: site.id, anonymizedAt: IsNull(), checkInAt: LessThan(cutoff) }, select: { id: true }, take: BATCH });
        for (const v of expired) { await this.lifecycle.anonymize(site.tenantId, v.id, { erased: false }); bump(site.tenantId, 'visitsAnonymised'); }
        if (expired.length < BATCH) break;
      }
      const res = await this.visits.update(
        { tenantId: site.tenantId, siteId: site.id, status: VisitStatus.OPEN, checkInAt: LessThan(startOfLocalDay(now, site.timezone)) },
        { status: VisitStatus.AUTO_CLOSED, checkOutBy: 'system:end-of-day' },
      );
      if (res.affected) bump(site.tenantId, 'autoClosed', res.affected);
    }

    const inv = await this.ds.getRepository(Invitation).delete({ validUntil: LessThan(addDays(now, -INVITATION_KEEP_DAYS)) });
    if (inv.affected) this.log.log(`Retention: ${inv.affected} past invitations deleted`);

    for (const [tenantId, s] of stats) {
      await this.audit.system(tenantId, { action: 'RETENTION_RUN', details: { ...s } });
      this.log.log(`Retention tenant ${tenantId}: ${s.filesPurged} files purged, ${s.visitsAnonymised} visits anonymised, ${s.autoClosed} auto-closed`);
    }
  }
}
