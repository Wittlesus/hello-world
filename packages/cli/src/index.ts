#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { tasksCommand } from './commands/tasks.js';
import { startCommand } from './commands/start.js';

const program = new Command();

program
  .name('hello-world')
  .description('Autonomous AI workspace — a computer for Claude')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(tasksCommand);
program.addCommand(startCommand);

program.parse();
