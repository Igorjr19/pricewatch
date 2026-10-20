import { Module } from '@nestjs/common';
import { MigrateCommand } from './migrate.command.js';
import { RunCommand } from './run.command.js';
import { ServeCommand } from './serve.command.js';

@Module({ providers: [ServeCommand, RunCommand, MigrateCommand] })
export class CliModule {}
