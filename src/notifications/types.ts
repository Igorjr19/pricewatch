import type { AlertEvent } from '../alerts/events.js';

export type ChannelConfig =
  | { type: 'telegram'; name: string; botToken: string; chatId: string }
  | {
      type: 'smtp';
      name: string;
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
      from: string;
      to: string[];
    }
  | { type: 'webhook'; name: string; url: string; secret?: string };

export interface SystemNotificationEvent {
  version: 1;
  event: 'system.listing_failing' | 'system.listing_recovered' | 'system.test';
  occurredAt: string;
  listing?: { id: string; url: string };
  /** pt-BR text. */
  reason: string;
}

export type NotificationEvent = AlertEvent | SystemNotificationEvent;

/** REQ-NOT-003: throws on failure. */
export interface Notifier {
  send(event: NotificationEvent): Promise<void>;
}

/** Thrown by notifiers. `retryable` is true for network errors and 5xx (REQ-NOT-005). */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
