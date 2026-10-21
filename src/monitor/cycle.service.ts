import { and, asc, eq, inArray, isNull, lt, lte } from 'drizzle-orm';
import type { Clock } from '../common/clock.js';
import { newId } from '../common/ids.js';
import type { Database } from '../db/database.js';
import {
  fetchAttempts,
  listings,
  notifications,
  observations,
  products,
  runs,
} from '../db/schema.js';
import type { AdapterRegistry } from './adapters/registry.js';
import type { CollectorService, CollectResult } from './collector.service.js';
import type { AlertsPort, ObservedEvent, SystemNotifier } from './ports.js';
import { effectivePriceCents } from './price.js';
import type { RunLockService } from './run-lock.service.js';
import type { SchedulerService } from './scheduler.service.js';

export interface CycleConfig {
  runTimeoutMs: number;
  runMaxListings: number;
  concurrency: number;
  domainDelayMs: number;
  failingThreshold: number;
  /** REQ-DB-006: age limit for `fetch_attempts` and `notifications`; omitted = keep everything. */
  retentionMs?: number;
}

export type RunTrigger = 'ticker' | 'cli' | 'api';

export interface RunSummary {
  runId: string;
  status: 'completed' | 'timed_out' | 'failed';
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string;
  listingsDue: number;
  listingsChecked: number;
  successes: number;
  failures: number;
  notificationsSent: number;
}

export type CycleResult =
  | { lockBusy: true }
  | { lockBusy: false; summary: RunSummary };

type ListingRow = typeof listings.$inferSelect;

export interface ProcessedListing {
  outcome: 'success' | 'failure' | 'unavailable';
  collected: CollectResult;
}

const LOCK_MARGIN_MS = 60_000;

export interface CycleDeps {
  db: Database;
  clock: Clock;
  locks: RunLockService;
  registry: AdapterRegistry;
  collector: CollectorService;
  scheduler: SchedulerService;
  alerts: AlertsPort;
  notifier: SystemNotifier;
  config: CycleConfig;
}

/**
 * One cycle, in order (REQ-CYC-005): acquire lock → collect due listings →
 * evaluate rules → deliver notifications → write summary → release lock.
 */
export class CycleService {
  constructor(private readonly deps: CycleDeps) {}

  async run(trigger: RunTrigger, signal?: AbortSignal): Promise<CycleResult> {
    const { clock, locks, config } = this.deps;
    const holder = newId();
    const startedAt = clock.now();

    if (
      !(await locks.acquire(
        holder,
        startedAt,
        config.runTimeoutMs + LOCK_MARGIN_MS,
      ))
    ) {
      return { lockBusy: true };
    }

    const runId = newId();
    try {
      await this.deps.db.insert(runs).values({
        id: runId,
        trigger,
        startedAt: startedAt.toISOString(),
        status: 'running',
      });
      const summary = await this.execute(runId, trigger, startedAt, signal);
      await this.prune();
      return { lockBusy: false, summary };
    } catch (error) {
      await this.deps.db
        .update(runs)
        .set({ status: 'failed', finishedAt: clock.now().toISOString() })
        .where(eq(runs.id, runId));
      throw error;
    } finally {
      await locks.release(holder);
    }
  }

  private async execute(
    runId: string,
    trigger: RunTrigger,
    startedAt: Date,
    signal?: AbortSignal,
  ): Promise<RunSummary> {
    const { db, clock, config } = this.deps;
    const due = await this.selectDue(startedAt);
    const events: ObservedEvent[] = [];
    const counts = { checked: 0, successes: 0, failures: 0 };
    const domains = new DomainLimiter(clock, config.domainDelayMs);
    let timedOut = false;
    let aborted = false;

    let next = 0;
    const worker = async () => {
      while (next < due.length) {
        if (signal?.aborted) {
          aborted = true;
          return;
        }
        if (
          clock.now().getTime() - startedAt.getTime() >=
          config.runTimeoutMs
        ) {
          timedOut = true;
          return;
        }
        const listing = due[next++] as ListingRow;
        await domains.waitTurn(hostOf(listing.url));
        counts.checked++;
        const { outcome } = await this.processListing(runId, listing, events);
        if (outcome === 'success') counts.successes++;
        else if (outcome === 'failure') counts.failures++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(config.concurrency, 1) }, worker),
    );

    // Evaluation and delivery still happen for what was collected, even on timeout (REQ-CYC-004).
    const { notificationsSent } = await this.deps.alerts.handleObservations(
      events,
      clock.now(),
    );

    const finishedAt = clock.now().toISOString();
    const status = aborted ? 'failed' : timedOut ? 'timed_out' : 'completed';
    await db
      .update(runs)
      .set({
        status,
        finishedAt,
        listingsDue: due.length,
        listingsChecked: counts.checked,
        successes: counts.successes,
        failures: counts.failures,
        notificationsSent,
      })
      .where(eq(runs.id, runId));

    return {
      runId,
      status,
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt,
      listingsDue: due.length,
      listingsChecked: counts.checked,
      successes: counts.successes,
      failures: counts.failures,
      notificationsSent,
    };
  }

  /** REQ-DB-006: observations are never pruned (they back `new_low`). */
  private async prune(): Promise<void> {
    const { db, clock, config } = this.deps;
    if (config.retentionMs === undefined) return;
    const cutoff = new Date(clock.now().getTime() - config.retentionMs);
    const before = cutoff.toISOString();
    try {
      await db.delete(fetchAttempts).where(lt(fetchAttempts.startedAt, before));
      await db.delete(notifications).where(lt(notifications.createdAt, before));
    } catch {
      // Housekeeping is best effort: a completed cycle must not turn into a failed one.
    }
  }

  /** REQ-CYC-002: active/failing listings of non-archived products, oldest due first. */
  private async selectDue(now: Date): Promise<ListingRow[]> {
    const rows = await this.deps.db
      .select({ listing: listings })
      .from(listings)
      .innerJoin(products, eq(products.id, listings.productId))
      .where(
        and(
          inArray(listings.status, ['active', 'failing']),
          lte(listings.nextCheckAt, now.toISOString()),
          isNull(products.archivedAt),
        ),
      )
      .orderBy(asc(listings.nextCheckAt))
      .limit(this.deps.config.runMaxListings);
    return rows.map((row) => row.listing);
  }

  private async processListing(
    runId: string | null,
    listing: ListingRow,
    events: ObservedEvent[],
  ): Promise<ProcessedListing> {
    const { db, clock, registry, collector, scheduler, config } = this.deps;
    const adapter = registry.get(listing.adapterId);
    const checkedAt = clock.now().toISOString();

    const collected: CollectResult = adapter
      ? await collector.collect(adapter, new URL(listing.url))
      : {
          outcome: 'parse_error',
          reason: `unknown adapter "${listing.adapterId}"`,
          attempts: [],
        };

    for (const attempt of collected.attempts) {
      await db.insert(fetchAttempts).values({
        id: newId(),
        listingId: listing.id,
        runId,
        startedAt: attempt.startedAt,
        durationMs: attempt.durationMs,
        strategy: attempt.strategy,
        outcome: attempt.outcome,
        httpStatus: attempt.httpStatus,
        errorMessage: attempt.errorMessage,
      });
    }

    if (collected.outcome === 'ok') {
      const { result } = collected;
      const observationId = newId();
      const effective = effectivePriceCents(
        result.priceCents,
        result.pixPriceCents,
      );
      await db.insert(observations).values({
        id: observationId,
        listingId: listing.id,
        observedAt: checkedAt,
        priceCents: result.priceCents,
        pixPriceCents: result.pixPriceCents,
        effectivePriceCents: effective,
        installmentCount: result.installments?.count ?? null,
        installmentPriceCents: result.installments?.priceCents ?? null,
        inStock: result.inStock,
        seller: result.seller,
        title: result.title,
        strategy: collected.strategy,
      });
      await db
        .update(listings)
        .set({
          status: 'active',
          consecutiveFailures: 0,
          lastCheckedAt: checkedAt,
          lastSuccessAt: checkedAt,
          externalId: listing.externalId ?? result.externalId,
          nextCheckAt: scheduler.nextAfterSuccess(listing.checkIntervalMinutes),
          updatedAt: checkedAt,
        })
        .where(eq(listings.id, listing.id));

      events.push({
        observationId,
        listingId: listing.id,
        productId: listing.productId,
        observedAt: checkedAt,
        priceCents: result.priceCents,
        pixPriceCents: result.pixPriceCents,
        effectivePriceCents: effective,
        inStock: result.inStock,
      });

      if (listing.status === 'failing') {
        await this.notifySystem(
          'system.listing_recovered',
          listing,
          'listing is being read again',
        );
      }
      return { outcome: 'success', collected };
    }

    if (collected.outcome === 'strategy_unavailable') {
      // Not a failure (REQ-FET-003): no observation, normal interval.
      await db
        .update(listings)
        .set({
          lastCheckedAt: checkedAt,
          nextCheckAt: scheduler.nextAfterSuccess(listing.checkIntervalMinutes),
          updatedAt: checkedAt,
        })
        .where(eq(listings.id, listing.id));
      return { outcome: 'unavailable', collected };
    }

    const failures = listing.consecutiveFailures + 1;
    const becomesFailing =
      failures >= config.failingThreshold && listing.status !== 'failing';
    await db
      .update(listings)
      .set({
        consecutiveFailures: failures,
        status: becomesFailing ? 'failing' : listing.status,
        lastCheckedAt: checkedAt,
        nextCheckAt: scheduler.nextAfterFailure(
          listing.checkIntervalMinutes,
          failures,
        ),
        updatedAt: checkedAt,
      })
      .where(eq(listings.id, listing.id));
    if (becomesFailing) {
      await this.notifySystem(
        'system.listing_failing',
        listing,
        `${collected.outcome}: ${collected.reason}`,
      );
    }
    return { outcome: 'failure', collected };
  }

  /**
   * One immediate check outside a cycle (REQ-API-011 probe): same persistence, backoff and
   * `price.observed` handling as a scheduled check, with no run and no lock.
   */
  async checkNow(listing: ListingRow): Promise<ProcessedListing> {
    const events: ObservedEvent[] = [];
    const processed = await this.processListing(null, listing, events);
    await this.deps.alerts.handleObservations(events, this.deps.clock.now());
    return processed;
  }

  /** A system notice that cannot be delivered must not break the cycle. */
  private async notifySystem(
    event: 'system.listing_failing' | 'system.listing_recovered',
    listing: ListingRow,
    reason: string,
  ): Promise<void> {
    try {
      await this.deps.notifier.send({
        event,
        listingId: listing.id,
        url: listing.url,
        reason,
      });
    } catch {
      // Delivery bookkeeping belongs to the notifier (step 5).
    }
  }
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

/** Keeps at least `delayMs` between requests to the same domain (REQ-CYC-003). */
class DomainLimiter {
  private readonly nextSlot = new Map<string, number>();

  constructor(
    private readonly clock: Clock,
    private readonly delayMs: number,
  ) {}

  async waitTurn(host: string): Promise<void> {
    const now = this.clock.now().getTime();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.delayMs);
    if (slot > now) await this.clock.sleep(slot - now);
  }
}
