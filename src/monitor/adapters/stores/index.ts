import type { Config } from '../../../config/config.js';
import type { StoreAdapter } from '../types.js';

/** Real store adapters (build step 7). None yet: `kabum` and `mercadolivre` land there. */
export function builtinAdapters(_config: Config): StoreAdapter[] {
  return [];
}
