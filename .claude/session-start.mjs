#!/usr/bin/env node
/**
 * Hello World — SessionStart hook
 * Outputs the project greeting instruction so Claude auto-calls hw_get_context()
 * on the first message of every session, without Pat having to type it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

const config   = safeRead('config.json');
const workflow = safeRead('workflow.json');
const state    = safeRead('state.json');

const name  = config?.config?.name ?? 'Claude AI Interface';
const phase = workflow?.phase ?? 'idle';

const tasks = (state?.tasks ?? [])
  .filter(t => t.status === 'in_progress' || t.status === 'todo')
  .slice(0, 5)
  .map(t => `  - [${t.status}] ${t.title}`)
  .join('\n');

console.log(`hw_get_context() — greet Pat with project name, workflow phase, and active tasks.

Project: ${name} | Phase: ${phase}
${tasks ? `Active tasks:\n${tasks}` : 'No active tasks.'}

Call hw_get_context() immediately and greet Pat. Do not wait for further instructions.`);
