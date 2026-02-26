import { resolve } from 'node:path';
import { Project } from '@hello-world/core';
import chalk from 'chalk';
import { Command } from 'commander';

const STATUS_ICONS: Record<string, string> = {
  todo: chalk.yellow('[ ]'),
  in_progress: chalk.blue('[~]'),
  done: chalk.green('[x]'),
  blocked: chalk.red('[!]'),
};

export const tasksCommand = new Command('tasks')
  .description('List and manage tasks')
  .argument('[path]', 'Project directory', '.')
  .option('-s, --status <status>', 'Filter by status (todo, in_progress, done, blocked)')
  .option('-a, --add <title>', 'Add a new task')
  .action((path: string, opts: { status?: string; add?: string }) => {
    const root = resolve(path);

    try {
      const project = Project.open(root);

      if (opts.add) {
        const task = project.state.addTask(opts.add);
        console.log(chalk.green('Task created:'), task.id, chalk.bold(task.title));
        return;
      }

      const tasks = opts.status
        ? project.state.listTasks(opts.status as any)
        : project.state.listTasks();

      if (tasks.length === 0) {
        console.log(chalk.gray('  No tasks found.'));
        return;
      }

      console.log();
      for (const task of tasks) {
        const icon = STATUS_ICONS[task.status as string] ?? '[ ]';
        const deps =
          task.dependsOn.length > 0
            ? chalk.gray(` (depends on: ${task.dependsOn.join(', ')})`)
            : '';
        const tags = task.tags.length > 0 ? chalk.cyan(` [${task.tags.join(', ')}]`) : '';
        console.log(`  ${icon} ${chalk.gray(task.id)} ${task.title}${deps}${tags}`);
      }
      console.log();
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });
