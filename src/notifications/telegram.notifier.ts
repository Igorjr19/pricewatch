import { type FetchFn, post } from './http.js';
import { telegramHtml } from './message.js';
import type { ChannelConfig, NotificationEvent, Notifier } from './types.js';

type Telegram = Extract<ChannelConfig, { type: 'telegram' }>;

/** REQ-NOT-010: `sendMessage` with `parse_mode=HTML`. */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly channel: Telegram,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(event: NotificationEvent): Promise<void> {
    await post(
      this.fetchFn,
      `https://api.telegram.org/bot${this.channel.botToken}/sendMessage`,
      {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.channel.chatId,
          text: telegramHtml(event),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      },
    );
  }
}
