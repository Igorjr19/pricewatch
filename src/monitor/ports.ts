import type { StoreAdapter } from './adapters/types.js';

/** Fetches a page over HTTP. 4xx/5xx are returned, not thrown; transport failures throw. */
export interface PageFetcher {
  fetch(
    url: URL,
    adapter: StoreAdapter,
  ): Promise<{ status: number; html: string; finalUrl: URL }>;
}

export interface ObservedEvent {
  observationId: string;
  listingId: string;
  productId: string;
  observedAt: string;
  priceCents: number | null;
  pixPriceCents: number | null;
  effectivePriceCents: number | null;
  inStock: boolean;
}

/**
 * The monitor knows nothing about rules. The alerts module receives the cycle's observations
 * (the `price.observed` event, in-process) and returns how many notifications it delivered.
 */
export interface AlertsPort {
  handleObservations(
    events: ObservedEvent[],
    now: Date,
  ): Promise<{ notificationsSent: number }>;
}

export const noopAlerts: AlertsPort = {
  async handleObservations() {
    return { notificationsSent: 0 };
  },
};

export interface SystemEvent {
  event: 'system.listing_failing' | 'system.listing_recovered';
  listingId: string;
  url: string;
  reason: string;
}

/** Delivers system notices to `PW_SYSTEM_CHANNELS`. */
export interface SystemNotifier {
  send(event: SystemEvent): Promise<void>;
}
