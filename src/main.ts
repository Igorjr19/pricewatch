#!/usr/bin/env node
import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module.js';

async function bootstrap() {
  await CommandFactory.run(CliModule, ['error', 'warn']);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
