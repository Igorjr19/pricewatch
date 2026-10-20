import { NestFactory } from '@nestjs/core';
import { Command, CommandRunner, Option } from 'nest-commander';
import { ApiModule } from '../api/api.module.js';
import { buildRuntime } from '../app/runtime.js';
import { Ticker } from '../monitor/ticker.js';
import { loadConfigOrExit } from './config.js';

const SHUTDOWN_GRACE_MS = 15_000;

@Command({
  name: 'serve',
  description: 'Start the API and, unless --no-cron, the ticker',
})
export class ServeCommand extends CommandRunner {
  @Option({ flags: '--no-cron', description: 'Disable the internal ticker' })
  parseNoCron() {
    return true;
  }

  async run(_params: string[], options?: { noCron?: boolean }): Promise<void> {
    const config = loadConfigOrExit('serve');
    const shutdownController = new AbortController();
    const runtime = await buildRuntime(config);
    runtime.apiDeps.shutdownSignal = shutdownController.signal;
    const app = await NestFactory.create(ApiModule.register(runtime.apiDeps), {
      logger: ['error', 'warn', 'log'],
    });
    await app.listen(config.port, '0.0.0.0');

    const ticker = options?.noCron
      ? null
      : new Ticker(runtime.cycle, config.tickMs, (error) =>
          console.error(
            'cycle failed:',
            error instanceof Error ? error.message : error,
          ),
        );
    ticker?.start();
    // Pick up listings that came due while the process was down; the run lock prevents overlap.
    if (ticker) void ticker.tick();

    // REQ-RUN-006: stop starting listings, wait up to 15 s for the in-flight ones.
    const shutdown = async () => {
      const force = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
      force.unref();
      shutdownController.abort();
      await ticker?.stop();
      await app.close();
      runtime.close();
      process.exit(0);
    };
    process.once('SIGTERM', () => void shutdown());
    process.once('SIGINT', () => void shutdown());
  }
}
