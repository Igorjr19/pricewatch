import { describe, expect, it } from 'vitest';
import { bestPrice } from '../../src/alerts/evaluators/best-price.js';
import {
  evaluate,
  evaluateBackInStock,
  evaluateNewLow,
  evaluateTargetPrice,
} from '../../src/alerts/evaluators/index.js';
import type {
  EvalInput,
  History,
  ListingView,
  Obs,
  RuleState,
} from '../../src/alerts/evaluators/types.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date('2026-01-10T12:00:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

let seq = 0;
function obs(effective: number | null, inStock = true, observedAt = T0): Obs {
  seq++;
  return {
    id: `O${seq}`,
    observedAt: observedAt.toISOString(),
    effectivePriceCents: effective,
    priceCents: effective,
    pixPriceCents: null,
    inStock,
  };
}

function listing(
  listingId: string,
  latest: Obs | null,
  previous: Obs | null = null,
  status: ListingView['status'] = 'active',
): ListingView {
  return { listingId, status, latest, previous };
}

const noHistory: History = { lowestBeforeCents: null, firstObservedAt: null };

function input<P>(
  params: P,
  listings: ListingView[],
  extra: Partial<EvalInput<P>> = {},
): EvalInput<P> {
  return {
    params,
    cooldownMs: 12 * HOUR,
    now: T0,
    listings,
    history: noHistory,
    state: null,
    ...extra,
  };
}

describe('glossary: best product price', () => {
  it('takes the lowest effective price among active, in-stock listings', () => {
    const best = bestPrice([
      listing('A', obs(200_000)),
      listing('B', obs(150_000)),
      listing('C', obs(100_000, false)), // out of stock
      listing('D', obs(90_000), null, 'paused'),
      listing('E', obs(80_000), null, 'failing'),
      listing('F', null),
      listing('G', obs(null)),
    ]);
    expect(best).toMatchObject({ listingId: 'B', effectiveCents: 150_000 });
  });

  it('is null when nothing qualifies, and ties go to the first listing', () => {
    expect(bestPrice([listing('A', obs(1, false))])).toBeNull();
    expect(
      bestPrice([listing('A', obs(5)), listing('B', obs(5))])?.listingId,
    ).toBe('A');
  });
});

describe('REQ-ALR-010 to REQ-ALR-013 acceptance scenario (target R$ 2.000,00, cooldown 12h)', () => {
  const params = { targetCents: 200_000 };

  function step(state: RuleState | null, price: number, offsetMs: number) {
    return evaluateTargetPrice(
      input(params, [listing('L', obs(price))], { state, now: at(offsetMs) }),
    );
  }

  it('walks the seven steps', () => {
    // 1. R$ 2.100, armed → nothing is sent.
    let result = step(null, 210_000, 0);
    expect(result.fire).toBe(false);

    // 2. R$ 1.990 → notification, state becomes triggered.
    result = step(result.newState, 199_000, 1 * HOUR);
    expect(result.fire).toBe(true);
    expect(result.newState.units.product).toMatchObject({
      status: 'triggered',
      lastNotifiedPriceCents: 199_000,
    });

    // 3. 1h later, still R$ 1.990 → nothing.
    result = step(result.newState, 199_000, 2 * HOUR);
    expect(result.fire).toBe(false);

    // 4. 2h later, R$ 1.950 → lower than the last notified: notifies, cooldown ignored.
    const step4At = 4 * HOUR;
    result = step(result.newState, 195_000, step4At);
    expect(result.fire).toBe(true);
    expect(result.newState.units.product?.lastNotifiedPriceCents).toBe(195_000);

    // 5. R$ 2.050 → re-armed without notification.
    result = step(result.newState, 205_000, step4At + 1 * HOUR);
    expect(result.fire).toBe(false);
    expect(result.newState.units.product?.status).toBe('armed');

    // 6. 3h after step 4, R$ 1.990 → suppressed by the 12h cooldown, stays armed.
    result = step(result.newState, 199_000, step4At + 3 * HOUR);
    expect(result.fire).toBe(false);
    expect(result.newState.units.product?.status).toBe('armed');

    // 7. 13h after step 4, still R$ 1.990 → notification.
    result = step(result.newState, 199_000, step4At + 13 * HOUR);
    expect(result.fire).toBe(true);
    expect(result.context[0]).toMatchObject({
      effectiveCents: 199_000,
      reason: 'Melhor preço R$ 1.990,00 abaixo do alvo R$ 2.000,00',
    });
  });
});

describe('REQ-ALR-012 triggered rule', () => {
  const params = { targetCents: 200_000 };
  const triggered: RuleState = {
    units: {
      product: {
        status: 'triggered',
        lastNotifiedPriceCents: 195_000,
        lastTriggeredAt: T0.toISOString(),
        pendingDelivery: false,
      },
    },
  };

  it('does not notify again at an equal or higher price', () => {
    for (const price of [195_000, 198_000]) {
      const result = evaluateTargetPrice(
        input(params, [listing('L', obs(price))], {
          state: triggered,
          now: at(30 * DAY),
        }),
      );
      expect(result.fire).toBe(false);
      expect(result.newState.units.product?.status).toBe('triggered');
    }
  });

  it('notifies again at a strictly lower price even inside the cooldown', () => {
    const result = evaluateTargetPrice(
      input(params, [listing('L', obs(190_000))], {
        state: triggered,
        now: at(1 * HOUR),
      }),
    );
    expect(result.fire).toBe(true);
    expect(result.newState.units.product?.lastNotifiedPriceCents).toBe(190_000);
  });
});

describe('REQ-ALR-011 re-arming', () => {
  it('re-arms silently when the condition stops holding, including when stock disappears', () => {
    const state: RuleState = {
      units: {
        product: {
          status: 'triggered',
          lastNotifiedPriceCents: 190_000,
          lastTriggeredAt: T0.toISOString(),
          pendingDelivery: false,
        },
      },
    };
    const result = evaluateTargetPrice(
      input({ targetCents: 200_000 }, [listing('L', obs(150_000, false))], {
        state,
      }),
    );
    expect(result.fire).toBe(false);
    expect(result.newState.units.product?.status).toBe('armed');
  });
});

describe('target_price boundary', () => {
  it('fires when the price equals the target', () => {
    const result = evaluateTargetPrice(
      input({ targetCents: 200_000 }, [listing('L', obs(200_000))]),
    );
    expect(result.fire).toBe(true);
    expect(result.context[0]?.reason).toBe(
      'Melhor preço R$ 2.000,00 igual ao alvo R$ 2.000,00',
    );
  });

  it('reports the listing with the best price (REQ-ALR-021) and the previous price', () => {
    const result = evaluateTargetPrice(
      input({ targetCents: 200_000 }, [
        listing('A', obs(190_000)),
        listing('B', obs(180_000), obs(185_000)),
      ]),
    );
    expect(result.context[0]).toMatchObject({
      listingId: 'B',
      previousEffectiveCents: 185_000,
    });
  });

  it('does not fire without a qualifying listing', () => {
    expect(
      evaluateTargetPrice(
        input({ targetCents: 200_000 }, [listing('A', obs(100, false))]),
      ).fire,
    ).toBe(false);
  });
});

describe('REQ-ALR-015 pending delivery', () => {
  it('is discarded when the condition no longer holds', () => {
    const state: RuleState = {
      units: {
        product: {
          status: 'armed',
          lastNotifiedPriceCents: null,
          lastTriggeredAt: null,
          pendingDelivery: true,
        },
      },
    };
    const result = evaluateTargetPrice(
      input({ targetCents: 100_000 }, [listing('A', obs(150_000))], { state }),
    );
    expect(result.fire).toBe(false);
    expect(result.newState.units.product?.pendingDelivery).toBe(false);
  });
});

describe('REQ-ALR-003 new_low', () => {
  const params = { minHistoryDays: 7 };
  const old: History = {
    lowestBeforeCents: 100_000,
    firstObservedAt: new Date(T0.getTime() - 10 * DAY).toISOString(),
  };

  it('fires when the best price is below every earlier in-stock price', () => {
    const result = evaluateNewLow(
      input(params, [listing('A', obs(95_000), obs(100_000))], {
        history: old,
      }),
    );
    expect(result.fire).toBe(true);
    expect(result.context[0]).toMatchObject({
      effectiveCents: 95_000,
      lowestEverCents: 95_000,
      reason: 'Menor preço já registrado: R$ 950,00 (anterior R$ 1.000,00)',
    });
  });

  it('does not fire at an equal price', () => {
    expect(
      evaluateNewLow(
        input(params, [listing('A', obs(100_000))], { history: old }),
      ).fire,
    ).toBe(false);
  });

  it('does not fire while the first observation is younger than minHistoryDays', () => {
    const young: History = {
      lowestBeforeCents: 100_000,
      firstObservedAt: new Date(T0.getTime() - 3 * DAY).toISOString(),
    };
    expect(
      evaluateNewLow(
        input(params, [listing('A', obs(50_000))], { history: young }),
      ).fire,
    ).toBe(false);
  });

  it('with minHistoryDays 0 it fires as soon as there is something to beat', () => {
    const fresh: History = {
      lowestBeforeCents: 100_000,
      firstObservedAt: T0.toISOString(),
    };
    expect(
      evaluateNewLow(
        input({ minHistoryDays: 0 }, [listing('A', obs(99_000))], {
          history: fresh,
        }),
      ).fire,
    ).toBe(true);
  });

  it('never fires without earlier in-stock observations', () => {
    const onlyOutOfStock: History = {
      lowestBeforeCents: null,
      firstObservedAt: new Date(T0.getTime() - 30 * DAY).toISOString(),
    };
    expect(
      evaluateNewLow(
        input(params, [listing('A', obs(1))], { history: onlyOutOfStock }),
      ).fire,
    ).toBe(false);
  });

  it('is cross-listing: the best price of any listing is compared with the product history', () => {
    const result = evaluateNewLow(
      input(params, [listing('A', obs(120_000)), listing('B', obs(90_000))], {
        history: old,
      }),
    );
    expect(result.context[0]?.listingId).toBe('B');
  });
});

describe('REQ-ALR-005 / REQ-ALR-014 back_in_stock', () => {
  it('fires per listing on out-of-stock → in-stock', () => {
    const result = evaluateBackInStock(
      input({}, [listing('A', obs(100_000, true), obs(100_000, false))]),
    );
    expect(result.fire).toBe(true);
    expect(result.context[0]).toMatchObject({
      listingId: 'A',
      unitKey: 'A',
      reason: 'Voltou ao estoque por R$ 1.000,00',
    });
    expect(result.newState.units.A?.lastNotifiedPriceCents).toBe(100_000);
  });

  it('does not fire on a first observation', () => {
    expect(
      evaluateBackInStock(input({}, [listing('A', obs(100_000, true), null)]))
        .fire,
    ).toBe(false);
  });

  it('does not fire for in-stock → in-stock or in-stock → out-of-stock', () => {
    expect(
      evaluateBackInStock(input({}, [listing('A', obs(1, true), obs(1, true))]))
        .fire,
    ).toBe(false);
    expect(
      evaluateBackInStock(
        input({}, [listing('A', obs(1, false), obs(1, true))]),
      ).fire,
    ).toBe(false);
  });

  it('keeps independent state per listing', () => {
    const result = evaluateBackInStock(
      input({}, [
        listing('A', obs(100, true), obs(100, false)),
        listing('B', obs(200, true), obs(200, false)),
        listing('C', obs(300, true), obs(300, true)),
      ]),
    );
    expect(result.context.map((c) => c.listingId)).toEqual(['A', 'B']);
    expect(Object.keys(result.newState.units).sort()).toEqual(['A', 'B', 'C']);
    expect(result.newState.units.C?.status).toBe('armed');
  });

  it('retries a pending delivery while the listing stays in stock', () => {
    const state: RuleState = {
      units: {
        A: {
          status: 'armed',
          lastNotifiedPriceCents: null,
          lastTriggeredAt: null,
          pendingDelivery: true,
        },
      },
    };
    const result = evaluateBackInStock(
      input({}, [listing('A', obs(100, true), obs(100, true))], { state }),
    );
    expect(result.fire).toBe(true);
  });

  it('applies the cooldown per listing', () => {
    const state: RuleState = {
      units: {
        A: {
          status: 'armed',
          lastNotifiedPriceCents: 100,
          lastTriggeredAt: at(-1 * HOUR).toISOString(),
          pendingDelivery: false,
        },
      },
    };
    const result = evaluateBackInStock(
      input({}, [listing('A', obs(100, true), obs(100, false))], { state }),
    );
    expect(result.fire).toBe(false);
    expect(result.newState.units.A?.status).toBe('armed');
  });
});

describe('REQ-ALR-001 evaluators are pure', () => {
  it('does not mutate its input and is deterministic', () => {
    const state: RuleState = { units: {} };
    const frozen = Object.freeze({
      ...input({ targetCents: 1 }, [listing('A', obs(1))], { state }),
    });
    const first = evaluate('target_price', frozen);
    const second = evaluate('target_price', frozen);
    expect(second).toEqual(first);
    expect(state).toEqual({ units: {} });
  });

  it('dispatches by rule type', () => {
    expect(evaluate('back_in_stock', input({}, [])).fire).toBe(false);
    expect(evaluate('new_low', input({ minHistoryDays: 7 }, [])).fire).toBe(
      false,
    );
  });
});
