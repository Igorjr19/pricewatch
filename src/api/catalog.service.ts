import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm';
import { parseRuleParams, type RuleType } from '../alerts/params.js';
import { newId } from '../common/ids.js';
import {
  fetchAttempts,
  listings,
  notifications,
  observations,
  products,
  rules,
  runs,
} from '../db/schema.js';
import { effectivePriceCents } from '../monitor/price.js';
import { describeChannel } from '../notifications/channel-parser.js';
import { API_DEPS, type ApiDeps } from './deps.js';
import type {
  CreateListingBody,
  CreateProductBody,
  CreateRuleBody,
  UpdateListingBody,
  UpdateProductBody,
  UpdateRuleBody,
} from './dto.js';
import { ApiError } from './errors.js';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

type ListingRow = typeof listings.$inferSelect;
type ObservationRow = typeof observations.$inferSelect;

function limitOf(limit?: number): number {
  return limit ?? DEFAULT_LIMIT;
}

/** Fetches `limit + 1` rows (newest id first) and cuts the page (REQ-API-004). */
function paginate<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor:
      rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
  };
}

@Injectable()
export class CatalogService {
  constructor(@Inject(API_DEPS) private readonly deps: ApiDeps) {}

  private get db() {
    return this.deps.db;
  }

  private now(): string {
    return this.deps.clock.now().toISOString();
  }

  // ---- products -----------------------------------------------------------

  async listProducts(query: { limit?: number; cursor?: string }) {
    const limit = limitOf(query.limit);
    const rows = await this.db
      .select()
      .from(products)
      .where(query.cursor ? lt(products.id, query.cursor) : undefined)
      .orderBy(desc(products.id))
      .limit(limit + 1);
    const page = paginate(rows, limit);
    const summaries = await this.summaries(page.items.map((p) => p.id));
    return {
      items: page.items.map((product) => ({
        ...product,
        ...(summaries.get(product.id) ?? emptySummary()),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async createProduct(body: CreateProductBody) {
    const now = this.now();
    const row = {
      id: newId(),
      name: body.name,
      notes: body.notes ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(products).values(row);
    return row;
  }

  async getProduct(id: string) {
    const product = await this.requireProduct(id);
    const listingRows = await this.db
      .select()
      .from(listings)
      .where(eq(listings.productId, id))
      .orderBy(asc(listings.id));
    const latest = await this.latestObservations(listingRows.map((l) => l.id));
    const ruleRows = await this.db
      .select()
      .from(rules)
      .where(eq(rules.productId, id))
      .orderBy(asc(rules.id));
    const summary = (await this.summaries([id])).get(id) ?? emptySummary();
    return {
      ...product,
      ...summary,
      listings: listingRows.map((listing) => ({
        ...listing,
        lastObservation: latest.get(listing.id) ?? null,
      })),
      rules: ruleRows,
    };
  }

  async updateProduct(id: string, body: UpdateProductBody) {
    const product = await this.requireProduct(id);
    const now = this.now();
    const patch: Partial<typeof products.$inferInsert> = { updatedAt: now };
    if (body.name !== undefined) patch.name = body.name;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.archived !== undefined) {
      patch.archivedAt = body.archived ? (product.archivedAt ?? now) : null;
    }
    await this.db.update(products).set(patch).where(eq(products.id, id));
    return this.requireProduct(id);
  }

  async deleteProduct(id: string, confirm: boolean): Promise<void> {
    await this.requireProduct(id);
    if (!confirm) {
      throw new ApiError(
        400,
        'confirmation_required',
        'Deleting a product removes its listings, observations and rules; pass ?confirm=true',
      );
    }
    await this.db.transaction(async (tx) => {
      const ids = (
        await tx
          .select({ id: listings.id })
          .from(listings)
          .where(eq(listings.productId, id))
      ).map((l) => l.id);
      if (ids.length > 0) {
        await tx
          .update(notifications)
          .set({ listingId: null, observationId: null })
          .where(inArray(notifications.listingId, ids));
        await tx
          .delete(fetchAttempts)
          .where(inArray(fetchAttempts.listingId, ids));
        await tx
          .delete(observations)
          .where(inArray(observations.listingId, ids));
        await tx.delete(listings).where(inArray(listings.id, ids));
      }
      await tx
        .update(notifications)
        .set({ ruleId: null })
        .where(
          inArray(
            notifications.ruleId,
            tx
              .select({ id: rules.id })
              .from(rules)
              .where(eq(rules.productId, id)),
          ),
        );
      await tx.delete(rules).where(eq(rules.productId, id));
      await tx.delete(products).where(eq(products.id, id));
    });
  }

  /** Best price among in-stock, healthy listings; lowest ever among in-stock observations. */
  private async summaries(productIds: string[]) {
    const result = new Map<string, ReturnType<typeof emptySummary>>();
    if (productIds.length === 0) return result;
    const listingRows = await this.db
      .select()
      .from(listings)
      .where(inArray(listings.productId, productIds));
    const latest = await this.latestObservations(listingRows.map((l) => l.id));
    const lowest = await this.lowestEver(listingRows.map((l) => l.id));
    const byListing = new Map(listingRows.map((l) => [l.id, l]));

    for (const id of productIds) result.set(id, emptySummary());
    for (const [listingId, observation] of latest) {
      const listing = byListing.get(listingId) as ListingRow;
      const summary = result.get(listing.productId);
      const price = observation.effectivePriceCents;
      if (
        !summary ||
        price === null ||
        !observation.inStock ||
        listing.status !== 'active'
      ) {
        continue;
      }
      if (
        summary.bestEffectivePriceCents === null ||
        price < summary.bestEffectivePriceCents
      ) {
        summary.bestEffectivePriceCents = price;
        summary.bestListingId = listingId;
      }
    }
    for (const [listingId, cents] of lowest) {
      const summary = result.get(
        (byListing.get(listingId) as ListingRow).productId,
      );
      if (
        summary &&
        (summary.lowestEverCents === null || cents < summary.lowestEverCents)
      ) {
        summary.lowestEverCents = cents;
      }
    }
    return result;
  }

  private async latestObservations(listingIds: string[]) {
    const latest = new Map<string, ObservationRow>();
    if (listingIds.length === 0) return latest;
    const rows = await this.db
      .select()
      .from(observations)
      .where(
        and(
          inArray(observations.listingId, listingIds),
          sql`${observations.observedAt} = (select max(o2.observed_at) from observations o2 where o2.listing_id = ${observations.listingId})`,
        ),
      )
      .orderBy(asc(observations.id));
    for (const row of rows) latest.set(row.listingId, row);
    return latest;
  }

  private async lowestEver(listingIds: string[]) {
    const lowest = new Map<string, number>();
    if (listingIds.length === 0) return lowest;
    const rows = await this.db
      .select({
        listingId: observations.listingId,
        cents: sql<number>`min(${observations.effectivePriceCents})`,
      })
      .from(observations)
      .where(
        and(
          inArray(observations.listingId, listingIds),
          eq(observations.inStock, true),
          isNotNull(observations.effectivePriceCents),
        ),
      )
      .groupBy(observations.listingId);
    for (const row of rows) lowest.set(row.listingId, row.cents);
    return lowest;
  }

  // ---- listings -----------------------------------------------------------

  async createListing(
    productId: string,
    body: CreateListingBody,
    probe: boolean,
  ) {
    await this.requireProduct(productId);
    const { adapter, url } = this.resolveUrl(body.url);
    const [duplicate] = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.url, url.toString()));
    if (duplicate) {
      throw new ApiError(
        409,
        'duplicate_listing',
        'A listing with this URL already exists',
        { listingId: duplicate.id },
      );
    }
    const now = this.now();
    const id = newId();
    await this.db.insert(listings).values({
      id,
      productId,
      adapterId: adapter.id,
      url: url.toString(),
      checkIntervalMinutes: body.checkIntervalMinutes ?? null,
      nextCheckAt: now,
      createdAt: now,
      updatedAt: now,
    });

    let probeResult: unknown;
    if (probe) probeResult = await this.probeListing(id);
    const [listing] = await this.db
      .select()
      .from(listings)
      .where(eq(listings.id, id));
    return { listing: listing as ListingRow, probe: probeResult };
  }

  /** REQ-API-011: one immediate extraction that persists the first observation and its attempts. */
  private async probeListing(listingId: string) {
    const [listing] = await this.db
      .select()
      .from(listings)
      .where(eq(listings.id, listingId));
    const row = listing as ListingRow;
    const adapter = this.deps.registry.get(row.adapterId);
    if (!adapter) return null;
    const collected = await this.deps.collector.collect(
      adapter,
      new URL(row.url),
    );
    for (const attempt of collected.attempts) {
      await this.db.insert(fetchAttempts).values({
        id: newId(),
        listingId,
        runId: null,
        startedAt: attempt.startedAt,
        durationMs: attempt.durationMs,
        strategy: attempt.strategy,
        outcome: attempt.outcome,
        httpStatus: attempt.httpStatus,
        errorMessage: attempt.errorMessage,
      });
    }
    if (collected.outcome !== 'ok') {
      return { outcome: collected.outcome, reason: collected.reason };
    }
    const { result } = collected;
    const now = this.now();
    await this.db.insert(observations).values({
      id: newId(),
      listingId,
      observedAt: now,
      priceCents: result.priceCents,
      pixPriceCents: result.pixPriceCents,
      effectivePriceCents: effectivePriceCents(
        result.priceCents,
        result.pixPriceCents,
      ),
      installmentCount: result.installments?.count ?? null,
      installmentPriceCents: result.installments?.priceCents ?? null,
      inStock: result.inStock,
      seller: result.seller,
      title: result.title,
      strategy: collected.strategy,
    });
    await this.db
      .update(listings)
      .set({
        lastCheckedAt: now,
        lastSuccessAt: now,
        externalId: result.externalId,
        nextCheckAt: this.deps.scheduler.nextAfterSuccess(
          row.checkIntervalMinutes,
        ),
        updatedAt: now,
      })
      .where(eq(listings.id, listingId));
    return { outcome: 'ok' as const, strategy: collected.strategy, result };
  }

  async updateListing(id: string, body: UpdateListingBody) {
    const listing = await this.requireListing(id);
    const now = this.now();
    const patch: Partial<typeof listings.$inferInsert> = { updatedAt: now };
    if (body.checkIntervalMinutes !== undefined) {
      patch.checkIntervalMinutes = body.checkIntervalMinutes;
      // The new interval applies now, not after the old (possibly distant) due time.
      if (listing.status !== 'paused' && body.status !== 'paused') {
        patch.nextCheckAt = now;
      }
    }
    if (body.status !== undefined) {
      patch.status = body.status;
      if (body.status === 'active') {
        patch.consecutiveFailures = 0;
        patch.nextCheckAt = now;
      }
    }
    await this.db.update(listings).set(patch).where(eq(listings.id, id));
    return this.requireListing(listing.id);
  }

  async deleteListing(id: string): Promise<void> {
    await this.requireListing(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(notifications)
        .set({ listingId: null, observationId: null })
        .where(eq(notifications.listingId, id));
      await tx.delete(fetchAttempts).where(eq(fetchAttempts.listingId, id));
      await tx.delete(observations).where(eq(observations.listingId, id));
      await tx.delete(listings).where(eq(listings.id, id));
    });
  }

  async checkListing(id: string) {
    await this.requireListing(id);
    await this.db
      .update(listings)
      .set({ nextCheckAt: this.now(), updatedAt: this.now() })
      .where(eq(listings.id, id));
    return this.requireListing(id);
  }

  async observations(
    id: string,
    query: { from?: string; to?: string; limit?: number; cursor?: string },
  ) {
    await this.requireListing(id);
    const limit = limitOf(query.limit);
    const rows = await this.db
      .select()
      .from(observations)
      .where(
        and(
          eq(observations.listingId, id),
          query.from ? gte(observations.observedAt, query.from) : undefined,
          query.to ? lte(observations.observedAt, query.to) : undefined,
          query.cursor ? lt(observations.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(observations.id))
      .limit(limit + 1);
    return paginate(rows, limit);
  }

  async attempts(id: string, query: { limit?: number; cursor?: string }) {
    await this.requireListing(id);
    const limit = limitOf(query.limit);
    const rows = await this.db
      .select()
      .from(fetchAttempts)
      .where(
        and(
          eq(fetchAttempts.listingId, id),
          query.cursor ? lt(fetchAttempts.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(fetchAttempts.id))
      .limit(limit + 1);
    return paginate(rows, limit);
  }

  /** Per listing and per UTC day: min, max and last effective price. */
  async history(productId: string, query: { from?: string; to?: string }) {
    await this.requireProduct(productId);
    const listingIds = (
      await this.db
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.productId, productId))
    ).map((l) => l.id);
    if (listingIds.length === 0) return { bucket: 'day', items: [] };
    const rows = await this.db
      .select()
      .from(observations)
      .where(
        and(
          inArray(observations.listingId, listingIds),
          isNotNull(observations.effectivePriceCents),
          query.from ? gte(observations.observedAt, query.from) : undefined,
          query.to ? lte(observations.observedAt, query.to) : undefined,
        ),
      )
      .orderBy(asc(observations.observedAt));
    const buckets = new Map<
      string,
      {
        listingId: string;
        day: string;
        minEffectivePriceCents: number;
        maxEffectivePriceCents: number;
        lastEffectivePriceCents: number;
      }
    >();
    for (const row of rows) {
      const price = row.effectivePriceCents as number;
      const day = row.observedAt.slice(0, 10);
      const key = `${row.listingId}|${day}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.minEffectivePriceCents = Math.min(
          bucket.minEffectivePriceCents,
          price,
        );
        bucket.maxEffectivePriceCents = Math.max(
          bucket.maxEffectivePriceCents,
          price,
        );
        bucket.lastEffectivePriceCents = price;
      } else {
        buckets.set(key, {
          listingId: row.listingId,
          day,
          minEffectivePriceCents: price,
          maxEffectivePriceCents: price,
          lastEffectivePriceCents: price,
        });
      }
    }
    return { bucket: 'day', items: [...buckets.values()] };
  }

  // ---- rules --------------------------------------------------------------

  async listRules(productId: string) {
    await this.requireProduct(productId);
    return {
      items: await this.db
        .select()
        .from(rules)
        .where(eq(rules.productId, productId))
        .orderBy(asc(rules.id)),
    };
  }

  async createRule(productId: string, body: CreateRuleBody) {
    await this.requireProduct(productId);
    const params = this.validateParams(body.type, body.params);
    const channels = this.validateChannels(body.channels ?? []);
    const now = this.now();
    const row = {
      id: newId(),
      productId,
      type: body.type,
      params,
      channels,
      enabled: body.enabled ?? true,
      cooldownMinutes: body.cooldownMinutes ?? null,
      state: null,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(rules).values(row);
    return row;
  }

  async updateRule(id: string, body: UpdateRuleBody) {
    const rule = await this.requireRule(id);
    const patch: Partial<typeof rules.$inferInsert> = {
      updatedAt: this.now(),
    };
    if (body.params !== undefined) {
      patch.params = this.validateParams(rule.type, body.params);
      // Changing params re-arms the rule (spec 10.1).
      patch.state = null;
    }
    if (body.channels !== undefined) {
      patch.channels = this.validateChannels(body.channels);
    }
    if (body.cooldownMinutes !== undefined) {
      patch.cooldownMinutes = body.cooldownMinutes;
    }
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    await this.db.update(rules).set(patch).where(eq(rules.id, id));
    return this.requireRule(id);
  }

  async deleteRule(id: string): Promise<void> {
    await this.requireRule(id);
    await this.db
      .update(notifications)
      .set({ ruleId: null })
      .where(eq(notifications.ruleId, id));
    await this.db.delete(rules).where(eq(rules.id, id));
  }

  /** REQ-ALR-002: invalid params are a semantic error, not a malformed body. */
  private validateParams(type: RuleType, params: unknown): unknown {
    const parsed = parseRuleParams(type, params);
    if (!parsed.ok) {
      throw new ApiError(422, 'invalid_params', parsed.error, {
        field: 'params',
      });
    }
    return parsed.params;
  }

  /** REQ-NOT-002: a rule may only reference configured channels. */
  private validateChannels(names: string[]): string[] {
    const known = new Set(this.deps.channels.map((c) => c.name));
    const lower = [...new Set(names.map((n) => n.toLowerCase()))];
    const unknown = lower.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      throw new ApiError(
        422,
        'unknown_channel',
        `Unknown channel: ${unknown.join(', ')}`,
        { unknown, configured: [...known] },
      );
    }
    return lower;
  }

  // ---- stores, probe ------------------------------------------------------

  adapters() {
    return {
      items: this.deps.registry.list().map((adapter) => ({
        id: adapter.id,
        name: adapter.displayName,
        domains: adapter.domains,
        strategies: adapter.strategies,
        browserAvailable: this.deps.browserAvailable,
      })),
    };
  }

  /** Normalizes and extracts without persisting anything. */
  async probe(rawUrl: string) {
    const { adapter, url } = this.resolveUrl(rawUrl);
    const collected = await this.deps.collector.collect(adapter, url);
    return {
      adapter: adapter.id,
      url: url.toString(),
      ...(collected.outcome === 'ok'
        ? {
            outcome: 'ok' as const,
            strategy: collected.strategy,
            result: collected.result,
          }
        : { outcome: collected.outcome, reason: collected.reason }),
    };
  }

  /** REQ-ADP-001 / REQ-API-010: parse, resolve the adapter by hostname, normalize. */
  private resolveUrl(raw: string) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new ApiError(400, 'invalid_url', 'url is not a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ApiError(400, 'invalid_url', 'url must be http or https');
    }
    const adapter = this.deps.registry.resolve(parsed);
    if (!adapter) {
      throw new ApiError(
        422,
        'unsupported_store',
        `No adapter for ${parsed.hostname}`,
        { supportedDomains: this.deps.registry.supportedDomains() },
      );
    }
    return { adapter, url: adapter.normalizeUrl(parsed) };
  }

  // ---- channels, notifications, runs --------------------------------------

  channels() {
    return { items: this.deps.channels.map(describeChannel) };
  }

  async testChannel(name: string) {
    const lower = name.toLowerCase();
    if (!this.deps.channels.some((c) => c.name === lower)) {
      throw new ApiError(404, 'not_found', `Channel "${name}" not found`);
    }
    return this.deps.notifications.sendTest(lower);
  }

  async notifications(query: {
    limit?: number;
    cursor?: string;
    channel?: string;
    status?: 'sent' | 'failed';
    ruleId?: string;
  }) {
    const limit = limitOf(query.limit);
    const filters: (SQL | undefined)[] = [
      query.cursor ? lt(notifications.id, query.cursor) : undefined,
      query.channel
        ? eq(notifications.channel, query.channel.toLowerCase())
        : undefined,
      query.status ? eq(notifications.status, query.status) : undefined,
      query.ruleId ? eq(notifications.ruleId, query.ruleId) : undefined,
    ];
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.id))
      .limit(limit + 1);
    return paginate(rows, limit);
  }

  async runs(query: { limit?: number; cursor?: string }) {
    const limit = limitOf(query.limit);
    const rows = await this.db
      .select()
      .from(runs)
      .where(query.cursor ? lt(runs.id, query.cursor) : undefined)
      .orderBy(desc(runs.id))
      .limit(limit + 1);
    return paginate(rows, limit);
  }

  async health(): Promise<boolean> {
    try {
      await this.db.run(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  // ---- lookups ------------------------------------------------------------

  private async requireProduct(id: string) {
    const [row] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, id));
    if (!row) throw new ApiError(404, 'not_found', 'Product not found');
    return row;
  }

  private async requireListing(id: string) {
    const [row] = await this.db
      .select()
      .from(listings)
      .where(eq(listings.id, id));
    if (!row) throw new ApiError(404, 'not_found', 'Listing not found');
    return row;
  }

  private async requireRule(id: string) {
    const [row] = await this.db.select().from(rules).where(eq(rules.id, id));
    if (!row) throw new ApiError(404, 'not_found', 'Rule not found');
    return row;
  }
}

function emptySummary() {
  return {
    bestEffectivePriceCents: null as number | null,
    bestListingId: null as string | null,
    lowestEverCents: null as number | null,
  };
}
