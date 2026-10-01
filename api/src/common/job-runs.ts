import { DataSource } from 'typeorm';

export type JobName = 'retention' | 'mail-outbox' | 'webhook-outbox' | 'push-outbox';

/** Records that a background job ran (and how it ended), for /api/health/ops. Never throws. */
export async function markJobRun(ds: DataSource, name: JobName, error?: unknown) {
  const msg = error ? String((error as Error)?.message ?? error).slice(0, 300) : null;
  try {
    await ds.query(
      `INSERT INTO job_runs (name, lastRunAt, lastError, lastErrorAt) VALUES (?, UTC_TIMESTAMP(3), ?, IF(? IS NULL, NULL, UTC_TIMESTAMP(3)))
       ON DUPLICATE KEY UPDATE lastRunAt = UTC_TIMESTAMP(3), lastError = IF(? IS NULL, lastError, VALUES(lastError)), lastErrorAt = IF(? IS NULL, lastErrorAt, UTC_TIMESTAMP(3))`,
      [name, msg, msg, msg, msg],
    );
  } catch { /* monitoring must never break the job */ }
}
