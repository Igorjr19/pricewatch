import { createTransport } from 'nodemailer';
import { emailHtml, emailSubject, emailText } from './message.js';
import {
  type ChannelConfig,
  DeliveryError,
  type NotificationEvent,
  type Notifier,
} from './types.js';

type Smtp = Extract<ChannelConfig, { type: 'smtp' }>;

/** The part of a nodemailer transport this notifier needs, so tests can replace it. */
export interface Mailer {
  sendMail(message: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

export function createMailer(channel: Smtp): Mailer {
  return createTransport({
    host: channel.host,
    port: channel.port,
    secure: channel.secure,
    auth: channel.user
      ? { user: channel.user, pass: channel.pass ?? '' }
      : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  });
}

/** REQ-NOT-011: plain-text body plus simple HTML. */
export class SmtpNotifier implements Notifier {
  constructor(
    private readonly channel: Smtp,
    private readonly mailer: Mailer = createMailer(channel),
  ) {}

  async send(event: NotificationEvent): Promise<void> {
    try {
      await this.mailer.sendMail({
        from: this.channel.from,
        to: this.channel.to,
        subject: emailSubject(event),
        text: emailText(event),
        html: emailHtml(event),
      });
    } catch (error) {
      const code = (error as { responseCode?: number; code?: string }) ?? {};
      // 4xx SMTP replies and connection problems are transient; 5xx replies (bad auth, rejected) are not.
      const permanent =
        typeof code.responseCode === 'number' && code.responseCode >= 500;
      throw new DeliveryError(
        `SMTP error: ${code.responseCode ?? code.code ?? 'unknown'}`,
        !permanent,
      );
    }
  }
}
