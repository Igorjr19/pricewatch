import { resolve } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema.js';

export type Database = LibSQLDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  client: Client;
  close(): void;
}

export interface DatabaseOptions {
  url: string;
  authToken?: string;
}

/** Opens the database through Drizzle over @libsql/client (REQ-DB-001/002/003). */
export async function openDatabase({
  url,
  authToken,
}: DatabaseOptions): Promise<DatabaseHandle> {
  const client = createClient({ url, authToken });
  if (url.startsWith('file:')) {
    // PRAGMA journal_mode returns a row, so it goes through execute. In-memory databases ignore WAL.
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA foreign_keys = ON');
  }
  return {
    db: drizzle(client, { schema }),
    client,
    close: () => client.close(),
  };
}

/** Applies pending migrations; idempotent (REQ-DB-004). */
export async function runMigrations(
  db: Database,
  migrationsFolder = resolve('drizzle'),
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
