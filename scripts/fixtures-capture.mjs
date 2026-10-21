#!/usr/bin/env node
// REQ-TST-012: saves a store page as a fixture and appends a manifest entry with the current
// extraction result for manual review. Usage: pnpm fixtures:capture <adapter> <url> [--browser]
// Runs against dist/ (the script builds first). Review the HTML for cookies, tokens and personal data.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [adapterId, rawUrl, flag] = process.argv.slice(2);
if (!adapterId || !rawUrl) {
  console.error('usage: pnpm fixtures:capture <adapter> <url> [--browser]');
  process.exit(1);
}
if (flag === '--browser') {
  console.error('--browser exists from M2 (BrowserFetcher is not implemented)');
  process.exit(1);
}

const { AdapterRegistry } = await import(
  '../dist/monitor/adapters/registry.js'
);
const { builtinAdapters } = await import(
  '../dist/monitor/adapters/stores/index.js'
);
const { DEFAULT_USER_AGENT } = await import('../dist/config/config.js');
const { HttpFetcher } = await import('../dist/monitor/http.fetcher.js');

const registry = new AdapterRegistry(builtinAdapters({}));
const adapter = registry.get(adapterId);
if (!adapter || adapter.id !== adapterId) {
  console.error(`no adapter "${adapterId}" for ${rawUrl}`);
  process.exit(1);
}

const url = adapter.normalizeUrl(new URL(rawUrl));
const fetcher = new HttpFetcher({
  userAgent: process.env.PW_USER_AGENT ?? DEFAULT_USER_AGENT,
  timeoutMs: 20_000,
});
const page = await fetcher.fetch(url, adapter);

let expected;
let expectedError;
try {
  expected = await adapter.extract({
    strategy: 'http',
    url,
    html: page.html,
    httpStatus: page.status,
    finalUrl: page.finalUrl,
  });
} catch (error) {
  expectedError = error?.constructor?.name ?? 'Error';
}

const dir = join('test/fixtures', adapterId);
mkdirSync(dir, { recursive: true });
const kind = expectedError
  ? expectedError.replace(/Error$/, '').toLowerCase()
  : expected.inStock
    ? 'in-stock'
    : 'out-of-stock';
const file = `captured-${kind}-${Date.now()}.html`;
writeFileSync(join(dir, file), page.html);

const manifestPath = join(dir, 'manifest.json');
let manifest = { adapter: adapterId, fixtures: [] };
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {}
manifest.fixtures.push({
  file,
  url: url.toString(),
  capturedAt: new Date().toISOString().slice(0, 10),
  strategy: 'http',
  httpStatus: page.status,
  note: 'REVIEW: rename the file, check the expected values by hand and strip cookies/tokens/personal data',
  ...(expectedError ? { expectedError } : { expected }),
});
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `saved ${join(dir, file)} (${page.html.length} bytes, HTTP ${page.status})`,
);
console.log(
  expectedError ? `extract threw ${expectedError}` : JSON.stringify(expected),
);
