import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { Project, SessionManager, MemoryStore } from '@hello-world/core';

export const startCommand = new Command('start')
  .description('Start a new session — Claude sees the project context')
  .argument('[path]', 'Project directory', '.')
  .action((path: string) => {
    const root = resolve(path);

    try {
      const project = Project.open(root);
      const sessions = new SessionManager(root);
      const memoryStore = new MemoryStore(root, project.config.name);

      // Start session
      const session = sessions.start();
      console.log(chalk.green('Session started:'), session.id);
      console.log();

      // Compile and display context
      const context = sessions.compileContext(
        project.config.name,
        project.state,
        memoryStore,
        project.config.dailyBudgetUsd,
      );

      console.log(chalk.bold.white('--- Context Snapshot ---'));
      console.log();
      console.log(context.compiledText);
      console.log();
      console.log(chalk.bold.white('--- End Context ---'));
      console.log();
      console.log(chalk.gray('Claude would receive this context at session start.'));
      console.log(chalk.gray(`Session #${context.sessionNumber} is active.`));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });
