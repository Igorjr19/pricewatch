import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MigrateCommand } from '../../src/cli/migrate.command.js';
import { openDatabase } from '../../src/db/database.js';

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

async function tables(url: string): Promise<string[]> {
  const handle = await openDatabase({ url });
  try {
    const result = await handle.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return result.rows.map((row) => String(row[0]));
  } finally {
    handle.close();
  }
}

describe('REQ-DB-004 migrate command', () => {
  it('runs twice on an empty database without error or schema change', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-migrate-'));
    dirs.push(dir);
    const url = `file:${join(dir, 'cli.db')}`;
    vi.stubEnv('PW_DATABASE_URL', url);
    const exit = vi.spyOn(process, 'exit');

    await new MigrateCommand().run();
    const first = await tables(url);
    await new MigrateCommand().run();

    expect(first).toContain('listings');
    expect(await tables(url)).toEqual(first);
    expect(exit).not.toHaveBeenCalled();
  });

  it('REQ-CFG-002 exits 1 on invalid configuration', async () => {
    vi.stubEnv('PW_DATABASE_URL', 'not a url');
    vi.stubEnv('PW_LOG_LEVEL', 'loud');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(new MigrateCommand().run()).rejects.toThrow('exit');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
