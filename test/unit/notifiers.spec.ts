import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AlertEvent } from '../../src/alerts/events.js';
import type { FetchFn } from '../../src/notifications/http.js';
import {
  emailHtml,
  emailSubject,
  emailText,
  telegramHtml,
} from '../../src/notifications/message.js';
import { withRetry } from '../../src/notifications/retry.js';
import { SmtpNotifier } from '../../src/notifications/smtp.notifier.js';
import { TelegramNotifier } from '../../src/notifications/telegram.notifier.js';
import {
  DeliveryError,
  type SystemNotificationEvent,
} from '../../src/notifications/types.js';
import { WebhookNotifier } from '../../src/notifications/webhook.notifier.js';
import { FakeClock } from '../support/fakes.js';

const alert: AlertEvent = {
  version: 1,
  event: 'alert.triggered',
  occurredAt: '2026-01-01T12:00:00.000Z',
  rule: { id: 'R1', type: 'target_price', params: { targetCents: 200_000 } },
  product: { id: 'P1', name: 'Galaxy <S25> & "FE"' },
  listing: {
    id: 'L1',
    store: 'kabum',
    storeName: 'KaBuM!',
    url: 'https://www.kabum.com.br/produto/1?a=1&b=2',
  },
  price: {
    effectiveCents: 195_000,
    priceCents: 210_000,
    pixCents: 195_000,
    inStock: true,
    previousEffectiveCents: 199_000,
    lowestEverCents: 195_000,
  },
  reason: 'Melhor preço R$ 1.950,00 abaixo do alvo R$ 2.000,00',
};

const system: SystemNotificationEvent = {
  version: 1,
  event: 'system.listing_failing',
  occurredAt: '2026-01-01T12:00:00.000Z',
  listing: { id: 'L1', url: 'https://www.kabum.com.br/produto/1' },
  reason: 'Falhas consecutivas ao ler o anúncio: blocked',
};

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(status = 200): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : 'ok', { status });
  };
  return { fetchFn, calls };
}

describe('REQ-NOT-010 Telegram', () => {
  const channel = {
    type: 'telegram' as const,
    name: 'phone',
    botToken: '123:ABC',
    chatId: '-1001234',
  };

  it('calls sendMessage with HTML parse mode and escaped content', async () => {
    const { fetchFn, calls } = recordingFetch();
    await new TelegramNotifier(channel, fetchFn).send(alert);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.telegram.org/bot123:ABC/sendMessage',
    );
    expect(calls[0]?.init.method).toBe('POST');
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body).toMatchObject({ chat_id: '-1001234', parse_mode: 'HTML' });
    expect(body.text).toContain(
      '<b>Galaxy &lt;S25&gt; &amp; &quot;FE&quot;</b>',
    );
    expect(body.text).toContain('KaBuM!');
    expect(body.text).toContain('Preço: R$ 1.950,00');
    expect(body.text).toContain('À vista: R$ 2.100,00');
    expect(body.text).toContain(alert.reason);
    expect(body.text).toContain(
      'href="https://www.kabum.com.br/produto/1?a=1&amp;b=2"',
    );
  });

  it('omits the cash price when it equals the effective price', () => {
    const same = {
      ...alert,
      price: { ...alert.price, priceCents: 195_000 },
    };
    expect(telegramHtml(same)).not.toContain('À vista');
  });

  it('formats system notices', () => {
    const text = telegramHtml(system);
    expect(text).toContain('Anúncio com falhas');
    expect(text).toContain('Falhas consecutivas');
  });

  it('REQ-CFG-004 does not leak the bot token in errors', async () => {
    const failing: FetchFn = async () => {
      throw Object.assign(new Error('fetch failed'), {
        cause: { code: 'ECONNRESET' },
      });
    };
    const error = await new TelegramNotifier(channel, failing)
      .send(alert)
      .catch((e: DeliveryError) => e);
    expect(error).toBeInstanceOf(DeliveryError);
    expect((error as DeliveryError).retryable).toBe(true);
    expect((error as DeliveryError).message).toBe('network error: ECONNRESET');
    expect((error as DeliveryError).message).not.toContain('123:ABC');
  });
});

describe('REQ-NOT-011 SMTP', () => {
  const channel = {
    type: 'smtp' as const,
    name: 'mail',
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'me',
    pass: 'secret',
    from: 'me@example.com',
    to: ['a@example.com', 'b@example.com'],
  };

  it('sends subject "[pricewatch] <product> — R$ X" with text and HTML bodies', async () => {
    const sent: unknown[] = [];
    const notifier = new SmtpNotifier(channel, {
      sendMail: async (message) => {
        sent.push(message);
      },
    });
    await notifier.send(alert);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'me@example.com',
      to: ['a@example.com', 'b@example.com'],
      subject: '[pricewatch] Galaxy <S25> & "FE" — R$ 1.950,00',
    });
    const message = sent[0] as { text: string; html: string };
    expect(message.text).toContain(
      'https://www.kabum.com.br/produto/1?a=1&b=2',
    );
    expect(message.text).not.toContain('<h3>');
    expect(message.html).toContain(
      '<h3>Galaxy &lt;S25&gt; &amp; &quot;FE&quot;</h3>',
    );
  });

  it('subject without a price', () => {
    const noPrice = {
      ...alert,
      price: { ...alert.price, effectiveCents: null },
    };
    expect(emailSubject(noPrice)).toBe('[pricewatch] Galaxy <S25> & "FE"');
    expect(emailText(system)).toContain('Falhas consecutivas');
    expect(emailHtml(system)).toContain('<p>Falhas consecutivas');
  });

  it.each([
    [{ responseCode: 535 }, false, 'SMTP error: 535'],
    [{ responseCode: 421 }, true, 'SMTP error: 421'],
    [{ code: 'ECONNECTION' }, true, 'SMTP error: ECONNECTION'],
  ])(
    'maps %j to retryable=%s without leaking credentials',
    async (failure, retryable, message) => {
      const notifier = new SmtpNotifier(channel, {
        sendMail: async () => {
          throw Object.assign(new Error('Invalid login: secret'), failure);
        },
      });
      const error = (await notifier
        .send(alert)
        .catch((e: DeliveryError) => e)) as DeliveryError;
      expect(error.retryable).toBe(retryable);
      expect(error.message).toBe(message);
      expect(error.message).not.toContain('secret');
    },
  );
});

describe('REQ-NOT-013 webhook', () => {
  const clock = new FakeClock('2026-01-01T12:00:00.000Z');

  it('acceptance: the receiver recomputes the HMAC-SHA256 of the body with the secret', async () => {
    const { fetchFn, calls } = recordingFetch();
    const notifier = new WebhookNotifier(
      {
        type: 'webhook',
        name: 'n8n',
        url: 'https://n8n.local/webhook/pw',
        secret: 'abc',
      },
      clock,
      fetchFn,
    );
    await notifier.send(alert);

    const { url, init } = calls[0] as Call;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://n8n.local/webhook/pw');
    expect(headers['content-type']).toBe('application/json');
    const expected = createHmac('sha256', 'abc')
      .update(init.body as string)
      .digest('hex');
    expect(headers['x-pricewatch-signature']).toBe(`sha256=${expected}`);
    expect(headers['x-pricewatch-timestamp']).toBe(
      String(Math.floor(clock.now().getTime() / 1000)),
    );
    expect(JSON.parse(init.body as string)).toEqual(alert);
  });

  it('sends no signature headers without a secret', async () => {
    const { fetchFn, calls } = recordingFetch();
    await new WebhookNotifier(
      { type: 'webhook', name: 'h', url: 'http://h.local/x' },
      clock,
      fetchFn,
    ).send(system);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-pricewatch-signature']).toBeUndefined();
    expect(headers['x-pricewatch-timestamp']).toBeUndefined();
  });

  it.each([
    [200, true],
    [204, true],
    [500, false],
    [404, false],
  ])('a %s response is success only for 2xx', async (status, ok) => {
    const { fetchFn } = recordingFetch(status);
    const result = await new WebhookNotifier(
      { type: 'webhook', name: 'h', url: 'https://h.local/x' },
      clock,
      fetchFn,
    )
      .send(alert)
      .then(() => true)
      .catch(() => false);
    expect(result).toBe(ok);
  });
});

describe('REQ-NOT-005 timeout and retries', () => {
  it('passes a 15 s abort signal to every request', async () => {
    const { fetchFn, calls } = recordingFetch();
    await new TelegramNotifier(
      { type: 'telegram', name: 'p', botToken: '1:A', chatId: '1' },
      fetchFn,
    ).send(alert);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries a retryable error twice, after 2 s and 6 s, then succeeds', async () => {
    const clock = new FakeClock();
    let attempts = 0;
    const result = await withRetry(clock, async () => {
      attempts++;
      if (attempts < 3) throw new DeliveryError('HTTP 503', true);
      return 'delivered';
    });
    expect(result).toBe('delivered');
    expect(attempts).toBe(3);
    expect(clock.sleeps).toEqual([2_000, 6_000]);
  });

  it('gives up after 2 retries', async () => {
    const clock = new FakeClock();
    let attempts = 0;
    await expect(
      withRetry(clock, async () => {
        attempts++;
        throw new DeliveryError('HTTP 500', true);
      }),
    ).rejects.toThrow('HTTP 500');
    expect(attempts).toBe(3);
  });

  it('does not retry a 4xx or an unexpected error', async () => {
    const clock = new FakeClock();
    let attempts = 0;
    await expect(
      withRetry(clock, async () => {
        attempts++;
        throw new DeliveryError('HTTP 401', false);
      }),
    ).rejects.toThrow('HTTP 401');
    await expect(
      withRetry(clock, async () => {
        attempts++;
        throw new Error('bug');
      }),
    ).rejects.toThrow('bug');
    expect(attempts).toBe(2);
    expect(clock.sleeps).toEqual([]);
  });

  it('classifies HTTP statuses: 5xx retryable, 4xx not', async () => {
    const channel = {
      type: 'telegram' as const,
      name: 'p',
      botToken: '1:A',
      chatId: '1',
    };
    const e500 = await new TelegramNotifier(
      channel,
      recordingFetch(502).fetchFn,
    )
      .send(alert)
      .catch((e: DeliveryError) => e);
    const e400 = await new TelegramNotifier(
      channel,
      recordingFetch(400).fetchFn,
    )
      .send(alert)
      .catch((e: DeliveryError) => e);
    expect((e500 as DeliveryError).retryable).toBe(true);
    expect((e400 as DeliveryError).retryable).toBe(false);
  });
});
