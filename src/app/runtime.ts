import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AlertsService } from '../alerts/alerts.service.js';
import type { ApiDeps } from '../api/deps.js';
import { SystemClock } from '../common/clock.js';
import type { Config } from '../config/config.js';
import { openDatabase, runMigrations } from '../db/database.js';
import { AdapterRegistry } from '../monitor/adapters/registry.js';
import { builtinAdapters } from '../monitor/adapters/stores/index.js';
import { CollectorService } from '../monitor/collector.service.js';
import { CycleService } from '../monitor/cycle.service.js';
import { FixturesFetcher } from '../monitor/fixtures.fetcher.js';
import { HttpFetcher } from '../monitor/http.fetcher.js';
import { RunLockService } from '../monitor/run-lock.service.js';
import { SchedulerService } from '../monitor/scheduler.service.js';
import { createNotificationService } from '../notifications/factory.js';

export interface Runtime {
  apiDeps: ApiDeps;
  cycle: CycleService;
  close(): void;
}

/** The image runs from the project root, where package.json lives. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const version = readVersion();

/** Wires every service from the validated config (REQ-DB-005: migrates first when enabled). */
export async function buildRuntime(config: Config): Promise<Runtime> {
  const handle = await openDatabase({
    url: config.databaseUrl,
    authToken: config.databaseToken,
  });
  try {
    if (config.autoMigrate) await runMigrations(handle.db);

    const clock = new SystemClock();
    const registry = new AdapterRegistry(builtinAdapters(config));
    // REQ-DX-009: development only, no network.
    const fetcher = config.fetchFixturesDir
      ? new FixturesFetcher(config.fetchFixturesDir, (url) => {
          const adapter = registry.resolve(url);
          return (adapter ? adapter.normalizeUrl(url) : url).toString();
        })
      : new HttpFetcher({
          userAgent: config.userAgent,
          timeoutMs: config.httpTimeoutMs,
        });
    const collector = new CollectorService(clock, fetcher, {
      browser: config.browser,
    });
    const scheduler = new SchedulerService(clock, {
      scrapeIntervalMs: config.scrapeIntervalMs,
      scrapeJitterMs: config.scrapeJitterMs,
      maxBackoffMs: config.maxBackoffMs,
    });
    const notifications = createNotificationService({
      db: handle.db,
      clock,
      channels: config.channels,
      defaultChannels: config.defaultChannels,
      systemChannels: config.systemChannels,
    });
    const cycle = new CycleService({
      db: handle.db,
      clock,
      locks: new RunLockService(handle.client),
      registry,
      collector,
      scheduler,
      alerts: new AlertsService({
        db: handle.db,
        registry,
        delivery: notifications,
        config: { alertCooldownMs: config.alertCooldownMs },
      }),
      notifier: notifications,
      config: {
        runTimeoutMs: config.runTimeoutMs,
        runMaxListings: config.runMaxListings,
        concurrency: config.concurrency,
        domainDelayMs: config.domainDelayMs,
        failingThreshold: config.failingThreshold,
        retentionMs: config.retentionDays * 86_400_000,
      },
    });

    return {
      cycle,
      close: () => handle.close(),
      apiDeps: {
        db: handle.db,
        clock,
        registry,
        collector,
        scheduler,
        cycle,
        notifications,
        channels: config.channels,
        apiToken: config.apiToken,
        runToken: config.runToken,
        version,
        browserAvailable: config.browser !== 'off',
      },
    };
  } catch (error) {
    handle.close();
    throw error;
  }
}
