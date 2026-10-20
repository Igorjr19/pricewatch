import { describe, expect, it } from 'vitest';
import {
  describeChannel,
  parseChannel,
  parseChannels,
} from '../../src/notifications/channel-parser.js';
import { maskSecret, redact } from '../../src/notifications/mask.js';

function channel(name: string, url: string) {
  const result = parseChannel(name, url);
  if (!result.ok) throw new Error(result.error);
  return result.channel;
}

describe('REQ-NOT-001 channel parser', () => {
  it('parses the spec 9.1 Telegram example', () => {
    expect(channel('phone', 'telegram://123:ABC@-1001234')).toEqual({
      type: 'telegram',
      name: 'phone',
      botToken: '123:ABC',
      chatId: '-1001234',
    });
  });

  it('accepts an @channelname chat id', () => {
    expect(channel('c', 'telegram://123:ABC@@mychannel')).toMatchObject({
      chatId: '@mychannel',
    });
  });

  it('parses the spec 9.1 SMTP example', () => {
    expect(
      channel(
        'mail',
        'smtps://me:secret@smtp.gmail.com:465?from=me@gmail.com&to=me@gmail.com',
      ),
    ).toEqual({
      type: 'smtp',
      name: 'mail',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'me',
      pass: 'secret',
      from: 'me@gmail.com',
      to: ['me@gmail.com'],
    });
  });

  it('SMTP: default ports, multiple recipients, percent-encoded password, no auth', () => {
    expect(
      channel('a', 'smtp://h.example?from=a@b.co&to=x@y.co,z@y.co'),
    ).toMatchObject({
      port: 587,
      secure: false,
      user: undefined,
      to: ['x@y.co', 'z@y.co'],
    });
    expect(
      channel('a', 'smtps://h.example?from=a@b.co&to=x@y.co'),
    ).toMatchObject({ port: 465 });
    expect(
      channel('a', 'smtp://u:p%40ss%3A@h.example?from=a@b.co&to=x@y.co'),
    ).toMatchObject({
      pass: 'p@ss:',
    });
  });

  it('parses the spec 9.1 webhook example and moves the secret out of the URL', () => {
    expect(
      channel('n8n', 'webhook+https://n8n.local/webhook/pw?secret=abc'),
    ).toEqual({
      type: 'webhook',
      name: 'n8n',
      url: 'https://n8n.local/webhook/pw',
      secret: 'abc',
    });
  });

  it('webhook: http allowed, other query params kept, secret optional', () => {
    expect(channel('h', 'webhook+http://host:9000/p?x=1')).toEqual({
      type: 'webhook',
      name: 'h',
      url: 'http://host:9000/p?x=1',
      secret: undefined,
    });
  });

  it.each([
    ['telegram://nobot', 'expected telegram'],
    ['telegram://abc@123', 'bot token'],
    ['telegram://123:ABC@room', 'chat id'],
    ['smtp://h.example?to=x@y.co', 'from'],
    ['smtp://h.example?from=a@b.co', 'to'],
    ['smtp://h.example?from=a@b.co&to=nope', 'to'],
    ['smtp://h.example:99999?from=a@b.co&to=x@y.co', 'invalid URL'],
    ['webhook+https://', 'invalid URL'],
    ['ftp://host', 'unsupported scheme'],
    ['just-text', 'unsupported scheme'],
  ])('rejects %s', (url, hint) => {
    const result = parseChannel('x', url);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(hint);
  });

  it('rejects an invalid channel name', () => {
    expect(parseChannel('my-channel', 'telegram://1:A@2').ok).toBe(false);
  });

  it('REQ-CFG-004 never echoes the URL (secrets) in errors', () => {
    const result = parseChannel(
      'x',
      'smtp://user:hunter2@h.example?from=bad&to=bad',
    );
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('collects every problem, prefixed with the env var name', () => {
    const { channels, problems } = parseChannels({
      good: 'telegram://1:A@2',
      bad_one: 'nope://x',
      bad_two: 'smtp://h?from=a',
    });
    expect(channels.map((c) => c.name)).toEqual(['good']);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^PW_CHANNEL_BAD_ONE:/);
    expect(problems[1]).toMatch(/^PW_CHANNEL_BAD_TWO:/);
  });
});

describe('REQ-CFG-004 masking', () => {
  it('masks secrets to a short prefix', () => {
    expect(maskSecret('telegram-token')).toBe('tele***');
    expect(maskSecret('abc')).toBe('***');
  });

  it('describes channels without secrets', () => {
    const telegram = describeChannel(
      channel('p', 'telegram://123456:ABCDEF@-1001234'),
    );
    expect(telegram.target).toBe('1234***@-1001234');
    expect(telegram.target).not.toContain('ABCDEF');

    const mail = describeChannel(
      channel('m', 'smtps://me:secret@smtp.x.com:465?from=a@b.co&to=c@d.co'),
    );
    expect(JSON.stringify(mail)).not.toContain('secret');

    const hook = describeChannel(
      channel('w', 'webhook+https://h.example/p?secret=topsecret&x=1'),
    );
    expect(JSON.stringify(hook)).not.toContain('topsecret');
    expect(hook.target).toBe('https://h.example/p');
  });

  it('redacts secrets from free text', () => {
    expect(redact('POST https://api/bot123:ABC/send failed', ['123:ABC'])).toBe(
      'POST https://api/bot***/send failed',
    );
    expect(redact('ab stays', ['ab'])).toBe('ab stays');
  });
});
