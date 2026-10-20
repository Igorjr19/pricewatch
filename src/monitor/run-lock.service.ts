import type { Client } from '@libsql/client';

/** Single-row lock (`run_lock`, id = 1). An expired lock can be taken over (REQ-CYC-001). */
export class RunLockService {
  constructor(private readonly client: Client) {}

  /** Atomic: the upsert only overwrites the row when it has expired. Returns whether the lock was taken. */
  async acquire(holder: string, now: Date, ttlMs: number): Promise<boolean> {
    const acquiredAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const result = await this.client.execute({
      sql: `INSERT INTO run_lock (id, holder, acquired_at, expires_at) VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at
            WHERE run_lock.expires_at <= ?`,
      args: [holder, acquiredAt, expiresAt, acquiredAt],
    });
    return result.rowsAffected === 1;
  }

  async release(holder: string): Promise<void> {
    await this.client.execute({
      sql: 'DELETE FROM run_lock WHERE id = 1 AND holder = ?',
      args: [holder],
    });
  }
}
