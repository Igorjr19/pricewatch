import { Command, CommandRunner, Option } from 'nest-commander';

@Command({
  name: 'serve',
  description: 'Start the API and, unless --no-cron, the ticker',
})
export class ServeCommand extends CommandRunner {
  @Option({ flags: '--no-cron', description: 'Disable the internal ticker' })
  parseNoCron() {
    return true;
  }

  async run(): Promise<void> {
    throw new Error('serve is not implemented yet (build step 6)');
  }
}
