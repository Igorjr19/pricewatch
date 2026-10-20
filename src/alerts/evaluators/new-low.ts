import { reasonNewLow } from '../format.js';
import type { NewLowParams } from '../params.js';
import { bestPrice } from './best-price.js';
import { stepUnit, unitOf } from './state.js';
import type { EvalInput, EvalResult } from './types.js';

const UNIT = 'product';
const DAY_MS = 86_400_000;

/**
 * Fires when the best product price is below every in-stock effective price observed before this cycle,
 * once the product has at least `minHistoryDays` of history (REQ-ALR-003). Product scope.
 */
export function evaluateNewLow(input: EvalInput<NewLowParams>): EvalResult {
  const { params, state, now, cooldownMs, history } = input;
  const best = bestPrice(input.listings);

  const oldEnough =
    history.firstObservedAt !== null &&
    now.getTime() - new Date(history.firstObservedAt).getTime() >=
      params.minHistoryDays * DAY_MS;
  const previousLow = history.lowestBeforeCents;
  const holds =
    best !== null &&
    previousLow !== null &&
    oldEnough &&
    best.effectiveCents < previousLow;

  const { fire, next } = stepUnit(
    unitOf(state, UNIT),
    holds,
    best?.effectiveCents ?? null,
    now,
    cooldownMs,
  );
  const newState = { units: { ...state?.units, [UNIT]: next } };
  if (!fire || best === null || previousLow === null)
    return { fire: false, context: [], newState };

  return {
    fire: true,
    newState,
    context: [
      {
        unitKey: UNIT,
        listingId: best.listingId,
        observationId: best.latest.id,
        effectiveCents: best.effectiveCents,
        priceCents: best.latest.priceCents,
        pixCents: best.latest.pixPriceCents,
        inStock: best.latest.inStock,
        previousEffectiveCents: best.previous?.effectivePriceCents ?? null,
        lowestEverCents: best.effectiveCents,
        reason: reasonNewLow(best.effectiveCents, previousLow),
      },
    ],
  };
}
