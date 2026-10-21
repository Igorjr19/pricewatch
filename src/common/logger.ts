import pino, { type Logger, type LoggerOptions } from 'pino';
import type { Config } from '../config/config.js';

export type LogLevel = Config['logLevel'];

/** Credentials never reach the logs (REQ-CFG-004). */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-pricewatch-token"]',
  'res.headers["set-cookie"]',
];

/** One source of truth for level and redaction, shared by the CLI logger and `LoggerModule`. */
export function pinoOptions(level: LogLevel | 'silent'): LoggerOptions {
  return { level, redact: REDACT_PATHS };
}

/** JSON logs on stdout (D10). Used outside Nest. */
export function createLogger(level: LogLevel): Logger {
  return pino(pinoOptions(level));
}
