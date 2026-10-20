import {
  FetchTimeoutError,
  HttpError,
  type StoreAdapter,
} from './adapters/types.js';
import type { PageFetcher } from './ports.js';

const MAX_REDIRECTS = 5;

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpFetcherOptions {
  userAgent: string;
  timeoutMs: number;
  fetchImpl?: FetchImpl;
}

/**
 * REQ-FET-001: pt-BR headers, gzip/br, timeout. Redirects are followed by hand so they can be
 * confined to the adapter's own domains; any other destination is an `http_error`.
 */
export class HttpFetcher implements PageFetcher {
  private readonly fetchImpl: FetchImpl;

  constructor(private readonly options: HttpFetcherOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async fetch(
    url: URL,
    adapter: StoreAdapter,
  ): Promise<{ status: number; html: string; finalUrl: URL }> {
    const allowed = new Set(adapter.domains.map((d) => d.toLowerCase()));
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.request(current);
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current);
        if (!allowed.has(next.hostname.toLowerCase())) {
          throw new HttpError(
            `redirect to a different domain: ${next.hostname}`,
            response.status,
          );
        }
        await response.body?.cancel();
        current = next;
        continue;
      }
      return {
        status: response.status,
        html: await this.readBody(response),
        finalUrl: current,
      };
    }
    throw new HttpError('too many redirects');
  }

  private async request(url: URL): Promise<Response> {
    try {
      return await this.fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: {
          'user-agent': this.options.userAgent,
          'accept-language': 'pt-BR,pt;q=0.9',
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'gzip, br',
        },
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private async readBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): Error {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return new FetchTimeoutError(
        `timeout after ${this.options.timeoutMs} ms`,
      );
    }
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    return new HttpError(`network error: ${code ?? 'unknown'}`);
  }
}
