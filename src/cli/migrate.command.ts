import { Command, CommandRunner } from 'nest-commander';

@Command({ name: 'migrate', description: 'Apply database migrations and exit' })
export class MigrateCommand extends CommandRunner {
  async run(): Promise<void> {
    throw new Error('migrate is not implemented yet (build step 2)');
  }
}
