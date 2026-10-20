import type { StoreAdapter } from './types.js';

/** Resolves the adapter by hostname (REQ-ADP-001). */
export class AdapterRegistry {
  private readonly byId = new Map<string, StoreAdapter>();
  private readonly byDomain = new Map<string, StoreAdapter>();

  constructor(adapters: StoreAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: StoreAdapter): void {
    this.byId.set(adapter.id, adapter);
    for (const domain of adapter.domains)
      this.byDomain.set(domain.toLowerCase(), adapter);
  }

  get(id: string): StoreAdapter | undefined {
    return this.byId.get(id);
  }

  resolve(url: URL): StoreAdapter | undefined {
    return this.byDomain.get(url.hostname.toLowerCase());
  }

  list(): StoreAdapter[] {
    return [...this.byId.values()];
  }

  supportedDomains(): string[] {
    return [...this.byDomain.keys()].sort();
  }
}
