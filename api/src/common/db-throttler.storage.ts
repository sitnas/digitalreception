import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';

/**
 * Rate-limit counters shared by every API replica (THROTTLE_STORE=database). The default store
 * keeps them in the memory of each process, so with three replicas an attacker would get three
 * times the sign-in attempts. Fixed window per key, one upsert per request; expired rows are
 * removed by the retention job.
 */
export class DbThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly ds: DataSource) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const k = createHash('sha256').update(`${throttlerName}|${key}`).digest('hex');
    // `hits` is assigned before `expiresAt`, so both read the old expiry: a finished window restarts at 1.
    await this.ds.query(
      `INSERT INTO throttle_counters (k, hits, expiresAt, blockedUntil) VALUES (?, 1, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND), NULL)
       ON DUPLICATE KEY UPDATE hits = IF(expiresAt <= UTC_TIMESTAMP(3), 1, hits + 1),
                               expiresAt = IF(expiresAt <= UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND), expiresAt)`,
      [k, ttl * 1000, ttl * 1000],
    );
    const [row] = await this.ds.query(
      'SELECT hits, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), expiresAt) AS expMs, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), blockedUntil) AS blockMs FROM throttle_counters WHERE k = ?', [k],
    );
    const hits = Number(row.hits);
    let blockMs = row.blockMs === null ? 0 : Math.max(0, Number(row.blockMs) / 1000);
    if (hits > limit && blockMs <= 0) {
      await this.ds.query('UPDATE throttle_counters SET blockedUntil = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND) WHERE k = ?', [blockDuration * 1000, k]);
      blockMs = blockDuration;
    }
    return { totalHits: hits, timeToExpire: Math.ceil(Math.max(0, Number(row.expMs) / 1000) / 1000), isBlocked: blockMs > 0, timeToBlockExpire: Math.ceil(blockMs / 1000) };
  }
}
