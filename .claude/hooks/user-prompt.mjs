#!/usr/bin/env node
/**
 * Hello World — UserPromptSubmit hook
 * Fires before every user message Claude processes.
 * Injects a compact one-liner with current phase, task, and tool names.
 * Keeps hw_* tools top-of-mind throughout the session, not just at start.
 * Also signals Buddy that Claude is about to respond (typing signal).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { request } from 'http';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

const workflow  = safeRead('workflow.json');
const tasks     = safeRead('tasks.json') ?? [];
const caps      = safeRead('capabilities.json');
const direction = safeRead('direction.json');

const phase   = workflow?.phase ?? 'idle';
const taskId  = workflow?.currentTaskId ?? null;

const allTasks    = Array.isArray(tasks) ? tasks : (tasks?.tasks ?? []);
const inProgress  = allTasks.filter(t => t.status === 'in_progress').length;
const pendingCount = allTasks.filter(t => t.status === 'todo').length;

const mcpStatus   = caps?.status === 'running' ? 'mcp:ok' : 'mcp:down';
const unreadNotes = Array.isArray(direction?.notes) ? direction.notes.filter(n => !n.read).length : 0;

function taskSlug(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return id;
  return task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 28);
}

// Compact one-liner — keeps phase + tools in active context window
const parts = [
  `[HW ${mcpStatus}`,
  `phase:${phase}`,
  taskId ? `task:${taskSlug(taskId)}` : 'task:none',
  `active:${inProgress}`,
  `pending:${pendingCount}`,
  unreadNotes > 0 ? `notes:${unreadNotes}` : null,
  `|`,
  `hw_update_task hw_check_approval hw_notify hw_advance_phase hw_record_decision hw_write_handoff hw_store_memory`,
  unreadNotes > 0 ? 'hw_process_direction_note]' : ']',
].filter(Boolean);

process.stdout.write(parts.join(' ') + '\n');

// Signal Buddy: Claude is about to respond.
// This sets hadActivity=true in Buddy so the Stop-hook chime always fires,
// even for pure text responses that produce no PTY or file-change events.
const sync = (() => {
  try { return JSON.parse(readFileSync(join(HW, 'sync.json'), 'utf8')); }
  catch { return null; }
})();
if (sync?.port) {
  const body = JSON.stringify({ type: 'typing', summary: 'Responding...' });
  const req = request(
    {
      hostname: '127.0.0.1',
      port: sync.port,
      method: 'POST',
      path: '/',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'close',
      },
    },
    () => { process.exit(0); }
  );
  req.on('error', () => { process.exit(0); });
  req.write(body);
  req.end();
}
