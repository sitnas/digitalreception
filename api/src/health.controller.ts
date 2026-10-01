import { Controller, Get, HttpStatus, Inject, NotFoundException, Req, Res, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { APP_CONFIG, AppConfig } from './common/app-config';
import { MailService } from './common/mail.service';

/** Longest acceptable gap between two runs of each job (they run every 30 min / every minute). */
const MAX_GAP_MIN = { retention: 90, 'mail-outbox': 10, 'webhook-outbox': 10, 'push-outbox': 10 } as const;
/** An email still waiting after this long means the outbox is stuck, not just busy. */
const STUCK_MAIL_MIN = 15;
const STARTED_AT = Date.now();

/** For load balancers / orchestrators. Outside tenant resolution on purpose. */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource, @Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly mail: MailService) {}

  /** Liveness: the process answers. */
  @Get('live')
  live() { return { status: 'ok' }; }

  /** Readiness: the process can serve traffic (database reachable). */
  @Get()
  async ready() {
    await this.ds.query('SELECT 1');
    return { status: 'ok' };
  }

  /**
   * For an uptime monitor (UptimeRobot, Better Stack, Zabbix…): 200 when background work is
   * healthy, 503 when a job has stopped, failed in the last hour, or emails are stuck.
   * Counts only, no personal data; still protected by HEALTH_TOKEN (off when unset).
   */
  @Get('ops')
  async ops(@Req() req: Request, @Res() res: Response) {
    if (!this.cfg.healthToken) throw new NotFoundException();
    const given = Buffer.from(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
    const want = Buffer.from(this.cfg.healthToken);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new UnauthorizedException();

    const problems: string[] = [];
    const runs: { name: keyof typeof MAX_GAP_MIN; lastRunAt: Date; lastError: string | null; lastErrorAt: Date | null; ageMin: number }[] =
      await this.ds.query('SELECT name, lastRunAt, lastError, lastErrorAt, TIMESTAMPDIFF(SECOND, lastRunAt, UTC_TIMESTAMP(3)) / 60 AS ageMin FROM job_runs');
    const uptimeMin = (Date.now() - STARTED_AT) / 60_000;
    const jobs: Record<string, unknown> = {};
    for (const name of Object.keys(MAX_GAP_MIN) as (keyof typeof MAX_GAP_MIN)[]) {
      if (name === 'mail-outbox' && !this.mail.enabled) { jobs[name] = { enabled: false }; continue; }
      const r = runs.find((x) => x.name === name);
      const age = r ? Number(r.ageMin) : null;
      const recentError = !!r?.lastErrorAt && Date.now() - new Date(r.lastErrorAt).getTime() < 60 * 60_000;
      // Right after a start the jobs have not had time to run yet.
      const stale = age === null ? uptimeMin > MAX_GAP_MIN[name] + 5 : age > MAX_GAP_MIN[name];
      if (stale) problems.push(`${name}: not run for ${age === null ? 'ever' : `${Math.round(age)} min`}`);
      if (recentError) problems.push(`${name}: ${r!.lastError}`);
      jobs[name] = { lastRunAt: r?.lastRunAt ?? null, lastError: r?.lastError ?? null, lastErrorAt: r?.lastErrorAt ?? null };
    }

    const [mail] = await this.ds.query(
      `SELECT
         (SELECT COUNT(*) FROM visits WHERE (noticeEmailStatus = 'PENDING' OR badgeEmailStatus = 'PENDING' OR hostEmailStatus = 'PENDING') AND checkInAt < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))
       + (SELECT COUNT(*) FROM invitations WHERE emailStatus = 'PENDING' AND createdAt < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)) AS stuck,
         (SELECT COUNT(*) FROM visits WHERE (noticeEmailStatus = 'FAILED' OR badgeEmailStatus = 'FAILED' OR hostEmailStatus = 'FAILED') AND checkInAt > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)) AS failed24h`,
      [STUCK_MAIL_MIN, STUCK_MAIL_MIN],
    );
    if (this.mail.enabled && Number(mail.stuck) > 0) problems.push(`mail: ${mail.stuck} emails waiting for more than ${STUCK_MAIL_MIN} min`);
    const [hooks] = await this.ds.query(
      `SELECT SUM(status = 'PENDING') AS pending, SUM(status = 'FAILED' AND createdAt > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)) AS failed24h FROM webhook_deliveries`,
    );

    const body = {
      status: problems.length ? 'degraded' : 'ok', problems, jobs,
      mail: { enabled: this.mail.enabled, stuck: Number(mail.stuck), failed24h: Number(mail.failed24h) },
      webhooks: { pending: Number(hooks.pending ?? 0), failed24h: Number(hooks.failed24h ?? 0) },
    };
    res.status(problems.length ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK).json(body);
  }
}
