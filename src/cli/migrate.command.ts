import { Command, CommandRunner } from 'nest-commander';
import { ConfigError, loadConfig } from '../config/config.js';
import { openDatabase, runMigrations } from '../db/database.js';

@Command({ name: 'migrate', description: 'Apply database migrations and exit' })
export class MigrateCommand extends CommandRunner {
  async run(): Promise<void> {
    let config: ReturnType<typeof loadConfig>;
    try {
      config = loadConfig(process.env, 'migrate');
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(error.message);
        process.exit(1);
      }
      throw error;
    }
    const handle = await openDatabase({
      url: config.databaseUrl,
      authToken: config.databaseToken,
    });
    try {
      await runMigrations(handle.db);
    } finally {
      handle.close();
    }
  }
}
