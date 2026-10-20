import { and, desc, eq, inArray, isNull, min, notInArray } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { listings, observations, products, rules } from '../db/schema.js';
import type { AdapterRegistry } from '../monitor/adapters/registry.js';
import type { AlertsPort, ObservedEvent } from '../monitor/ports.js';
import { evaluate } from './evaluators/index.js';
import { armedUnit } from './evaluators/state.js';
import type {
  History,
  ListingView,
  Obs,
  RuleState,
} from './evaluators/types.js';
import type { AlertDelivery, AlertEvent } from './events.js';
import { parseRuleParams, type RuleType } from './params.js';

export interface AlertsConfig {
  /** `PW_ALERT_COOLDOWN`, the default when a rule has no `cooldown_minutes`. */
  alertCooldownMs: number;
}

type RuleRow = typeof rules.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type ObservationRow = typeof observations.$inferSelect;

interface ProductContext {
  product: ProductRow;
  listings: Array<typeof listings.$inferSelect>;
  views: ListingView[];
  history: History;
}

/**
 * Consumes the cycle's observations (the in-process `price.observed` event), evaluates the rules of the
 * affected products and delivers the alerts (REQ-ALR-006, REQ-ALR-010 to 015).
 */
export class AlertsService implements AlertsPort {
  constructor(
    private readonly deps: {
      db: Database;
      registry: AdapterRegistry;
      delivery: AlertDelivery;
      config: AlertsConfig;
    },
  ) {}

  async handleObservations(
    events: ObservedEvent[],
    now: Date,
  ): Promise<{ notificationsSent: number }> {
    const { db } = this.deps;
    const eventProductIds = new Set(events.map((e) => e.productId));
    const cycleObservationIds = events.map((e) => e.observationId);

    // REQ-ALR-006: enabled rules of non-archived products that saw a new observation or are pending.
    const candidates = await db
      .select({ rule: rules, product: products })
      .from(rules)
      .innerJoin(products, eq(products.id, rules.productId))
      .where(and(eq(rules.enabled, true), isNull(products.archivedAt)));
    const selected = candidates.filter(
      ({ rule }) =>
        eventProductIds.has(rule.productId) ||
        hasPending(parseState(rule.state)),
    );

    const contexts = new Map<string, ProductContext>();
    let notificationsSent = 0;

    for (const { rule, product } of selected) {
      let context = contexts.get(product.id);
      if (!context) {
        context = await this.loadProduct(
          product,
          cycleObservationIds,
          !eventProductIds.has(product.id),
        );
        contexts.set(product.id, context);
      }
      notificationsSent += await this.processRule(rule, context, now);
    }

    return { notificationsSent };
  }

  private async processRule(
    rule: RuleRow,
    context: ProductContext,
    now: Date,
  ): Promise<number> {
    const type = rule.type as RuleType;
    const params = parseRuleParams(type, rule.params);
    if (!params.ok) return 0; // Invalid stored params: the rule is skipped, never evaluated on guesses.

    const state = parseState(rule.state);
    const result = evaluate(type, {
      params: params.params,
      cooldownMs:
        rule.cooldownMinutes === null
          ? this.deps.config.alertCooldownMs
          : rule.cooldownMinutes * 60_000,
      now,
      listings: context.views,
      history: context.history,
      state,
    });

    const nextUnits = { ...result.newState.units };
    let sent = 0;
    let anyDelivered = false;

    for (const fire of result.context) {
      const listing = context.listings.find((l) => l.id === fire.listingId);
      if (!listing) continue;
      const adapter = this.deps.registry.get(listing.adapterId);
      const event: AlertEvent = {
        version: 1,
        event: 'alert.triggered',
        occurredAt: now.toISOString(),
        rule: { id: rule.id, type, params: params.params },
        product: { id: context.product.id, name: context.product.name },
        listing: {
          id: listing.id,
          store: listing.adapterId,
          storeName: adapter?.displayName ?? listing.adapterId,
          url: listing.url,
        },
        price: {
          effectiveCents: fire.effectiveCents,
          priceCents: fire.priceCents,
          pixCents: fire.pixCents,
          inStock: fire.inStock,
          previousEffectiveCents: fire.previousEffectiveCents,
          lowestEverCents: fire.lowestEverCents,
        },
        reason: fire.reason,
      };

      const results = await this.deps.delivery.deliver({
        event,
        ruleId: rule.id,
        listingId: listing.id,
        observationId: fire.observationId,
        channels: (rule.channels as string[] | null) ?? [],
      });
      const delivered = results.filter((r) => r.ok).length;
      sent += delivered;

      if (delivered > 0) {
        anyDelivered = true;
      } else {
        // ALR-015: delivery failed on all channels. The unit keeps its old state and is retried next cycle.
        nextUnits[fire.unitKey] = {
          ...(state?.units[fire.unitKey] ?? armedUnit()),
          pendingDelivery: true,
        };
      }
    }

    const nextState: RuleState = { units: nextUnits };
    if (
      JSON.stringify(nextState) !== JSON.stringify(state ?? { units: {} }) ||
      anyDelivered
    ) {
      await this.deps.db
        .update(rules)
        .set({
          state: nextState,
          lastTriggeredAt: anyDelivered
            ? now.toISOString()
            : rule.lastTriggeredAt,
        })
        .where(eq(rules.id, rule.id));
    }
    return sent;
  }

  private async loadProduct(
    product: ProductRow,
    cycleObservationIds: string[],
    pendingOnly: boolean,
  ): Promise<ProductContext> {
    const { db } = this.deps;
    const productListings = await db
      .select()
      .from(listings)
      .where(eq(listings.productId, product.id));
    const listingIds = productListings.map((l) => l.id);

    const views: ListingView[] = [];
    const excluded = new Set(cycleObservationIds);
    for (const listing of productListings) {
      const [latest, previous] = await db
        .select()
        .from(observations)
        .where(eq(observations.listingId, listing.id))
        .orderBy(desc(observations.observedAt), desc(observations.id))
        .limit(2);
      // Retrying a pending alert with no new observation: the triggering observation is not "history" yet.
      if (pendingOnly && latest) excluded.add(latest.id);
      views.push({
        listingId: listing.id,
        status: listing.status,
        latest: latest ? toObs(latest) : null,
        previous: previous ? toObs(previous) : null,
      });
    }

    let history: History = { lowestBeforeCents: null, firstObservedAt: null };
    if (listingIds.length > 0) {
      const beforeCycle = and(
        inArray(observations.listingId, listingIds),
        eq(observations.inStock, true),
        excluded.size > 0
          ? notInArray(observations.id, [...excluded])
          : undefined,
      );
      const [lowest] = await db
        .select({ value: min(observations.effectivePriceCents) })
        .from(observations)
        .where(beforeCycle);
      const [first] = await db
        .select({ value: min(observations.observedAt) })
        .from(observations)
        .where(inArray(observations.listingId, listingIds));
      history = {
        lowestBeforeCents: lowest?.value ?? null,
        firstObservedAt: first?.value ?? null,
      };
    }

    return { product, listings: productListings, views, history };
  }
}

function toObs(row: ObservationRow): Obs {
  return {
    id: row.id,
    observedAt: row.observedAt,
    effectivePriceCents: row.effectivePriceCents,
    priceCents: row.priceCents,
    pixPriceCents: row.pixPriceCents,
    inStock: row.inStock,
  };
}

function parseState(raw: unknown): RuleState | null {
  if (typeof raw !== 'object' || raw === null || !('units' in raw)) return null;
  return raw as RuleState;
}

function hasPending(state: RuleState | null): boolean {
  return (
    state !== null &&
    Object.values(state.units).some((unit) => unit.pendingDelivery)
  );
}
