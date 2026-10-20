import type {
  AlertDelivery,
  ChannelResult,
  DeliveryRequest,
} from '../alerts/events.js';
import type { Clock } from '../common/clock.js';
import { newId } from '../common/ids.js';
import type { Database } from '../db/database.js';
import { notifications } from '../db/schema.js';
import type { SystemEvent, SystemNotifier } from '../monitor/ports.js';
import { redact } from './mask.js';
import { withRetry } from './retry.js';
import type {
  NotificationEvent,
  Notifier,
  SystemNotificationEvent,
} from './types.js';

const MAX_ERROR_LENGTH = 1000;

export interface NotificationServiceDeps {
  db: Database;
  clock: Clock;
  /** Configured channels by lower-cased name. */
  notifiers: Map<string, Notifier>;
  /** Secrets per channel, scrubbed from stored error messages. */
  secrets?: Map<string, string[]>;
  /** `PW_DEFAULT_CHANNELS`; undefined means every configured channel. */
  defaultChannels?: string[];
  /** `PW_SYSTEM_CHANNELS`; undefined falls back to the default channels. */
  systemChannels?: string[];
}

interface Context {
  kind: 'alert' | 'system' | 'test';
  ruleId?: string;
  listingId?: string;
  observationId?: string;
}

/**
 * Delivers events to channels (REQ-NOT-004/005/006). A failure on one channel never blocks the others,
 * and every delivery, good or bad, leaves a row in `notifications`.
 */
export class NotificationService implements AlertDelivery, SystemNotifier {
  constructor(private readonly deps: NotificationServiceDeps) {}

  async deliver(request: DeliveryRequest): Promise<ChannelResult[]> {
    const names = this.resolve(request.channels, this.deps.defaultChannels);
    return this.fanOut(names, request.event, {
      kind: 'alert',
      ruleId: request.ruleId,
      listingId: request.listingId,
      observationId: request.observationId,
    });
  }

  /** System notices (listing failing/recovered) go to `PW_SYSTEM_CHANNELS`. Never throws on channel failure. */
  async send(event: SystemEvent): Promise<void> {
    const payload: SystemNotificationEvent = {
      version: 1,
      event: event.event,
      occurredAt: this.deps.clock.now().toISOString(),
      listing: { id: event.listingId, url: event.url },
      reason:
        event.event === 'system.listing_failing'
          ? `Falhas consecutivas ao ler o anúncio: ${event.reason}`
          : 'O anúncio voltou a ser lido normalmente',
    };
    const names = this.resolve(
      [],
      this.deps.systemChannels ?? this.deps.defaultChannels,
    );
    await this.fanOut(names, payload, {
      kind: 'system',
      listingId: event.listingId,
    });
  }

  /** Sends a test notice to one channel (used by the API). */
  async sendTest(channel: string): Promise<ChannelResult> {
    const payload: SystemNotificationEvent = {
      version: 1,
      event: 'system.test',
      occurredAt: this.deps.clock.now().toISOString(),
      reason: 'Notificação de teste do pricewatch',
    };
    const [result] = await this.fanOut([channel.toLowerCase()], payload, {
      kind: 'test',
    });
    return result as ChannelResult;
  }

  /** Explicit names win; otherwise the configured defaults; otherwise every channel. */
  private resolve(
    explicit: string[],
    fallback: string[] | undefined,
  ): string[] {
    const names =
      explicit.length > 0
        ? explicit
        : (fallback ?? [...this.deps.notifiers.keys()]);
    return [...new Set(names.map((name) => name.toLowerCase()))];
  }

  private fanOut(
    names: string[],
    event: NotificationEvent,
    context: Context,
  ): Promise<ChannelResult[]> {
    return Promise.all(names.map((name) => this.sendOne(name, event, context)));
  }

  private async sendOne(
    name: string,
    event: NotificationEvent,
    context: Context,
  ): Promise<ChannelResult> {
    const notifier = this.deps.notifiers.get(name);
    let error: string | undefined;

    if (!notifier) {
      error = 'unknown channel';
    } else {
      try {
        await withRetry(this.deps.clock, () => notifier.send(event));
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        error = redact(message, this.deps.secrets?.get(name) ?? []).slice(
          0,
          MAX_ERROR_LENGTH,
        );
      }
    }

    await this.deps.db.insert(notifications).values({
      id: newId(),
      ruleId: context.ruleId ?? null,
      listingId: context.listingId ?? null,
      observationId: context.observationId ?? null,
      channel: name,
      kind: context.kind,
      status: error === undefined ? 'sent' : 'failed',
      payload: event,
      errorMessage: error ?? null,
      createdAt: this.deps.clock.now().toISOString(),
    });
    return error === undefined
      ? { channel: name, ok: true }
      : { channel: name, ok: false, error };
  }
}
