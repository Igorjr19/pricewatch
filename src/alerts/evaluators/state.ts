import type { RuleState, UnitState } from './types.js';

export function armedUnit(): UnitState {
  return {
    status: 'armed',
    lastNotifiedPriceCents: null,
    lastTriggeredAt: null,
    pendingDelivery: false,
  };
}

export function unitOf(state: RuleState | null, key: string): UnitState {
  return state?.units[key] ?? armedUnit();
}

/**
 * Deduplication and cooldown for one unit (REQ-ALR-010 to 013).
 * `price` is the relevant effective price; `fire` means "notify now", `next` the state if delivered.
 */
export function stepUnit(
  unit: UnitState,
  conditionHolds: boolean,
  price: number | null,
  now: Date,
  cooldownMs: number,
): { fire: boolean; next: UnitState } {
  if (!conditionHolds) {
    // Condition gone: a triggered unit is re-armed silently (ALR-011); a pending flag is discarded (ALR-015).
    return {
      fire: false,
      next: { ...unit, status: 'armed', pendingDelivery: false },
    };
  }

  if (unit.status === 'triggered') {
    // ALR-012: only a strictly lower price notifies again, and the cooldown does not apply.
    const lower =
      price !== null &&
      unit.lastNotifiedPriceCents !== null &&
      price < unit.lastNotifiedPriceCents;
    return lower
      ? { fire: true, next: triggered(price, now) }
      : { fire: false, next: unit };
  }

  // ALR-013: an armed rule inside its cooldown stays armed and is re-evaluated next cycle.
  if (
    unit.lastTriggeredAt !== null &&
    now.getTime() - new Date(unit.lastTriggeredAt).getTime() < cooldownMs
  ) {
    return { fire: false, next: { ...unit, pendingDelivery: false } };
  }
  return { fire: true, next: triggered(price, now) };
}

function triggered(price: number | null, now: Date): UnitState {
  return {
    status: 'triggered',
    lastNotifiedPriceCents: price,
    lastTriggeredAt: now.toISOString(),
    pendingDelivery: false,
  };
}
