import type {
  AlertDelivery,
  ChannelResult,
  DeliveryRequest,
} from '../../src/alerts/events.js';
import { Clock } from '../../src/common/clock.js';
import type {
  AlertsPort,
  ObservedEvent,
  SystemEvent,
  SystemNotifier,
} from '../../src/monitor/ports.js';

/** Time only moves when told to; `sleep` advances it instantly. */
export class FakeClock extends Clock {
  private current: number;
  readonly sleeps: number[] = [];

  constructor(start = '2026-01-01T12:00:00.000Z') {
    super();
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export class FakeNotifier implements SystemNotifier {
  readonly sent: SystemEvent[] = [];
  fail = false;

  async send(event: SystemEvent): Promise<void> {
    if (this.fail) throw new Error('notifier down');
    this.sent.push(event);
  }
}

export class RecordingAlerts implements AlertsPort {
  readonly batches: ObservedEvent[][] = [];
  notificationsSent = 0;

  async handleObservations(events: ObservedEvent[]) {
    this.batches.push(events);
    return { notificationsSent: this.notificationsSent };
  }
}

/** Records alerts; `failAll` makes every channel fail, `failChannels` only the named ones. */
export class FakeDelivery implements AlertDelivery {
  readonly requests: DeliveryRequest[] = [];
  failAll = false;
  failChannels = new Set<string>();

  async deliver(request: DeliveryRequest): Promise<ChannelResult[]> {
    this.requests.push(request);
    const channels =
      request.channels.length > 0 ? request.channels : ['default'];
    return channels.map((channel) =>
      this.failAll || this.failChannels.has(channel)
        ? { channel, ok: false, error: 'channel down' }
        : { channel, ok: true },
    );
  }
}
