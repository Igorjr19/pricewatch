import { DeliveryError } from './types.js';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export const DELIVERY_TIMEOUT_MS = 15_000;

/**
 * POST with the 15 s delivery timeout (REQ-NOT-005). Network errors and 5xx are retryable;
 * other non-2xx answers are not. Error messages never include the URL, which may carry a token.
 */
export async function post(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      ...init,
      method: 'POST',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DeliveryError(
      `network error: ${describeNetworkError(error)}`,
      true,
    );
  }
  if (response.status >= 200 && response.status < 300) return response;
  throw new DeliveryError(`HTTP ${response.status}`, response.status >= 500);
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return (
      cause?.code ?? (error.name === 'TimeoutError' ? 'timeout' : error.name)
    );
  }
  return 'unknown';
}
