#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('hello-world')
  .description('Autonomous AI workspace — a computer for Claude')
  .version('0.1.0');

program.parse();
