#!/usr/bin/env node
// REQ-DX-010: seeds a sample product, fixture listings and a rule on a local `file:` database.
// Usage: pnpm dev:seed, then PW_FETCH_FIXTURES_DIR=test/fixtures pnpm start
import { mkdirSync } from 'node:fs';
import { ulid } from 'ulid';

const url = process.env.PW_DATABASE_URL ?? 'file:data/dev.db';
if (!url.startsWith('file:')) {
  console.error(
    `dev:seed only writes to a local file: database, got ${url.split(':')[0]}:`,
  );
  process.exit(1);
}
if (url.startsWith('file:data/')) mkdirSync('data', { recursive: true });

const { openDatabase, runMigrations } = await import('../dist/db/database.js');
const { products, listings, rules } = await import('../dist/db/schema.js');
const { KabumAdapter } = await import(
  '../dist/monitor/adapters/stores/kabum.adapter.js'
);

const handle = await openDatabase({ url });
try {
  await runMigrations(handle.db);
  const now = new Date().toISOString();
  const adapter = new KabumAdapter();
  const productId = ulid();
  await handle.db.insert(products).values({
    id: productId,
    name: 'Sample phone (fixture)',
    createdAt: now,
    updatedAt: now,
  });
  for (const raw of [
    'https://www.kabum.com.br/produto/703054',
    'https://www.kabum.com.br/produto/1029920',
  ]) {
    await handle.db.insert(listings).values({
      id: ulid(),
      productId,
      adapterId: adapter.id,
      url: adapter.normalizeUrl(new URL(raw)).toString(),
      nextCheckAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  await handle.db.insert(rules).values({
    id: ulid(),
    productId,
    type: 'target_price',
    params: { targetCents: 600_000 },
    channels: [],
    createdAt: now,
    updatedAt: now,
  });
  console.log(`seeded product ${productId} in ${url}`);
} finally {
  handle.close();
}
