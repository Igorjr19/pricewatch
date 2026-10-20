import { reasonBackInStock } from '../format.js';
import type { BackInStockParams } from '../params.js';
import { stepUnit, unitOf } from './state.js';
import type {
  EvalInput,
  EvalResult,
  FireContext,
  ListingView,
  RuleState,
} from './types.js';

/**
 * Fires per listing when it goes from out of stock (previous observation) to in stock (REQ-ALR-005:
 * never on a first observation). State is kept per listing (REQ-ALR-014).
 *
 * The transition is an edge, so a delivery that failed (`pendingDelivery`) is retried while the listing
 * stays in stock, otherwise the next observation would silently drop the alert.
 */
export function evaluateBackInStock(
  input: EvalInput<BackInStockParams>,
): EvalResult {
  const { state, now, cooldownMs, history } = input;
  const units: RuleState['units'] = { ...state?.units };
  const context: FireContext[] = [];

  for (const listing of input.listings) {
    if (listing.status !== 'active') continue;
    const { latest } = listing;
    const unit = unitOf(state, listing.listingId);
    const holds =
      latest !== null &&
      latest.inStock &&
      (unit.pendingDelivery || cameBack(listing));

    const price = latest?.effectivePriceCents ?? null;
    const { fire, next } = stepUnit(unit, holds, price, now, cooldownMs);
    units[listing.listingId] = next;
    if (!fire || latest === null) continue;

    context.push({
      unitKey: listing.listingId,
      listingId: listing.listingId,
      observationId: latest.id,
      effectiveCents: price,
      priceCents: latest.priceCents,
      pixCents: latest.pixPriceCents,
      inStock: true,
      previousEffectiveCents: listing.previous?.effectivePriceCents ?? null,
      lowestEverCents:
        price === null
          ? history.lowestBeforeCents
          : Math.min(price, history.lowestBeforeCents ?? price),
      reason: reasonBackInStock(price),
    });
  }

  return { fire: context.length > 0, context, newState: { units } };
}

function cameBack(listing: ListingView): boolean {
  return listing.previous !== null && !listing.previous.inStock;
}
