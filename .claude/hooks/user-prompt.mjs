#!/usr/bin/env node
/**
 * Hello World — UserPromptSubmit hook
 * Fires before every user message Claude processes.
 * Injects a compact one-liner with current phase, task, and tool names.
 * Keeps hw_* tools top-of-mind throughout the session, not just at start.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

const workflow = safeRead('workflow.json');
const state    = safeRead('state.json');
const caps     = safeRead('capabilities.json');

const phase   = workflow?.phase ?? 'idle';
const taskId  = workflow?.currentTaskId ?? null;

const allTasks    = state?.tasks ?? [];
const inProgress  = allTasks.filter(t => t.status === 'in_progress').length;
const pendingCount = allTasks.filter(t => t.status === 'todo').length;

const mcpStatus = caps?.status === 'running' ? 'mcp:ok' : 'mcp:down';

// Compact one-liner — keeps phase + tools in active context window
const parts = [
  `[HW ${mcpStatus}`,
  `phase:${phase}`,
  taskId ? `task:${taskId}` : 'task:none',
  `active:${inProgress}`,
  `pending:${pendingCount}`,
  `|`,
  `hw_update_task hw_check_approval hw_notify hw_advance_phase hw_record_decision hw_write_handoff hw_store_memory]`,
];

process.stdout.write(parts.join(' ') + '\n');
