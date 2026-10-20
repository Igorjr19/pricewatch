import type { Clock } from '../common/clock.js';
import {
  BlockedError,
  type ExtractResult,
  FetchTimeoutError,
  HttpError,
  NotFoundError,
  ParseError,
  type StoreAdapter,
  type Strategy,
} from './adapters/types.js';
import type { PageFetcher } from './ports.js';

export type FetchOutcome =
  | 'ok'
  | 'blocked'
  | 'not_found'
  | 'parse_error'
  | 'http_error'
  | 'timeout'
  | 'strategy_unavailable';

export interface Attempt {
  strategy: Strategy;
  outcome: FetchOutcome;
  startedAt: string;
  durationMs: number;
  httpStatus: number | null;
  errorMessage: string | null;
}

export type CollectResult =
  | {
      outcome: 'ok';
      strategy: Strategy;
      result: ExtractResult;
      attempts: Attempt[];
    }
  | {
      outcome: Exclude<FetchOutcome, 'ok'>;
      reason: string;
      attempts: Attempt[];
    };

const MAX_ERROR_LENGTH = 1000;

export interface CollectorConfig {
  /** `off` in M1: any `browser` strategy is unavailable (REQ-FET-003). */
  browser: string;
}

/** Tries the adapter's strategies in order and records one attempt per try (REQ-CYC-006). */
export class CollectorService {
  constructor(
    private readonly clock: Clock,
    private readonly fetcher: PageFetcher,
    private readonly config: CollectorConfig,
  ) {}

  async collect(adapter: StoreAdapter, url: URL): Promise<CollectResult> {
    const attempts: Attempt[] = [];
    let last: { outcome: Exclude<FetchOutcome, 'ok'>; reason: string } | null =
      null;

    for (const strategy of adapter.strategies) {
      const startedAt = this.clock.now();

      if (!this.isAvailable(adapter, strategy)) {
        attempts.push({
          strategy,
          outcome: 'strategy_unavailable',
          startedAt: startedAt.toISOString(),
          durationMs: 0,
          httpStatus: null,
          errorMessage: null,
        });
        last ??= {
          outcome: 'strategy_unavailable',
          reason: `${strategy} strategy unavailable`,
        };
        continue;
      }

      let httpStatus: number | null = null;
      try {
        const result = await this.run(adapter, strategy, url, (status) => {
          httpStatus = status;
        });
        attempts.push(
          this.attempt(strategy, 'ok', startedAt, httpStatus, null),
        );
        return { outcome: 'ok', strategy, result, attempts };
      } catch (error) {
        const outcome = classify(error);
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(
          this.attempt(strategy, outcome, startedAt, httpStatus, message),
        );
        last = { outcome, reason: message };
        // A block is the only failure another strategy may fix (REQ-FET-006).
        if (outcome !== 'blocked') break;
      }
    }

    return {
      ...(last ?? {
        outcome: 'strategy_unavailable',
        reason: 'adapter has no strategies',
      }),
      attempts,
    };
  }

  private isAvailable(adapter: StoreAdapter, strategy: Strategy): boolean {
    if (strategy === 'browser' && this.config.browser === 'off') return false;
    return adapter.isStrategyAvailable?.(strategy) ?? true;
  }

  private async run(
    adapter: StoreAdapter,
    strategy: Strategy,
    url: URL,
    onStatus: (status: number) => void,
  ): Promise<ExtractResult> {
    if (strategy !== 'http') return adapter.extract({ strategy, url });

    const page = await this.fetcher.fetch(url, adapter);
    onStatus(page.status);
    if (page.status === 403 || page.status === 429) {
      throw new BlockedError(`HTTP ${page.status}`);
    }
    if (page.status >= 500)
      throw new HttpError(`HTTP ${page.status}`, page.status);
    return adapter.extract({
      strategy,
      url,
      html: page.html,
      httpStatus: page.status,
      finalUrl: page.finalUrl,
    });
  }

  private attempt(
    strategy: Strategy,
    outcome: FetchOutcome,
    startedAt: Date,
    httpStatus: number | null,
    errorMessage: string | null,
  ): Attempt {
    return {
      strategy,
      outcome,
      startedAt: startedAt.toISOString(),
      durationMs: this.clock.now().getTime() - startedAt.getTime(),
      httpStatus,
      errorMessage:
        errorMessage === null ? null : errorMessage.slice(0, MAX_ERROR_LENGTH),
    };
  }
}

function classify(
  error: unknown,
): Exclude<FetchOutcome, 'ok' | 'strategy_unavailable'> {
  if (error instanceof BlockedError) return 'blocked';
  if (error instanceof NotFoundError) return 'not_found';
  if (error instanceof ParseError) return 'parse_error';
  if (error instanceof FetchTimeoutError) return 'timeout';
  if (error instanceof HttpError) return 'http_error';
  // Anything unexpected from an adapter is treated as a parse problem, not a crash of the cycle.
  return 'parse_error';
}
