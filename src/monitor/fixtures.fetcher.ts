import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, type StoreAdapter } from './adapters/types.js';
import type { PageFetcher } from './ports.js';

interface ManifestEntry {
  file: string;
  url?: string;
  httpStatus?: number;
}

/**
 * Development only (REQ-DX-009, `PW_FETCH_FIXTURES_DIR`): answers from the `manifest.json` files under a
 * directory instead of the network. A URL is matched on its normalized form, so tracking parameters and
 * slugs do not matter.
 */
export class FixturesFetcher implements PageFetcher {
  private readonly pages = new Map<string, { status: number; path: string }>();

  constructor(
    private readonly dir: string,
    normalize: (url: URL) => string,
  ) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = join(dir, entry.name);
      let manifest: { fixtures?: ManifestEntry[] };
      try {
        manifest = JSON.parse(
          readFileSync(join(folder, 'manifest.json'), 'utf8'),
        );
      } catch {
        continue;
      }
      for (const fixture of manifest.fixtures ?? []) {
        if (!fixture.url) continue;
        this.pages.set(normalize(new URL(fixture.url)), {
          status: fixture.httpStatus ?? 200,
          path: join(folder, fixture.file),
        });
      }
    }
  }

  async fetch(
    url: URL,
    adapter: StoreAdapter,
  ): Promise<{ status: number; html: string; finalUrl: URL }> {
    const page = this.pages.get(adapter.normalizeUrl(url).toString());
    if (!page) throw new HttpError(`no fixture for ${url}`, 404);
    return {
      status: page.status,
      html: readFileSync(page.path, 'utf8'),
      finalUrl: url,
    };
  }
}
