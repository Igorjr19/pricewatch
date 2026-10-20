import type { Clock } from '../common/clock.js';

export interface SchedulerConfig {
  scrapeIntervalMs: number;
  scrapeJitterMs: number;
  maxBackoffMs: number;
}

const MIN_DELAY_MS = 60_000;

/** Per-listing scheduling (REQ-SCH-001/002). All times are ISO 8601 UTC. */
export class SchedulerService {
  constructor(
    private readonly clock: Clock,
    private readonly config: SchedulerConfig,
    /** Returns a value in [0, 1). Injected so tests are deterministic. */
    private readonly random: () => number = Math.random,
  ) {}

  intervalMs(checkIntervalMinutes: number | null): number {
    return checkIntervalMinutes === null
      ? this.config.scrapeIntervalMs
      : checkIntervalMinutes * 60_000;
  }

  /** now + interval ± jitter, never earlier than now + 1m. */
  nextAfterSuccess(checkIntervalMinutes: number | null): string {
    const now = this.clock.now().getTime();
    const jitter = Math.round(
      (this.random() * 2 - 1) * this.config.scrapeJitterMs,
    );
    const delay = Math.max(
      this.intervalMs(checkIntervalMinutes) + jitter,
      MIN_DELAY_MS,
    );
    return new Date(now + delay).toISOString();
  }

  /** now + min(interval × 2^(failures-1), PW_MAX_BACKOFF). `failures` already includes this failure. */
  nextAfterFailure(
    checkIntervalMinutes: number | null,
    failures: number,
  ): string {
    const now = this.clock.now().getTime();
    const backoff =
      this.intervalMs(checkIntervalMinutes) * 2 ** Math.max(failures - 1, 0);
    return new Date(
      now + Math.min(backoff, this.config.maxBackoffMs),
    ).toISOString();
  }
}
