import type { Clock } from '../common/clock.js';
import { DeliveryError } from './types.js';

/** REQ-NOT-005: up to 2 retries, after 2 s and 6 s, only for retryable errors. */
export const RETRY_DELAYS_MS = [2_000, 6_000];

export async function withRetry<T>(
  clock: Clock,
  action: () => Promise<T>,
  delays: number[] = RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const delay = delays[attempt];
      if (
        !(error instanceof DeliveryError) ||
        !error.retryable ||
        delay === undefined
      )
        throw error;
      await clock.sleep(delay);
    }
  }
}
