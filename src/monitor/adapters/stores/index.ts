import type { Config } from '../../../config/config.js';
import type { StoreAdapter } from '../types.js';
import { KabumAdapter } from './kabum.adapter.js';

/** Real store adapters. `mercadolivre` lands once its `http` viability is decided (spec 14, A1). */
export function builtinAdapters(_config: Config): StoreAdapter[] {
  return [new KabumAdapter()];
}
