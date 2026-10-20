import { createHmac } from 'node:crypto';
import type { Clock } from '../common/clock.js';
import { type FetchFn, post } from './http.js';
import type { ChannelConfig, NotificationEvent, Notifier } from './types.js';

type Webhook = Extract<ChannelConfig, { type: 'webhook' }>;

/** REQ-NOT-013: POST of the JSON event; with a secret, HMAC-SHA256 of the body in `X-Pricewatch-Signature`. */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly channel: Webhook,
    private readonly clock: Clock,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(event: NotificationEvent): Promise<void> {
    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.channel.secret) {
      headers['x-pricewatch-signature'] =
        `sha256=${createHmac('sha256', this.channel.secret).update(body).digest('hex')}`;
      headers['x-pricewatch-timestamp'] = String(
        Math.floor(this.clock.now().getTime() / 1000),
      );
    }
    await post(this.fetchFn, this.channel.url, { headers, body });
  }
}
