import { Command, CommandRunner } from 'nest-commander';
import { buildRuntime } from '../app/runtime.js';
import { loadConfigOrExit } from './config.js';

/** REQ-RUN-003: exit 0 cycle completed (even with listing failures), 2 lock busy, 1 fatal. */
@Command({ name: 'run', description: 'Run one monitoring cycle and exit' })
export class RunCommand extends CommandRunner {
  async run(): Promise<void> {
    const config = loadConfigOrExit('run');
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
        console.error('Another cycle is running (lock busy)');
        code = 2;
      } else {
        console.log(JSON.stringify(result.summary));
        code = result.summary.status === 'failed' ? 1 : 0;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    } finally {
      runtime?.close();
    }
    process.exit(code);
  }
}
