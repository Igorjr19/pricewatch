/** The lower of the Pix and cash prices, ignoring nulls. Basis of all rules. */
export function effectivePriceCents(
  priceCents: number | null,
  pixPriceCents: number | null,
): number | null {
  if (priceCents === null) return pixPriceCents;
  if (pixPriceCents === null) return priceCents;
  return Math.min(priceCents, pixPriceCents);
}
