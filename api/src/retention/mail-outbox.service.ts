import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../common/app-config';
import { withDbLock } from '../common/db-lock';
import { MailService } from '../common/mail.service';
import { TenantKeysService } from '../common/tenant-keys.service';
import { renderNotice } from '../kiosk/kiosk.service';
import { CountryPolicy, Host, Invitation, InvitationStatus, NoticeEmailStatus, PrivacyNotice, Site, Tenant, Visit, VisitStatus } from '../entities';

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
    await this.sendNotices();
    await this.sendBadges();
    await this.sendHostArrivals();
    await this.sendInvitations();
  }

  private next(ok: boolean, attempts: number): NoticeEmailStatus {
    return ok ? NoticeEmailStatus.SENT : attempts >= MAX_ATTEMPTS ? NoticeEmailStatus.FAILED : NoticeEmailStatus.PENDING;
  }

  private async sendNotices() {
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
        noticeEmailStatus: this.next(ok, attempts),
      });
    }
  }

  /** Exit badge: sent only while the visit is still open, a badge for a closed visit is useless. */
  private async sendBadges() {
    const pending = await this.visits.find({ where: { badgeEmailStatus: NoticeEmailStatus.PENDING }, order: { checkInAt: 'ASC' }, take: 100 });
    for (const v of pending) {
      if (v.status !== VisitStatus.OPEN) {
        await this.visits.update({ id: v.id }, { badgeEmailStatus: NoticeEmailStatus.SKIPPED });
        continue;
      }
      const tc = await this.keys.forTenant(v.tenantId);
      const email = tc.decrypt(v.emailEnc, 'visit.email');
      const firstName = tc.decrypt(v.firstNameEnc, 'visit.firstName');
      const lastName = tc.decrypt(v.lastNameEnc, 'visit.lastName');
      const site = await this.ds.getRepository(Site).findOne({ where: { id: v.siteId, tenantId: v.tenantId } });
      const tenant = await this.ds.getRepository(Tenant).findOne({ where: { id: v.tenantId }, select: { id: true, name: true, primaryColor: true, secondaryColor: true } });
      if (!email || !firstName || !lastName || !site || !tenant) {
        await this.visits.update({ id: v.id }, { badgeEmailStatus: NoticeEmailStatus.FAILED });
        continue;
      }
      const ok = await this.mail.sendBadge(email, tenant.name, {
        locale: v.locale, timezone: site.timezone, siteName: site.name, code: v.code, checkInAt: v.checkInAt,
        visitorLabel: `${firstName} ${lastName}`, hostName: tc.decrypt(v.hostEnc, 'visit.host') ?? '—',
        primaryColor: tenant.primaryColor, secondaryColor: tenant.secondaryColor,
      });
      const attempts = v.badgeEmailAttempts + 1;
      await this.visits.update({ id: v.id }, { badgeEmailAttempts: attempts, badgeEmailStatus: this.next(ok, attempts) });
    }
  }

  /** Arrival notice to the host. Skipped if the visit is already closed or the host lost their email. */
  private async sendHostArrivals() {
    const pending = await this.visits.find({ where: { hostEmailStatus: NoticeEmailStatus.PENDING }, order: { checkInAt: 'ASC' }, take: 100 });
    for (const v of pending) {
      const host = v.hostId ? await this.ds.getRepository(Host).findOne({ where: { id: v.hostId, tenantId: v.tenantId } }) : null;
      if (v.status !== VisitStatus.OPEN || !host?.email || !host.active) {
        await this.visits.update({ id: v.id }, { hostEmailStatus: NoticeEmailStatus.SKIPPED });
        continue;
      }
      const tc = await this.keys.forTenant(v.tenantId);
      const firstName = tc.decrypt(v.firstNameEnc, 'visit.firstName');
      const lastName = tc.decrypt(v.lastNameEnc, 'visit.lastName');
      const site = await this.ds.getRepository(Site).findOne({ where: { id: v.siteId, tenantId: v.tenantId } });
      const policy = site && await this.ds.getRepository(CountryPolicy).findOne({ where: { tenantId: v.tenantId, countryCode: site.countryCode } });
      const tenant = await this.ds.getRepository(Tenant).findOne({ where: { id: v.tenantId }, select: { id: true, name: true, primaryColor: true } });
      if (!firstName || !lastName || !site || !policy || !tenant) {
        await this.visits.update({ id: v.id }, { hostEmailStatus: NoticeEmailStatus.FAILED });
        continue;
      }
      const ok = await this.mail.sendHostArrival(host.email, tenant.name, {
        locale: policy.defaultLocale, timezone: site.timezone, siteName: site.name, checkInAt: v.checkInAt, purpose: v.purpose,
        visitorName: `${firstName} ${lastName}`, company: tc.decrypt(v.companyEnc, 'visit.company'), primaryColor: tenant.primaryColor,
      });
      const attempts = v.hostEmailAttempts + 1;
      await this.visits.update({ id: v.id }, { hostEmailAttempts: attempts, hostEmailStatus: this.next(ok, attempts) });
    }
  }

  /** Invitation email: only while the invitation can still be used. */
  private async sendInvitations() {
    const repo = this.ds.getRepository(Invitation);
    const pending = await repo.find({ where: { emailStatus: NoticeEmailStatus.PENDING }, order: { createdAt: 'ASC' }, take: 100 });
    for (const inv of pending) {
      if (inv.status !== InvitationStatus.PENDING || inv.validUntil < new Date()) {
        await repo.update({ id: inv.id }, { emailStatus: NoticeEmailStatus.SKIPPED });
        continue;
      }
      const tc = await this.keys.forTenant(inv.tenantId);
      const email = tc.decrypt(inv.emailEnc, 'invitation.email');
      const code = tc.decrypt(inv.codeEnc, 'invitation.code');
      const firstName = tc.decrypt(inv.firstNameEnc, 'invitation.firstName');
      const lastName = tc.decrypt(inv.lastNameEnc, 'invitation.lastName');
      const site = await this.ds.getRepository(Site).findOne({ where: { id: inv.siteId, tenantId: inv.tenantId } });
      const host = await this.ds.getRepository(Host).findOne({ where: { id: inv.hostId, tenantId: inv.tenantId } });
      const tenant = await this.ds.getRepository(Tenant).findOne({ where: { id: inv.tenantId }, select: { id: true, name: true, primaryColor: true, secondaryColor: true } });
      if (!email || !code || !firstName || !lastName || !site || !host || !tenant) {
        await repo.update({ id: inv.id }, { emailStatus: NoticeEmailStatus.FAILED });
        continue;
      }
      const ok = await this.mail.sendInvitation(email, tenant.name, {
        locale: inv.locale, timezone: site.timezone, siteName: site.name, visitorName: `${firstName} ${lastName}`,
        hostName: `${host.firstName} ${host.lastName}`, expectedAt: inv.expectedAt, code,
        primaryColor: tenant.primaryColor, secondaryColor: tenant.secondaryColor,
      });
      const attempts = inv.emailAttempts + 1;
      await repo.update({ id: inv.id }, { emailAttempts: attempts, emailStatus: this.next(ok, attempts) });
    }
  }
}
