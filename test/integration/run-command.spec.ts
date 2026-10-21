import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunCommand } from '../../src/cli/run.command.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { RunLockService } from '../../src/monitor/run-lock.service.js';
import { DeliveryError } from '../../src/notifications/types.js';
import { WebhookNotifier } from '../../src/notifications/webhook.notifier.js';
import { FakeClock } from '../support/fakes.js';

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function dbUrl(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pw-run-'));
  dirs.push(dir);
  return `file:${join(dir, 'run.db')}`;
}

async function runCommand(): Promise<number> {
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await new RunCommand().run();
  const calls = vi.mocked(process.exit).mock.calls;
  return calls[calls.length - 1]?.[0] as number;
}

async function tables(url: string): Promise<string[]> {
  const handle = await openDatabase({ url });
  try {
    const result = await handle.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'listings'",
    );
    return result.rows.map((row) => String(row[0]));
  } finally {
    handle.close();
  }
}

describe('REQ-RUN-003 run exit codes', () => {
  it('exits 0 when the cycle completed', async () => {
    vi.stubEnv('PW_DATABASE_URL', dbUrl());
    expect(await runCommand()).toBe(0);
  });

  it('exits 2 when the lock is busy', async () => {
    const url = dbUrl();
    vi.stubEnv('PW_DATABASE_URL', url);
    const handle = await openDatabase({ url });
    await runMigrations(handle.db);
    const held = await new RunLockService(handle.client).acquire(
      'other',
      new Date(),
      60_000,
    );
    handle.close();
    expect(held).toBe(true);
    expect(await runCommand()).toBe(2);
  });

  it('exits 1 on a fatal error', async () => {
    // A directory that does not exist makes opening the database fail.
    vi.stubEnv('PW_DATABASE_URL', 'file:/nonexistent-dir/x/run.db');
    expect(await runCommand()).toBe(1);
  });
});

describe('REQ-DB-005 PW_AUTO_MIGRATE', () => {
  it('run applies migrations first by default', async () => {
    const url = dbUrl();
    vi.stubEnv('PW_DATABASE_URL', url);
    await runCommand();
    expect(await tables(url)).toEqual(['listings']);
  });

  it('run leaves the schema alone with PW_AUTO_MIGRATE=false', async () => {
    const url = dbUrl();
    vi.stubEnv('PW_DATABASE_URL', url);
    vi.stubEnv('PW_AUTO_MIGRATE', 'false');
    expect(await runCommand()).toBe(1);
    expect(await tables(url)).toEqual([]);
  });
});

describe('REQ-NOT-003 notifier interface', () => {
  it('send rejects on failure instead of returning a status', async () => {
    const notifier = new WebhookNotifier(
      { type: 'webhook', name: 'h', url: 'https://h.local/x' },
      new FakeClock(),
      async () => new Response('nope', { status: 500 }),
    );
    await expect(
      notifier.send({
        version: 1,
        event: 'system.test',
        occurredAt: '2026-01-01T00:00:00.000Z',
        reason: 'x',
      } as never),
    ).rejects.toBeInstanceOf(DeliveryError);
  });
});
