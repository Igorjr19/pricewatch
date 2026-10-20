import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  type DatabaseHandle,
  openDatabase,
  runMigrations,
} from '../../src/db/database.js';
import { listings, products } from '../../src/db/schema.js';
import { FakeAdapter } from '../../src/monitor/adapters/fake.adapter.js';
import { AdapterRegistry } from '../../src/monitor/adapters/registry.js';
import { CollectorService } from '../../src/monitor/collector.service.js';
import {
  type CycleConfig,
  CycleService,
} from '../../src/monitor/cycle.service.js';
import type { AlertsPort, PageFetcher } from '../../src/monitor/ports.js';
import { RunLockService } from '../../src/monitor/run-lock.service.js';
import { SchedulerService } from '../../src/monitor/scheduler.service.js';
import { FakeClock, FakeNotifier, RecordingAlerts } from './fakes.js';

export const HOUR = 3_600_000;
export const MIN = 60_000;

export const defaultCycleConfig: CycleConfig = {
  runTimeoutMs: 10 * MIN,
  runMaxListings: 50,
  concurrency: 1,
  domainDelayMs: 8_000,
  failingThreshold: 5,
};

export interface Harness {
  handle: DatabaseHandle;
  clock: FakeClock;
  adapter: FakeAdapter;
  registry: AdapterRegistry;
  notifier: FakeNotifier;
  alerts: AlertsPort & RecordingAlerts;
  locks: RunLockService;
  cycle: CycleService;
  addListing(
    url: string,
    overrides?: Partial<typeof listings.$inferInsert>,
  ): Promise<string>;
  archiveProduct(productId: string): Promise<void>;
}

export async function makeHarness(
  options: {
    config?: Partial<CycleConfig>;
    adapter?: FakeAdapter;
    fetcher?: PageFetcher;
    alerts?: AlertsPort;
    browser?: string;
  } = {},
): Promise<Harness> {
  const handle = await openDatabase({ url: 'file::memory:' });
  await runMigrations(handle.db, resolve('drizzle'));

  const clock = new FakeClock();
  const adapter = options.adapter ?? new FakeAdapter();
  const registry = new AdapterRegistry([adapter]);
  const notifier = new FakeNotifier();
  const alerts = new RecordingAlerts();
  const locks = new RunLockService(handle.client);
  const fetcher: PageFetcher =
    options.fetcher ??
    ({
      async fetch() {
        throw new Error('no fetcher configured');
      },
    } satisfies PageFetcher);

  const cycle = new CycleService({
    db: handle.db,
    clock,
    locks,
    registry,
    collector: new CollectorService(clock, fetcher, {
      browser: options.browser ?? 'off',
    }),
    scheduler: new SchedulerService(
      clock,
      {
        scrapeIntervalMs: 3 * HOUR,
        scrapeJitterMs: 20 * MIN,
        maxBackoffMs: 24 * HOUR,
      },
      () => 0.5,
    ),
    alerts: options.alerts ?? alerts,
    notifier,
    config: { ...defaultCycleConfig, ...options.config },
  });

  let sequence = 0;
  return {
    handle,
    clock,
    adapter,
    registry,
    notifier,
    alerts,
    locks,
    cycle,
    async addListing(url, overrides = {}) {
      sequence++;
      const now = clock.now().toISOString();
      const productId = `P${sequence}`;
      await handle.db.insert(products).values({
        id: productId,
        name: `Product ${sequence}`,
        createdAt: now,
        updatedAt: now,
      });
      await handle.db.insert(listings).values({
        id: `L${sequence}`,
        productId,
        adapterId: adapter.id,
        url,
        nextCheckAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      });
      return `L${sequence}`;
    },
    async archiveProduct(productId) {
      await handle.db
        .update(products)
        .set({ archivedAt: clock.now().toISOString() })
        .where(eq(products.id, productId));
    },
  };
}
