import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type DatabaseHandle,
  openDatabase,
  runMigrations,
} from '../../src/db/database.js';
import { products } from '../../src/db/schema.js';

const handles: DatabaseHandle[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

async function open(url: string) {
  const handle = await openDatabase({ url });
  handles.push(handle);
  return handle;
}

async function schemaOf(handle: DatabaseHandle): Promise<string> {
  const result = await handle.client.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
  );
  return JSON.stringify(result.rows);
}

describe('REQ-DB-004 migrate is idempotent', () => {
  it('second run succeeds and leaves the schema unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-db-'));
    dirs.push(dir);
    const handle = await open(`file:${join(dir, 'test.db')}`);

    await runMigrations(handle.db);
    const first = await schemaOf(handle);
    await runMigrations(handle.db);

    expect(await schemaOf(handle)).toBe(first);
    expect(JSON.parse(first).length).toBeGreaterThanOrEqual(8);
  });
});

describe('REQ-DB-002 supported URLs', () => {
  it('works with file::memory:', async () => {
    const handle = await open('file::memory:');
    await runMigrations(handle.db);
    const now = new Date().toISOString();
    await handle.db
      .insert(products)
      .values({ id: '01TEST', name: 'x', createdAt: now, updatedAt: now });
    expect(await handle.db.select().from(products)).toHaveLength(1);
  });
});

describe('REQ-DB-003 local connection pragmas', () => {
  it('enables WAL and foreign keys on a file database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-db-'));
    dirs.push(dir);
    const handle = await open(`file:${join(dir, 'test.db')}`);

    const journal = await handle.client.execute('PRAGMA journal_mode');
    const foreignKeys = await handle.client.execute('PRAGMA foreign_keys');
    expect(String(journal.rows[0]?.[0])).toBe('wal');
    expect(Number(foreignKeys.rows[0]?.[0])).toBe(1);
  });

  it('rejects a listing that points to a missing product', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-db-'));
    dirs.push(dir);
    const handle = await open(`file:${join(dir, 'test.db')}`);
    await runMigrations(handle.db);

    await expect(
      handle.client.execute(
        "INSERT INTO listings (id, product_id, adapter_id, url, next_check_at, created_at, updated_at) VALUES ('l1','nope','kabum','u','t','t','t')",
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});
