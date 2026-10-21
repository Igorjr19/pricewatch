import pino, { type Logger } from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Credentials never reach the logs (REQ-CFG-004). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-pricewatch-token"]',
  'res.headers["set-cookie"]',
];

/** JSON logs on stdout (D10). Used outside Nest; `LoggerModule` shares the same level and redaction. */
export function createLogger(level: LogLevel): Logger {
  return pino({ level, redact: REDACT_PATHS });
}
