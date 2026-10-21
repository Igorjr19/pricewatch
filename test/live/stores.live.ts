import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/monitor/adapters/registry.js';
import { builtinAdapters } from '../../src/monitor/adapters/stores/index.js';
import { BlockedError } from '../../src/monitor/adapters/types.js';
import { HttpFetcher } from '../../src/monitor/http.fetcher.js';

// Manual canary: each in-stock fixture URL is fetched for real; a layout change shows up as a failure.
const registry = new AdapterRegistry(builtinAdapters({} as never));
const fetcher = new HttpFetcher({
  userAgent:
    process.env.PW_USER_AGENT ??
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
  timeoutMs: 20_000,
});
const root = resolve('test/fixtures');

for (const folder of readdirSync(root)) {
  const adapter = builtinAdapters({} as never).find((a) => a.id === folder);
  if (!adapter) continue;
  const manifest = JSON.parse(
    readFileSync(join(root, folder, 'manifest.json'), 'utf8'),
  ) as { fixtures: { url: string; expected?: { inStock?: boolean } }[] };
  const urls = manifest.fixtures
    .filter((f) => f.expected?.inStock === true)
    .map((f) => f.url);

  describe(`${folder} live`, () => {
    it.each(urls)('reads a price from %s', async (raw) => {
      const url = adapter.normalizeUrl(new URL(raw));
      expect(registry.resolve(url)?.id).toBe(adapter.id);
      const page = await fetcher.fetch(url, adapter);
      try {
        const result = await adapter.extract({
          strategy: 'http',
          url,
          html: page.html,
          httpStatus: page.status,
          finalUrl: page.finalUrl,
        });
        expect(result.priceCents ?? result.pixPriceCents).toBeGreaterThan(0);
      } catch (error) {
        if (error instanceof BlockedError) {
          console.warn(`${folder}: blocked from this IP (${url})`);
          return;
        }
        throw error;
      }
    });
  });
}
