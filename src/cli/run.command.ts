import { Command, CommandRunner } from 'nest-commander';

/** Exit codes: 0 cycle completed, 2 lock busy, 1 fatal error (REQ-RUN). */
@Command({ name: 'run', description: 'Run one monitoring cycle and exit' })
export class RunCommand extends CommandRunner {
  async run(): Promise<void> {
    throw new Error('run is not implemented yet (build step 3)');
  }
}
