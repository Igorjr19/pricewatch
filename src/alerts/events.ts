import type { RuleType } from './params.js';

/** The single alert payload, used by every channel and stored in `notifications.payload` (spec 8.3). */
export interface AlertEvent {
  version: 1;
  event: 'alert.triggered';
  occurredAt: string;
  rule: { id: string; type: RuleType; params: unknown };
  product: { id: string; name: string };
  listing: { id: string; store: string; storeName: string; url: string };
  price: {
    effectiveCents: number | null;
    priceCents: number | null;
    pixCents: number | null;
    inStock: boolean;
    previousEffectiveCents: number | null;
    lowestEverCents: number | null;
  };
  /** pt-BR (REQ-ALR-020). */
  reason: string;
}

export interface DeliveryRequest {
  event: AlertEvent;
  ruleId: string;
  listingId: string;
  observationId: string;
  /** Channel names from the rule; empty means `PW_DEFAULT_CHANNELS`. */
  channels: string[];
}

export interface ChannelResult {
  channel: string;
  ok: boolean;
  error?: string;
}

/**
 * Sends an alert to its channels and records one `notifications` row per channel.
 * A failure on one channel must not block the others (REQ-NOT).
 */
export interface AlertDelivery {
  deliver(request: DeliveryRequest): Promise<ChannelResult[]>;
}
