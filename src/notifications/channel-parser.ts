import { maskSecret } from './mask.js';
import type { ChannelConfig } from './types.js';

const NAME_PATTERN = /^[a-z0-9_]+$/;
const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export type ParseResult =
  | { ok: true; channel: ChannelConfig }
  | { ok: false; error: string };

/**
 * Parses one `PW_CHANNEL_<NAME>` value (REQ-NOT-001). Errors never echo the URL: it carries secrets.
 * `name` is the lower-cased `<NAME>`.
 */
export function parseChannel(name: string, url: string): ParseResult {
  if (!NAME_PATTERN.test(name))
    return fail('name may only contain letters, digits and underscores');
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
  switch (scheme) {
    case 'telegram':
      return parseTelegram(name, url);
    case 'smtp':
    case 'smtps':
      return parseSmtp(name, url);
    case 'webhook+https':
    case 'webhook+http':
      return parseWebhook(name, url);
    default:
      return fail(
        'unsupported scheme (use telegram://, smtp(s)://, webhook+https://)',
      );
  }
}

export interface ChannelsResult {
  channels: ChannelConfig[];
  /** One entry per invalid channel, prefixed with its env var name. */
  problems: string[];
}

/** Parses every channel; collects all problems instead of stopping at the first. */
export function parseChannels(urls: Record<string, string>): ChannelsResult {
  const channels: ChannelConfig[] = [];
  const problems: string[] = [];
  for (const [name, url] of Object.entries(urls)) {
    const result = parseChannel(name, url);
    if (result.ok) channels.push(result.channel);
    else problems.push(`PW_CHANNEL_${name.toUpperCase()}: ${result.error}`);
  }
  return { channels, problems };
}

/** A channel's identity for logs and API responses, with secrets masked. */
export function describeChannel(channel: ChannelConfig): {
  name: string;
  type: ChannelConfig['type'];
  target: string;
} {
  switch (channel.type) {
    case 'telegram':
      return {
        name: channel.name,
        type: 'telegram',
        target: `${maskSecret(channel.botToken)}@${channel.chatId}`,
      };
    case 'smtp':
      return {
        name: channel.name,
        type: 'smtp',
        target: `${channel.host}:${channel.port} → ${channel.to.join(', ')}`,
      };
    case 'webhook': {
      const target = new URL(channel.url);
      return {
        name: channel.name,
        type: 'webhook',
        target: `${target.origin}${target.pathname}`,
      };
    }
  }
}

function parseTelegram(name: string, url: string): ParseResult {
  const match = /^telegram:\/\/([^@]+)@(.+)$/i.exec(url);
  if (!match) return fail('expected telegram://<bot_token>@<chat_id>');
  const botToken = safeDecode(match[1] as string);
  const chatId = safeDecode(match[2] as string);
  if (!/^\d+:[\w-]+$/.test(botToken))
    return fail('bot token must look like 123456:ABC-def');
  if (!/^(-?\d+|@\w+)$/.test(chatId))
    return fail('chat id must be a number or @channelname');
  return { ok: true, channel: { type: 'telegram', name, botToken, chatId } };
}

function parseSmtp(name: string, url: string): ParseResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail('invalid URL');
  }
  const secure = parsed.protocol === 'smtps:';
  if (!parsed.hostname) return fail('missing host');
  const port = parsed.port ? Number(parsed.port) : secure ? 465 : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return fail('invalid port');

  const from = parsed.searchParams.get('from') ?? '';
  const to = (parsed.searchParams.get('to') ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (!EMAIL_PATTERN.test(from))
    return fail('missing or invalid "from" address');
  if (to.length === 0 || !to.every((address) => EMAIL_PATTERN.test(address))) {
    return fail('missing or invalid "to" address list');
  }

  return {
    ok: true,
    channel: {
      type: 'smtp',
      name,
      host: parsed.hostname,
      port,
      secure,
      user: parsed.username ? safeDecode(parsed.username) : undefined,
      pass: parsed.password ? safeDecode(parsed.password) : undefined,
      from,
      to,
    },
  };
}

function parseWebhook(name: string, url: string): ParseResult {
  let target: URL;
  try {
    target = new URL(url.replace(/^webhook\+/i, ''));
  } catch {
    return fail('invalid URL');
  }
  if (!target.hostname) return fail('missing host');
  const secret = target.searchParams.get('secret') || undefined;
  target.searchParams.delete('secret');
  return {
    ok: true,
    channel: { type: 'webhook', name, url: target.toString(), secret },
  };
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
