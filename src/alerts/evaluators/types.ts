/** One stored reading of a listing, as the evaluators need it. */
export interface Obs {
  id: string;
  observedAt: string;
  effectivePriceCents: number | null;
  priceCents: number | null;
  pixPriceCents: number | null;
  inStock: boolean;
}

export interface ListingView {
  listingId: string;
  status: 'active' | 'paused' | 'failing';
  /** Most recent observation, including this cycle's. */
  latest: Obs | null;
  /** The observation before `latest`. */
  previous: Obs | null;
}

/** Product history, taken from observations of the product's listings. */
export interface History {
  /** Lowest effective price among in-stock observations made before this cycle. */
  lowestBeforeCents: number | null;
  /** Timestamp of the product's first observation of any kind. */
  firstObservedAt: string | null;
}

/** `armed`/`triggered` state of one unit: the product, or one listing for per-listing rules. */
export interface UnitState {
  status: 'armed' | 'triggered';
  lastNotifiedPriceCents: number | null;
  lastTriggeredAt: string | null;
  /** Delivery failed on all channels: re-evaluate next cycle even without a new observation (REQ-ALR-015). */
  pendingDelivery: boolean;
}

/** Stored in `rules.state`. Keys are `product` or a listing id. */
export interface RuleState {
  units: Record<string, UnitState>;
}

export interface EvalInput<P> {
  params: P;
  cooldownMs: number;
  now: Date;
  listings: ListingView[];
  history: History;
  state: RuleState | null;
}

/** What one firing needs to build the alert event (spec 8.3). */
export interface FireContext {
  unitKey: string;
  listingId: string;
  observationId: string;
  effectiveCents: number | null;
  priceCents: number | null;
  pixCents: number | null;
  inStock: boolean;
  previousEffectiveCents: number | null;
  lowestEverCents: number | null;
  /** pt-BR text (REQ-ALR-020). */
  reason: string;
}

export interface EvalResult {
  fire: boolean;
  /** One entry per firing unit; empty when nothing fires. Product-scoped rules fire at most once. */
  context: FireContext[];
  /** State assuming every firing is delivered. The caller keeps the old unit state when it is not (REQ-ALR-010/015). */
  newState: RuleState;
}
