import { reasonTargetPrice } from '../format.js';
import type { TargetPriceParams } from '../params.js';
import { bestPrice } from './best-price.js';
import { stepUnit, unitOf } from './state.js';
import type { EvalInput, EvalResult } from './types.js';

const UNIT = 'product';

/** Fires when the best product price is at or below `targetCents`. Product scope. */
export function evaluateTargetPrice(
  input: EvalInput<TargetPriceParams>,
): EvalResult {
  const { params, state, now, cooldownMs, history } = input;
  const best = bestPrice(input.listings);
  const holds = best !== null && best.effectiveCents <= params.targetCents;

  const { fire, next } = stepUnit(
    unitOf(state, UNIT),
    holds,
    best?.effectiveCents ?? null,
    now,
    cooldownMs,
  );
  const newState = { units: { ...state?.units, [UNIT]: next } };
  if (!fire || best === null) return { fire: false, context: [], newState };

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
        lowestEverCents: lowestEver(
          history.lowestBeforeCents,
          best.effectiveCents,
        ),
        reason: reasonTargetPrice(best.effectiveCents, params.targetCents),
      },
    ],
  };
}

function lowestEver(before: number | null, current: number): number {
  return before === null ? current : Math.min(before, current);
}
