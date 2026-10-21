#!/usr/bin/env node
// REQ-DX-010: seeds a sample product, fixture listings and a rule on a local `file:` database.
// Usage: pnpm dev:seed, then PW_FETCH_FIXTURES_DIR=test/fixtures pnpm start
import { mkdirSync } from 'node:fs';

const url = process.env.PW_DATABASE_URL ?? 'file:data/dev.db';
if (!url.startsWith('file:')) {
  console.error(
    `dev:seed only writes to a local file: database, got ${url.split(':')[0]}:`,
  );
  process.exit(1);
}
if (url.startsWith('file:data/')) mkdirSync('data', { recursive: true });

const { openDatabase, runMigrations } = await import('../dist/db/database.js');
const { newId } = await import('../dist/common/ids.js');
const { products, listings, rules } = await import('../dist/db/schema.js');
const { KabumAdapter } = await import(
  '../dist/monitor/adapters/stores/kabum.adapter.js'
);

const handle = await openDatabase({ url });
try {
  await runMigrations(handle.db);
  const now = new Date().toISOString();
  const adapter = new KabumAdapter();
  const productId = newId();
  const stamps = { createdAt: now, updatedAt: now };
  await handle.db.batch([
    handle.db.insert(products).values({
      id: productId,
      name: 'Sample phone (fixture)',
      ...stamps,
    }),
    handle.db.insert(listings).values(
      [
        'https://www.kabum.com.br/produto/703054',
        'https://www.kabum.com.br/produto/1029920',
      ].map((raw) => ({
        id: newId(),
        productId,
        adapterId: adapter.id,
        url: adapter.normalizeUrl(new URL(raw)).toString(),
        nextCheckAt: now,
        ...stamps,
      })),
    ),
    handle.db.insert(rules).values({
      id: newId(),
      productId,
      type: 'target_price',
      params: { targetCents: 600_000 },
      channels: [],
      ...stamps,
    }),
  ]);
  console.log(`seeded product ${productId} in ${url}`);
} finally {
  handle.close();
}
