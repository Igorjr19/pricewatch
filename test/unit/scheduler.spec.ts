import { describe, expect, it } from 'vitest';
import { SchedulerService } from '../../src/monitor/scheduler.service.js';
import { FakeClock } from '../support/fakes.js';

const HOUR = 3_600_000;
const MIN = 60_000;
const config = {
  scrapeIntervalMs: 3 * HOUR,
  scrapeJitterMs: 20 * MIN,
  maxBackoffMs: 24 * HOUR,
};

function scheduler(random = () => 0.5, overrides: Partial<typeof config> = {}) {
  const clock = new FakeClock('2026-01-01T12:00:00.000Z');
  return {
    clock,
    scheduler: new SchedulerService(clock, { ...config, ...overrides }, random),
  };
}

const msFromNow = (clock: FakeClock, iso: string) =>
  new Date(iso).getTime() - clock.now().getTime();

describe('REQ-SCH-001 next check after success', () => {
  it('is now + interval with zero jitter at the midpoint', () => {
    const { clock, scheduler: s } = scheduler(() => 0.5);
    expect(msFromNow(clock, s.nextAfterSuccess(null))).toBe(3 * HOUR);
  });

  it('applies jitter within ± PW_SCRAPE_JITTER', () => {
    const low = scheduler(() => 0);
    const high = scheduler(() => 0.999999);
    expect(msFromNow(low.clock, low.scheduler.nextAfterSuccess(null))).toBe(
      3 * HOUR - 20 * MIN,
    );
    expect(
      msFromNow(high.clock, high.scheduler.nextAfterSuccess(null)),
    ).toBeCloseTo(3 * HOUR + 20 * MIN, -1);
  });

  it('never schedules earlier than now + 1m', () => {
    const { clock, scheduler: s } = scheduler(() => 0, {
      scrapeIntervalMs: 5 * MIN,
      scrapeJitterMs: 30 * MIN,
    });
    expect(msFromNow(clock, s.nextAfterSuccess(null))).toBe(MIN);
  });

  it('uses the listing interval when set', () => {
    const { clock, scheduler: s } = scheduler(() => 0.5);
    expect(msFromNow(clock, s.nextAfterSuccess(30))).toBe(30 * MIN);
  });
});

describe('REQ-SCH-002 backoff after failure', () => {
  it('3rd failure with a 3h interval waits 12h', () => {
    const { clock, scheduler: s } = scheduler();
    expect(msFromNow(clock, s.nextAfterFailure(null, 3))).toBe(12 * HOUR);
  });

  it('is capped by PW_MAX_BACKOFF (6 failures → 24h)', () => {
    const { clock, scheduler: s } = scheduler();
    expect(msFromNow(clock, s.nextAfterFailure(null, 6))).toBe(24 * HOUR);
  });

  it('first failure waits one interval', () => {
    const { clock, scheduler: s } = scheduler();
    expect(msFromNow(clock, s.nextAfterFailure(null, 1))).toBe(3 * HOUR);
  });
});
