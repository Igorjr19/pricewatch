import { Command, CommandRunner } from 'nest-commander';
import { buildRuntime } from '../app/runtime.js';
import { createLogger } from '../common/logger.js';
import { loadConfigOrExit } from './config.js';

/** REQ-RUN-003: exit 0 cycle completed (even with listing failures), 2 lock busy, 1 fatal. */
@Command({ name: 'run', description: 'Run one monitoring cycle and exit' })
export class RunCommand extends CommandRunner {
  async run(): Promise<void> {
    const config = loadConfigOrExit('run');
    const log = createLogger(config.logLevel);
    let code = 1;
    let runtime: Awaited<ReturnType<typeof buildRuntime>> | undefined;
    const abort = new AbortController();
    const onSignal = () => abort.abort();
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    try {
      runtime = await buildRuntime(config);
      const result = await runtime.cycle.run('cli', abort.signal);
      if (result.lockBusy) {
        log.warn('another cycle is running (lock busy)');
        code = 2;
      } else {
        log.info(result.summary, 'cycle finished');
        code = result.summary.status === 'failed' ? 1 : 0;
      }
    } catch (error) {
      log.error(
        { err: error instanceof Error ? error.message : String(error) },
        'cycle failed',
      );
    } finally {
      runtime?.close();
    }
    process.exit(code);
  }
}
