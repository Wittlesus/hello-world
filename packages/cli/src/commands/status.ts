import { Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { Project, SessionManager, MemoryStore } from '@hello-world/core';

export const statusCommand = new Command('status')
  .description('Show project state summary')
  .argument('[path]', 'Project directory', '.')
  .action((path: string) => {
    const root = resolve(path);

    try {
      const project = Project.open(root);
      const sessions = new SessionManager(root);
      const memoryStore = new MemoryStore(root, project.config.name);

      const sessionList = sessions.list();
      const tasks = project.state.listTasks();
      const decisions = project.state.listDecisions();
      const questions = project.state.listQuestions('open');
      const memories = memoryStore.getAllMemories();

      console.log(chalk.bold.white(`\n  ${project.config.name}`));
      console.log(chalk.gray(`  ${project.config.description || '(no description)'}`));
      console.log();

      // Tasks summary
      const todo = tasks.filter(t => t.status === 'todo').length;
      const inProgress = tasks.filter(t => t.status === 'in_progress').length;
      const done = tasks.filter(t => t.status === 'done').length;
      const blocked = tasks.filter(t => t.status === 'blocked').length;

      console.log(chalk.white('  Tasks:'));
      if (tasks.length === 0) {
        console.log(chalk.gray('    (none)'));
      } else {
        console.log(`    ${chalk.yellow(todo.toString())} todo  ${chalk.blue(inProgress.toString())} active  ${chalk.green(done.toString())} done  ${chalk.red(blocked.toString())} blocked`);
      }

      // Decisions
      if (decisions.length > 0) {
        console.log();
        console.log(chalk.white(`  Decisions: ${decisions.length}`));
        for (const d of decisions.slice(-3)) {
          console.log(chalk.gray(`    - ${d.title}: ${d.chosen}`));
        }
      }

      // Open questions
      if (questions.length > 0) {
        console.log();
        console.log(chalk.white(`  Open questions: ${questions.length}`));
        for (const q of questions) {
          console.log(chalk.yellow(`    ? ${q.question}`));
        }
      }

      // Memory
      console.log();
      const pains = memories.filter(m => m.type === 'pain').length;
      const wins = memories.filter(m => m.type === 'win').length;
      const facts = memories.filter(m => m.type === 'fact').length;
      console.log(chalk.white(`  Memory: ${chalk.red(pains.toString())} pain  ${chalk.green(wins.toString())} win  ${chalk.blue(facts.toString())} fact`));

      // Sessions
      console.log();
      const totalCost = sessionList.reduce((s, sess) => s + sess.costUsd, 0);
      console.log(chalk.white(`  Sessions: ${sessionList.length}  |  Lifetime cost: $${totalCost.toFixed(2)}`));

      console.log();
    } catch (err) {
      console.error(chalk.red('Error:'), (err as Error).message);
      process.exit(1);
    }
  });
