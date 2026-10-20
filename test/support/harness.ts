import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { AlertsService } from '../../src/alerts/alerts.service.js';
import type { AlertDelivery } from '../../src/alerts/events.js';
import {
  type DatabaseHandle,
  openDatabase,
  runMigrations,
} from '../../src/db/database.js';
import { listings, products, rules } from '../../src/db/schema.js';
import { FakeAdapter } from '../../src/monitor/adapters/fake.adapter.js';
import { AdapterRegistry } from '../../src/monitor/adapters/registry.js';
import { CollectorService } from '../../src/monitor/collector.service.js';
import {
  type CycleConfig,
  CycleService,
} from '../../src/monitor/cycle.service.js';
import type {
  AlertsPort,
  PageFetcher,
  SystemNotifier,
} from '../../src/monitor/ports.js';
import { RunLockService } from '../../src/monitor/run-lock.service.js';
import { SchedulerService } from '../../src/monitor/scheduler.service.js';
import {
  FakeClock,
  FakeDelivery,
  FakeNotifier,
  RecordingAlerts,
} from './fakes.js';

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
  delivery: FakeDelivery;
  addRule(
    productId: string,
    type: 'target_price' | 'new_low' | 'back_in_stock',
    params: unknown,
    overrides?: Partial<typeof rules.$inferInsert>,
  ): Promise<string>;
  makeDue(listingId: string): Promise<void>;
  ruleState(ruleId: string): Promise<unknown>;
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
    /** Wire the real AlertsService with a FakeDelivery instead of the recording stub. */
    realAlerts?: boolean;
    /** Replace the FakeDelivery / FakeNotifier with real implementations (they get the harness db and clock). */
    buildDelivery?: (ctx: {
      db: DatabaseHandle['db'];
      clock: FakeClock;
    }) => AlertDelivery & SystemNotifier;
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

  const delivery = new FakeDelivery();
  const real = options.buildDelivery?.({ db: handle.db, clock });
  const realAlerts = new AlertsService({
    db: handle.db,
    registry,
    delivery: real ?? delivery,
    config: { alertCooldownMs: 12 * HOUR },
  });

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
    alerts:
      options.alerts ?? (options.realAlerts || real ? realAlerts : alerts),
    notifier: real ?? notifier,
    config: { ...defaultCycleConfig, ...options.config },
  });

  let listingSeq = 0;
  let ruleSeq = 0;
  return {
    handle,
    clock,
    adapter,
    registry,
    notifier,
    alerts,
    locks,
    cycle,
    delivery,
    async addRule(productId, type, params, overrides = {}) {
      ruleSeq++;
      const now = clock.now().toISOString();
      const id = `R${ruleSeq}`;
      await handle.db.insert(rules).values({
        id,
        productId,
        type,
        params,
        channels: [],
        cooldownMinutes: 720,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      });
      return id;
    },
    async makeDue(listingId) {
      await handle.db
        .update(listings)
        .set({ nextCheckAt: clock.now().toISOString() })
        .where(eq(listings.id, listingId));
    },
    async ruleState(ruleId) {
      const [row] = await handle.db
        .select()
        .from(rules)
        .where(eq(rules.id, ruleId));
      return row?.state;
    },
    async addListing(url, overrides = {}) {
      listingSeq++;
      const now = clock.now().toISOString();
      const productId = overrides.productId ?? `P${listingSeq}`;
      if (!overrides.productId) {
        await handle.db.insert(products).values({
          id: productId,
          name: `Product ${listingSeq}`,
          createdAt: now,
          updatedAt: now,
        });
      }
      await handle.db.insert(listings).values({
        id: `L${listingSeq}`,
        productId,
        adapterId: adapter.id,
        url,
        nextCheckAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      });
      return `L${listingSeq}`;
    },
    async archiveProduct(productId) {
      await handle.db
        .update(products)
        .set({ archivedAt: clock.now().toISOString() })
        .where(eq(products.id, productId));
    },
  };
}
