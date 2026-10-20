import type { ListingView, Obs } from './types.js';

export interface BestPrice {
  listingId: string;
  effectiveCents: number;
  latest: Obs;
  previous: Obs | null;
}

/**
 * Lowest effective price among each active listing's most recent observation, in stock only
 * (glossary "Best product price"). Ties go to the first listing in the input order.
 */
export function bestPrice(listings: ListingView[]): BestPrice | null {
  let best: BestPrice | null = null;
  for (const listing of listings) {
    const { latest } = listing;
    if (
      listing.status !== 'active' ||
      !latest?.inStock ||
      latest.effectivePriceCents === null
    )
      continue;
    if (best === null || latest.effectivePriceCents < best.effectiveCents) {
      best = {
        listingId: listing.listingId,
        effectiveCents: latest.effectivePriceCents,
        latest,
        previous: listing.previous,
      };
    }
  }
  return best;
}
