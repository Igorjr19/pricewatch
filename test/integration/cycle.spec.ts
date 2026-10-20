import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fetchAttempts,
  listings,
  observations,
  runLock,
  runs,
} from '../../src/db/schema.js';
import { fakeResult } from '../../src/monitor/adapters/fake.adapter.js';
import { BlockedError } from '../../src/monitor/adapters/types.js';
import { type Harness, HOUR, MIN, makeHarness } from '../support/harness.js';

const URL_A = 'https://fake.test/a';
const URL_B = 'https://fake.test/b';

let harness: Harness | undefined;

afterEach(() => {
  harness?.handle.close();
  harness = undefined;
});

async function setup(options: Parameters<typeof makeHarness>[0] = {}) {
  harness = await makeHarness(options);
  return harness;
}

async function listing(h: Harness, id: string) {
  const rows = await h.handle.db
    .select()
    .from(listings)
    .where(eq(listings.id, id));
  return rows[0] as typeof listings.$inferSelect;
}

describe('REQ-CYC-001 run lock', () => {
  it('returns lock-busy without writing observations when another holder has a valid lock', async () => {
    const h = await setup();
    h.adapter.script(URL_A, fakeResult());
    await h.addListing(URL_A);
    const future = new Date(h.clock.now().getTime() + HOUR).toISOString();
    await h.handle.db.insert(runLock).values({
      id: 1,
      holder: 'someone-else',
      acquiredAt: h.clock.now().toISOString(),
      expiresAt: future,
    });

    const result = await h.cycle.run('cli');

    expect(result).toEqual({ lockBusy: true });
    expect(await h.handle.db.select().from(observations)).toHaveLength(0);
    expect(await h.handle.db.select().from(runs)).toHaveLength(0);
  });

  it('takes over an expired lock and completes the cycle', async () => {
    const h = await setup();
    h.adapter.script(URL_A, fakeResult());
    await h.addListing(URL_A);
    const past = new Date(h.clock.now().getTime() - MIN).toISOString();
    await h.handle.db
      .insert(runLock)
      .values({ id: 1, holder: 'crashed', acquiredAt: past, expiresAt: past });

    const result = await h.cycle.run('cli');

    expect(result).toMatchObject({
      lockBusy: false,
      summary: { status: 'completed', successes: 1 },
    });
  });

  it('releases the lock after the run, so the next cycle can start', async () => {
    const h = await setup();
    expect((await h.cycle.run('cli')).lockBusy).toBe(false);
    expect((await h.cycle.run('cli')).lockBusy).toBe(false);
  });

  it('releases the lock and marks the run failed when the cycle throws', async () => {
    const h = await setup({
      alerts: {
        async handleObservations() {
          throw new Error('alerts exploded');
        },
      },
    });
    await expect(h.cycle.run('cli')).rejects.toThrow('alerts exploded');

    const [run] = await h.handle.db.select().from(runs);
    expect(run?.status).toBe('failed');
    expect(await h.locks.acquire('next', h.clock.now(), MIN)).toBe(true);
  });
});

describe('REQ-CYC-002 due listings', () => {
  it('selects only active/failing listings that are due, of non-archived products', async () => {
    const h = await setup();
    const now = h.clock.now().getTime();
    const later = new Date(now + HOUR).toISOString();
    for (const url of ['a', 'b', 'c', 'd', 'e'])
      h.adapter.script(`https://fake.test/${url}`, fakeResult());
    await h.addListing('https://fake.test/a'); // due
    await h.addListing('https://fake.test/b', { status: 'paused' }); // REQ-SCH-005
    await h.addListing('https://fake.test/c', { nextCheckAt: later }); // not due
    await h.addListing('https://fake.test/d', { status: 'failing' }); // due
    await h.addListing('https://fake.test/e'); // archived product
    await h.archiveProduct('P5');

    const result = await h.cycle.run('cli');

    expect(result).toMatchObject({ summary: { listingsDue: 2, successes: 2 } });
    const checked = (await h.handle.db.select().from(observations))
      .map((o) => o.listingId)
      .sort();
    expect(checked).toEqual(['L1', 'L4']);
  });

  it('orders by next_check_at and honors PW_RUN_MAX_LISTINGS', async () => {
    const h = await setup({ config: { runMaxListings: 2 } });
    const base = h.clock.now().getTime();
    for (const [i, name] of ['a', 'b', 'c'].entries()) {
      h.adapter.script(`https://fake.test/${name}`, fakeResult());
      await h.addListing(`https://fake.test/${name}`, {
        nextCheckAt: new Date(base - (3 - i) * MIN).toISOString(),
      });
    }

    const result = await h.cycle.run('cli');

    expect(result).toMatchObject({ summary: { listingsDue: 2 } });
    const checked = (await h.handle.db.select().from(observations))
      .map((o) => o.listingId)
      .sort();
    expect(checked).toEqual(['L1', 'L2']);
  });
});

describe('REQ-CYC-003 domain delay', () => {
  it('spaces requests to the same domain by PW_DOMAIN_DELAY', async () => {
    const h = await setup();
    h.adapter.script(URL_A, fakeResult()).script(URL_B, fakeResult());
    await h.addListing(URL_A);
    await h.addListing(URL_B);

    await h.cycle.run('cli');

    expect(h.clock.sleeps).toEqual([8_000]);
  });

  it('does not delay requests to different domains', async () => {
    const h = await setup();
    h.adapter.domains.push('other.test');
    h.adapter
      .script(URL_A, fakeResult())
      .script('https://other.test/a', fakeResult());
    await h.addListing(URL_A);
    await h.addListing('https://other.test/a');

    await h.cycle.run('cli');

    expect(h.clock.sleeps).toEqual([]);
  });
});

describe('REQ-CYC-004 run timeout', () => {
  it('stops starting listings, still evaluates what was collected and records timed_out', async () => {
    const h = await setup({ config: { runTimeoutMs: 10_000 } });
    for (const n of [1, 2, 3, 4, 5]) {
      h.adapter.script(`https://fake.test/${n}`, fakeResult());
      await h.addListing(`https://fake.test/${n}`);
    }

    const result = await h.cycle.run('cli');

    // Listings start at t=0s, 8s and 16s (the check at 8s still passes); the 4th is skipped.
    expect(result).toMatchObject({
      summary: {
        status: 'timed_out',
        listingsDue: 5,
        listingsChecked: 3,
        successes: 3,
      },
    });
    expect(h.alerts.batches).toHaveLength(1);
    expect(h.alerts.batches[0]).toHaveLength(3);
  });
});

describe('REQ-RUN-006 abort', () => {
  it('stops starting listings and records the run as failed', async () => {
    const h = await setup();
    h.adapter.script(URL_A, fakeResult());
    await h.addListing(URL_A);
    const controller = new AbortController();
    controller.abort();

    const result = await h.cycle.run('cli', controller.signal);

    expect(result).toMatchObject({
      summary: { status: 'failed', listingsChecked: 0 },
    });
    const [run] = await h.handle.db.select().from(runs);
    expect(run?.status).toBe('failed');
  });
});

describe('REQ-CYC-005 order and REQ-CYC-006 attempts', () => {
  it('has observations and attempts persisted before alerts run, and the summary after', async () => {
    let seenAtAlertTime = { observations: 0, attempts: 0, runStatus: '' };
    const h = await setup({
      alerts: {
        async handleObservations(events) {
          seenAtAlertTime = {
            observations:
              (await harness?.handle.db.select().from(observations))?.length ??
              -1,
            attempts:
              (await harness?.handle.db.select().from(fetchAttempts))?.length ??
              -1,
            runStatus:
              ((await harness?.handle.db.select().from(runs)) ?? [])[0]
                ?.status ?? '',
          };
          return { notificationsSent: events.length };
        },
      },
    });
    h.adapter.script(URL_A, fakeResult());
    await h.addListing(URL_A);

    const result = await h.cycle.run('cli');

    expect(seenAtAlertTime).toEqual({
      observations: 1,
      attempts: 1,
      runStatus: 'running',
    });
    expect(result).toMatchObject({
      summary: { status: 'completed', notificationsSent: 1 },
    });
    const [run] = await h.handle.db.select().from(runs);
    expect(run).toMatchObject({
      status: 'completed',
      notificationsSent: 1,
      successes: 1,
    });
  });

  it('records every attempt, good or bad, with the run id', async () => {
    const h = await setup();
    h.adapter
      .script(URL_A, fakeResult())
      .script(URL_B, new BlockedError('captcha'));
    await h.addListing(URL_A);
    await h.addListing(URL_B);

    const result = await h.cycle.run('cli');

    const attempts = await h.handle.db.select().from(fetchAttempts);
    expect(attempts.map((a) => a.outcome).sort()).toEqual(['blocked', 'ok']);
    expect(
      attempts.every(
        (a) =>
          a.runId === (result as { summary: { runId: string } }).summary.runId,
      ),
    ).toBe(true);
    expect(attempts.find((a) => a.outcome === 'blocked')?.errorMessage).toBe(
      'captcha',
    );
  });
});

describe('observations', () => {
  it('writes the effective price, never overwrites the listing external id and schedules the next check', async () => {
    const h = await setup();
    h.adapter.script(
      URL_A,
      fakeResult({
        priceCents: 139_900,
        pixPriceCents: 128_708,
        installments: { count: 10, priceCents: 13_990 },
      }),
    );
    await h.addListing(URL_A, { externalId: 'KEEP' });

    await h.cycle.run('cli');

    const [observation] = await h.handle.db.select().from(observations);
    expect(observation).toMatchObject({
      priceCents: 139_900,
      pixPriceCents: 128_708,
      effectivePriceCents: 128_708,
      installmentCount: 10,
      installmentPriceCents: 13_990,
      inStock: true,
      strategy: 'api',
    });
    const row = await listing(h, 'L1');
    expect(row.externalId).toBe('KEEP');
    expect(row.nextCheckAt).toBe(
      new Date(h.clock.now().getTime() + 3 * HOUR).toISOString(),
    );
    expect(h.alerts.batches[0]?.[0]).toMatchObject({
      listingId: 'L1',
      effectivePriceCents: 128_708,
    });
  });

  it('fills the external id from the page when the listing has none', async () => {
    const h = await setup();
    h.adapter.script(URL_A, fakeResult({ externalId: 'MLB1' }));
    await h.addListing(URL_A);
    await h.cycle.run('cli');
    expect((await listing(h, 'L1')).externalId).toBe('MLB1');
  });
});

describe('REQ-SCH-002/003/004 failures, failing status and recovery', () => {
  it('backs off exponentially and marks the listing failing once, at the threshold', async () => {
    const h = await setup({ config: { failingThreshold: 3 } });
    h.adapter.script(URL_A, new BlockedError('blocked'));
    await h.addListing(URL_A);

    for (let failure = 1; failure <= 4; failure++) {
      h.clock.advance(30 * HOUR);
      await h.cycle.run('cli');
      const row = await listing(h, 'L1');
      expect(row.consecutiveFailures).toBe(failure);
      const expectedBackoff = Math.min(
        3 * HOUR * 2 ** (failure - 1),
        24 * HOUR,
      );
      expect(
        new Date(row.nextCheckAt).getTime() - h.clock.now().getTime(),
      ).toBe(expectedBackoff);
    }

    expect((await listing(h, 'L1')).status).toBe('failing');
    expect(h.notifier.sent.map((e) => e.event)).toEqual([
      'system.listing_failing',
    ]);
  });

  it('a success resets failures, restores active and sends a recovery notice', async () => {
    const h = await setup({ config: { failingThreshold: 1 } });
    h.adapter.script(URL_A, new BlockedError('blocked'), fakeResult());
    await h.addListing(URL_A);

    await h.cycle.run('cli');
    expect((await listing(h, 'L1')).status).toBe('failing');
    h.clock.advance(30 * HOUR);
    await h.cycle.run('cli');

    const row = await listing(h, 'L1');
    expect(row).toMatchObject({ status: 'active', consecutiveFailures: 0 });
    expect(h.notifier.sent.map((e) => e.event)).toEqual([
      'system.listing_failing',
      'system.listing_recovered',
    ]);
  });

  it('a failing system notifier does not break the cycle', async () => {
    const h = await setup({ config: { failingThreshold: 1 } });
    h.notifier.fail = true;
    h.adapter.script(URL_A, new BlockedError('blocked'));
    await h.addListing(URL_A);

    const result = await h.cycle.run('cli');

    expect(result).toMatchObject({
      summary: { status: 'completed', failures: 1 },
    });
  });

  it('treats an unknown adapter as a failure without crashing the cycle', async () => {
    const h = await setup();
    await h.addListing(URL_A, { adapterId: 'ghost' });
    const result = await h.cycle.run('cli');
    expect(result).toMatchObject({ summary: { failures: 1 } });
  });
});

describe('REQ-FET-003 strategy_unavailable is not a failure', () => {
  it('writes no observation, does not count a failure and reschedules at the normal interval', async () => {
    const h = await setup({ browser: 'off' });
    h.adapter.strategies = ['browser'];
    await h.addListing(URL_A);

    const result = await h.cycle.run('cli');

    expect(result).toMatchObject({
      summary: { listingsChecked: 1, successes: 0, failures: 0 },
    });
    expect(await h.handle.db.select().from(observations)).toHaveLength(0);
    const row = await listing(h, 'L1');
    expect(row.consecutiveFailures).toBe(0);
    expect(row.nextCheckAt).toBe(
      new Date(h.clock.now().getTime() + 3 * HOUR).toISOString(),
    );
    const [attempt] = await h.handle.db.select().from(fetchAttempts);
    expect(attempt?.outcome).toBe('strategy_unavailable');
  });
});
