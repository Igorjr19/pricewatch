import type { Config } from '../../../config/config.js';
import type { StoreAdapter } from '../types.js';
import { KabumAdapter } from './kabum.adapter.js';
import { MercadoLivreAdapter } from './mercadolivre.adapter.js';

/** Real store adapters. `mercadolivre` may be blocked over `http` from some IPs (spec 14, A1). */
export function builtinAdapters(_config: Config): StoreAdapter[] {
  return [new KabumAdapter(), new MercadoLivreAdapter()];
}
