import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CliModule } from '../../src/cli/cli.module.js';
import { MigrateCommand } from '../../src/cli/migrate.command.js';
import { RunCommand } from '../../src/cli/run.command.js';
import { ServeCommand } from '../../src/cli/serve.command.js';

describe('REQ-DX-017 CLI wiring', () => {
  it('registers serve, run and migrate commands', async () => {
    const mod = await Test.createTestingModule({
      imports: [CliModule],
    }).compile();
    expect(mod.get(ServeCommand)).toBeInstanceOf(ServeCommand);
    expect(mod.get(RunCommand)).toBeInstanceOf(RunCommand);
    expect(mod.get(MigrateCommand)).toBeInstanceOf(MigrateCommand);
  });
});
