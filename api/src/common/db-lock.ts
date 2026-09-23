import { DataSource } from 'typeorm';

/**
 * Cluster-wide mutual exclusion using MySQL/MariaDB named locks, so that with N API replicas
 * each background job still runs once. The lock is tied to the connection: if the process
 * dies, the database releases it automatically. Returns false if another replica holds it.
 */
export async function withDbLock(ds: DataSource, name: string, fn: () => Promise<void>): Promise<boolean> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  try {
    const [row] = await qr.query('SELECT GET_LOCK(?, 0) AS l', [`reception:${name}`]);
    if (Number(row?.l) !== 1) return false;
    try { await fn(); } finally { await qr.query('SELECT RELEASE_LOCK(?)', [`reception:${name}`]); }
    return true;
  } finally {
    await qr.release();
  }
}
