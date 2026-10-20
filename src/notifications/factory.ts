import type { Clock } from '../common/clock.js';
import type { Database } from '../db/database.js';
import type { FetchFn } from './http.js';
import { NotificationService } from './notification.service.js';
import { SmtpNotifier } from './smtp.notifier.js';
import { TelegramNotifier } from './telegram.notifier.js';
import type { ChannelConfig, Notifier } from './types.js';
import { WebhookNotifier } from './webhook.notifier.js';

export interface NotificationWiring {
  db: Database;
  clock: Clock;
  channels: ChannelConfig[];
  defaultChannels?: string[];
  systemChannels?: string[];
  fetchFn?: FetchFn;
}

export function createNotifier(
  channel: ChannelConfig,
  clock: Clock,
  fetchFn?: FetchFn,
): Notifier {
  switch (channel.type) {
    case 'telegram':
      return new TelegramNotifier(channel, fetchFn);
    case 'smtp':
      return new SmtpNotifier(channel);
    case 'webhook':
      return new WebhookNotifier(channel, clock, fetchFn);
  }
}

function secretsOf(channel: ChannelConfig): string[] {
  switch (channel.type) {
    case 'telegram':
      return [channel.botToken];
    case 'smtp':
      return channel.pass ? [channel.pass] : [];
    case 'webhook':
      return channel.secret ? [channel.secret] : [];
  }
}

export function createNotificationService(
  wiring: NotificationWiring,
): NotificationService {
  return new NotificationService({
    db: wiring.db,
    clock: wiring.clock,
    notifiers: new Map(
      wiring.channels.map((c) => [
        c.name,
        createNotifier(c, wiring.clock, wiring.fetchFn),
      ]),
    ),
    secrets: new Map(wiring.channels.map((c) => [c.name, secretsOf(c)])),
    defaultChannels: wiring.defaultChannels,
    systemChannels: wiring.systemChannels,
  });
}
