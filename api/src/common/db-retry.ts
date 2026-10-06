/**
 * MySQL and MariaDB may cancel one of two transactions that lock each other (deadlock, 1213) or that
 * wait too long for a lock (1205): the documented answer is to run it again. Used around writes that
 * external systems send in parallel, such as an HR sync.
 */
const RETRYABLE = new Set([1213, 1205]);

export function isRetryableLockError(e: unknown): boolean {
  const err = e as { errno?: number; driverError?: { errno?: number } } | null;
  return RETRYABLE.has(err?.driverError?.errno ?? err?.errno ?? -1);
}

export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= attempts || !isRetryableLockError(e)) throw e;
      // A short random pause, growing with each attempt, so the two transactions do not meet again.
      await new Promise((r) => setTimeout(r, 10 * i + Math.random() * 40 * i));
    }
  }
}
