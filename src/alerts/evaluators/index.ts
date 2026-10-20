import type {
  BackInStockParams,
  NewLowParams,
  RuleType,
  TargetPriceParams,
} from '../params.js';
import { evaluateBackInStock } from './back-in-stock.js';
import { evaluateNewLow } from './new-low.js';
import { evaluateTargetPrice } from './target-price.js';
import type { EvalInput, EvalResult } from './types.js';

export { evaluateBackInStock, evaluateNewLow, evaluateTargetPrice };

/** Pure dispatch (REQ-ALR-001): `params` must already be validated for `type`. */
export function evaluate(
  type: RuleType,
  input: EvalInput<unknown>,
): EvalResult {
  switch (type) {
    case 'target_price':
      return evaluateTargetPrice(input as EvalInput<TargetPriceParams>);
    case 'new_low':
      return evaluateNewLow(input as EvalInput<NewLowParams>);
    case 'back_in_stock':
      return evaluateBackInStock(input as EvalInput<BackInStockParams>);
  }
}
