import { z } from 'zod';

/** REQ-ALR-002: params are validated per rule type on creation, edit and before evaluation. */
export const targetPriceParams = z
  .object({ targetCents: z.number().int().positive() })
  .strict();
export const newLowParams = z
  .object({ minHistoryDays: z.number().int().min(0).max(365).default(7) })
  .strict();
export const backInStockParams = z.object({}).strict();

export type TargetPriceParams = z.infer<typeof targetPriceParams>;
export type NewLowParams = z.infer<typeof newLowParams>;
export type BackInStockParams = Record<string, never>;

export type RuleType = 'target_price' | 'new_low' | 'back_in_stock';

export const paramsSchemas = {
  target_price: targetPriceParams,
  new_low: newLowParams,
  back_in_stock: backInStockParams,
} as const;

export function parseRuleParams(
  type: RuleType,
  params: unknown,
): { ok: true; params: unknown } | { ok: false; error: string } {
  const parsed = paramsSchemas[type].safeParse(params ?? {});
  if (parsed.success) return { ok: true, params: parsed.data };
  return {
    ok: false,
    error: parsed.error.issues
      .map((i) => `${i.path.join('.') || 'params'}: ${i.message}`)
      .join('; '),
  };
}
