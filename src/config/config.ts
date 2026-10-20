import { z } from 'zod';
import { parseDuration } from './duration.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const duration = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      const ms = parseDuration(value);
      if (ms === null) {
        ctx.addIssue({
          code: 'custom',
          message: `invalid duration "${value}" (use 30s, 15m, 3h, 1d)`,
        });
        return z.NEVER;
      }
      return ms;
    });

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const boolean = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const list = optionalString.transform((value) =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined,
);

const envSchema = z
  .object({
    PW_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    PW_API_TOKEN: optionalString,
    PW_RUN_TOKEN: optionalString,
    PW_TZ: z.string().default('America/Sao_Paulo'),
    PW_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    PW_DATABASE_URL: z
      .string()
      .default('file:/data/pricewatch.db')
      .refine(
        (url) => /^(file:|libsql:\/\/)/.test(url),
        'must start with file: or libsql://',
      ),
    PW_DATABASE_TOKEN: optionalString,
    PW_AUTO_MIGRATE: boolean(true),
    PW_TICK: duration('5m'),
    PW_SCRAPE_INTERVAL: duration('3h'),
    PW_SCRAPE_JITTER: duration('20m'),
    PW_CONCURRENCY: positiveInt(2),
    PW_DOMAIN_DELAY: duration('8s'),
    PW_RUN_MAX_LISTINGS: positiveInt(50),
    PW_RUN_TIMEOUT: duration('10m'),
    PW_MAX_BACKOFF: duration('24h'),
    PW_FETCH_FIXTURES_DIR: optionalString,
    PW_RETENTION_DAYS: positiveInt(90),
    PW_FAILING_THRESHOLD: positiveInt(5),
    PW_HTTP_TIMEOUT: duration('20s'),
    PW_USER_AGENT: z.string().default(DEFAULT_USER_AGENT),
    PW_BROWSER: z.string().default('off'),
    PW_BROWSER_TIMEOUT: duration('45s'),
    PW_ALERT_COOLDOWN: duration('12h'),
    PW_DEFAULT_CHANNELS: list,
    PW_SYSTEM_CHANNELS: list,
    PW_MELI_CLIENT_ID: optionalString,
    PW_MELI_CLIENT_SECRET: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.PW_DATABASE_URL.startsWith('libsql://') && !env.PW_DATABASE_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['PW_DATABASE_TOKEN'],
        message: 'required when PW_DATABASE_URL is libsql://',
      });
    }
    if (env.PW_BROWSER !== 'off') {
      ctx.addIssue({
        code: 'custom',
        path: ['PW_BROWSER'],
        message: 'M1 accepts only "off"',
      });
    }
    if (Boolean(env.PW_MELI_CLIENT_ID) !== Boolean(env.PW_MELI_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PW_MELI_CLIENT_ID'],
        message:
          'PW_MELI_CLIENT_ID and PW_MELI_CLIENT_SECRET must be set together',
      });
    }
  });

export interface Config {
  port: number;
  apiToken?: string;
  runToken?: string;
  tz: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  databaseUrl: string;
  databaseToken?: string;
  autoMigrate: boolean;
  tickMs: number;
  scrapeIntervalMs: number;
  scrapeJitterMs: number;
  concurrency: number;
  domainDelayMs: number;
  runMaxListings: number;
  runTimeoutMs: number;
  maxBackoffMs: number;
  fetchFixturesDir?: string;
  retentionDays: number;
  failingThreshold: number;
  httpTimeoutMs: number;
  userAgent: string;
  browser: string;
  browserTimeoutMs: number;
  alertCooldownMs: number;
  defaultChannels?: string[];
  systemChannels?: string[];
  meliClientId?: string;
  meliClientSecret?: string;
  /** Raw `PW_CHANNEL_<NAME>` values by lower-cased name; parsed and validated by the notifier layer. */
  channelUrls: Record<string, string>;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}

export type Command = 'serve' | 'run' | 'migrate';

/** Validates the environment (REQ-CFG-001/002). Lists every invalid variable, never the secret values. */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  command: Command = 'serve',
): Config {
  const parsed = envSchema.safeParse(env);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join('.') || 'env'}: ${issue.message}`);
    }
  }
  if (command === 'serve' && !env.PW_API_TOKEN) {
    problems.push('PW_API_TOKEN: required for serve');
  }
  if (!parsed.success || problems.length > 0) throw new ConfigError(problems);

  const e = parsed.data;
  const channelUrls: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const match = /^PW_CHANNEL_([A-Z0-9_]+)$/.exec(key);
    if (match && value) channelUrls[match[1].toLowerCase()] = value;
  }

  return {
    port: e.PW_PORT,
    apiToken: e.PW_API_TOKEN,
    runToken: e.PW_RUN_TOKEN ?? e.PW_API_TOKEN,
    tz: e.PW_TZ,
    logLevel: e.PW_LOG_LEVEL,
    databaseUrl: e.PW_DATABASE_URL,
    databaseToken: e.PW_DATABASE_TOKEN,
    autoMigrate: e.PW_AUTO_MIGRATE,
    tickMs: e.PW_TICK,
    scrapeIntervalMs: e.PW_SCRAPE_INTERVAL,
    scrapeJitterMs: e.PW_SCRAPE_JITTER,
    concurrency: e.PW_CONCURRENCY,
    domainDelayMs: e.PW_DOMAIN_DELAY,
    runMaxListings: e.PW_RUN_MAX_LISTINGS,
    runTimeoutMs: e.PW_RUN_TIMEOUT,
    maxBackoffMs: e.PW_MAX_BACKOFF,
    fetchFixturesDir: e.PW_FETCH_FIXTURES_DIR,
    retentionDays: e.PW_RETENTION_DAYS,
    failingThreshold: e.PW_FAILING_THRESHOLD,
    httpTimeoutMs: e.PW_HTTP_TIMEOUT,
    userAgent: e.PW_USER_AGENT,
    browser: e.PW_BROWSER,
    browserTimeoutMs: e.PW_BROWSER_TIMEOUT,
    alertCooldownMs: e.PW_ALERT_COOLDOWN,
    defaultChannels: e.PW_DEFAULT_CHANNELS,
    systemChannels: e.PW_SYSTEM_CHANNELS ?? e.PW_DEFAULT_CHANNELS,
    meliClientId: e.PW_MELI_CLIENT_ID,
    meliClientSecret: e.PW_MELI_CLIENT_SECRET,
    channelUrls,
  };
}
