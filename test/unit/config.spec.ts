import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/config.js';
import { parseDuration } from '../../src/config/duration.js';

describe('REQ-CFG-003 durations', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['3h', 10_800_000],
    ['1d', 86_400_000],
  ])('parses %s', (input, ms) => {
    expect(parseDuration(input)).toBe(ms);
  });

  it.each(['', '10', '5x', '-3m', '0s', '1.5h'])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe('REQ-CFG-001 defaults and parsing', () => {
  it('applies the spec 6.1 defaults', () => {
    const config = loadConfig({ PW_API_TOKEN: 'secret' });
    expect(config.port).toBe(8080);
    expect(config.databaseUrl).toBe('file:/data/pricewatch.db');
    expect(config.scrapeIntervalMs).toBe(3 * 3_600_000);
    expect(config.autoMigrate).toBe(true);
    expect(config.runToken).toBe('secret');
    expect(config.browser).toBe('off');
  });

  it('parses PW_CHANNEL_<NAME> into lower-cased named channels (REQ-NOT-001)', () => {
    const config = loadConfig({
      PW_API_TOKEN: 'x',
      PW_CHANNEL_PHONE: 'telegram://1:A@2',
      PW_CHANNEL_N8N: 'webhook+https://h.example/p?secret=s3cret',
    });
    expect(config.channels.map((c) => [c.name, c.type])).toEqual([
      ['phone', 'telegram'],
      ['n8n', 'webhook'],
    ]);
  });

  it('system channels default to the default channels', () => {
    const config = loadConfig({
      PW_API_TOKEN: 'x',
      PW_CHANNEL_A: 'telegram://1:A@2',
      PW_CHANNEL_B: 'telegram://1:A@3',
      PW_DEFAULT_CHANNELS: 'a, b',
    });
    expect(config.systemChannels).toEqual(['a', 'b']);
  });
});

describe('REQ-CFG-002 invalid environment', () => {
  function problems(
    env: NodeJS.ProcessEnv,
    command?: 'serve' | 'run' | 'migrate',
  ): string[] {
    try {
      loadConfig(env, command);
    } catch (error) {
      if (error instanceof ConfigError) return error.problems;
      throw error;
    }
    return [];
  }

  it('lists each invalid variable', () => {
    const list = problems({
      PW_API_TOKEN: 'x',
      PW_PORT: 'abc',
      PW_TICK: '5x',
      PW_LOG_LEVEL: 'loud',
    });
    expect(list).toHaveLength(3);
    expect(list.join('\n')).toMatch(/PW_PORT/);
    expect(list.join('\n')).toMatch(/PW_TICK/);
    expect(list.join('\n')).toMatch(/PW_LOG_LEVEL/);
  });

  it('requires PW_API_TOKEN only for serve', () => {
    expect(problems({}, 'serve')).toEqual(['PW_API_TOKEN: required for serve']);
    expect(problems({}, 'run')).toEqual([]);
    expect(problems({}, 'migrate')).toEqual([]);
  });

  it('requires PW_DATABASE_TOKEN for libsql:// URLs', () => {
    const list = problems({
      PW_API_TOKEN: 'x',
      PW_DATABASE_URL: 'libsql://db.example.com',
    });
    expect(list).toEqual([
      'PW_DATABASE_TOKEN: required when PW_DATABASE_URL is libsql://',
    ]);
  });

  it('accepts only PW_BROWSER=off in M1', () => {
    expect(problems({ PW_API_TOKEN: 'x', PW_BROWSER: 'local' })).toEqual([
      'PW_BROWSER: M1 accepts only "off"',
    ]);
  });

  it('requires both Mercado Livre credentials together', () => {
    expect(
      problems({ PW_API_TOKEN: 'x', PW_MELI_CLIENT_ID: 'id' }),
    ).toHaveLength(1);
  });

  it('REQ-CFG-004 never echoes secret values in the error message', () => {
    const list = problems({
      PW_API_TOKEN: 'super-secret-token',
      PW_PORT: 'abc',
      PW_DATABASE_URL: 'libsql://x',
    });
    expect(list.join('\n')).not.toContain('super-secret-token');
  });
});

describe('REQ-NOT-001 / REQ-NOT-002 channels at boot', () => {
  function problems(
    env: NodeJS.ProcessEnv,
    command?: 'serve' | 'run' | 'migrate',
  ): string[] {
    try {
      loadConfig(env, command);
    } catch (error) {
      if (error instanceof ConfigError) return error.problems;
      throw error;
    }
    return [];
  }

  it('an invalid channel is a configuration error, reported next to the other problems', () => {
    const list = problems({
      PW_API_TOKEN: 'x',
      PW_PORT: 'abc',
      PW_CHANNEL_BAD: 'nope://x',
    });
    expect(list).toHaveLength(2);
    expect(list.join('\n')).toMatch(/PW_CHANNEL_BAD/);
  });

  it('PW_DEFAULT_CHANNELS and PW_SYSTEM_CHANNELS may only name configured channels', () => {
    const list = problems({
      PW_API_TOKEN: 'x',
      PW_CHANNEL_PHONE: 'telegram://1:A@2',
      PW_DEFAULT_CHANNELS: 'phone,ghost',
      PW_SYSTEM_CHANNELS: 'other',
    });
    expect(list).toEqual([
      'PW_DEFAULT_CHANNELS: unknown channel "ghost"',
      'PW_SYSTEM_CHANNELS: unknown channel "other"',
    ]);
  });

  it('does not double-report a channel that is listed but invalid', () => {
    const list = problems({
      PW_API_TOKEN: 'x',
      PW_CHANNEL_BAD: 'nope://x',
      PW_DEFAULT_CHANNELS: 'bad',
    });
    expect(list).toHaveLength(1);
  });

  it('migrate does not validate channels', () => {
    expect(problems({ PW_CHANNEL_BAD: 'nope://x' }, 'migrate')).toEqual([]);
  });

  it('error messages never contain the channel secrets', () => {
    const list = problems({
      PW_API_TOKEN: 'x',
      PW_CHANNEL_MAIL: 'smtp://u:hunter2@h?from=bad&to=bad',
    });
    expect(list.join('\n')).not.toContain('hunter2');
  });
});
