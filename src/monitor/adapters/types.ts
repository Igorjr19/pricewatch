export type Strategy = 'api' | 'http' | 'browser';

export interface ExtractResult {
  priceCents: number | null;
  pixPriceCents: number | null;
  installments: { count: number; priceCents: number } | null;
  inStock: boolean;
  title: string | null;
  seller: string | null;
  externalId: string | null;
}

export interface ExtractContext {
  strategy: Strategy;
  url: URL;
  /** Present for `http` and `browser`. */
  html?: string;
  httpStatus?: number;
  /** Final URL after redirects, for adapters that detect challenges by path. */
  finalUrl?: URL;
}

export interface StoreAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly domains: string[];
  /** Order of attempt. */
  readonly strategies: Strategy[];
  normalizeUrl(url: URL): URL;
  extract(ctx: ExtractContext): Promise<ExtractResult>;
  /** Lets an adapter declare a strategy unusable right now (e.g. `api` without credentials). */
  isStrategyAvailable?(strategy: Strategy): boolean;
}

/** The store served a block, captcha or anti-bot challenge. */
export class BlockedError extends Error {}
/** The store answered but the product does not exist. */
export class NotFoundError extends Error {}
/** The page is valid but neither price nor stock could be read. Never persist an invented observation. */
export class ParseError extends Error {}
/** Transport-level failure or an unexpected HTTP status. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export class FetchTimeoutError extends Error {}
