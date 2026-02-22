import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { Project } from '@hello-world/core';

export const initCommand = new Command('init')
  .description('Initialize a new Hello World project')
  .argument('[path]', 'Project directory', '.')
  .option('-n, --name <name>', 'Project name')
  .option('-d, --description <desc>', 'Project description', '')
  .action((path: string, opts: { name?: string; description: string }) => {
    const root = resolve(path);
    const name = opts.name ?? root.split(/[\\/]/).pop() ?? 'unnamed';

    try {
      const project = Project.init(root, name, opts.description);
      console.log(chalk.green('Project initialized:'), chalk.bold(project.config.name));
      console.log(chalk.gray(`  Path: ${root}/.hello-world/`));
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });
