#!/usr/bin/env node
/**
 * Hello World — PreToolUse hook (Write|Edit matcher)
 * Fires before every Write or Edit tool call.
 * Outputs warnings if workflow steps were skipped — just-in-time friction.
 * Cannot block execution but warning appears in context at the moment of the tool call.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

// Read stdin — tool call JSON from Claude Code
let input = '';
try {
  const buf = readFileSync('/dev/stdin');
  input = buf.toString();
} catch { /* stdin not available, skip */ }

let toolCall = null;
try { toolCall = JSON.parse(input); } catch { /* not JSON, skip */ }

const workflow = safeRead('workflow.json');
const state    = safeRead('state.json');

const phase      = workflow?.phase ?? 'idle';
const allTasks   = state?.tasks ?? [];
const inProgress = allTasks.filter(t => t.status === 'in_progress');

const warnings = [];

// Warn if writing files while workflow is idle
if (phase === 'idle') {
  warnings.push(`[HW WARNING] Workflow phase is IDLE. Did you call hw_advance_phase("scope") first?`);
}

// Warn if no task is marked in_progress
if (inProgress.length === 0) {
  warnings.push(`[HW WARNING] No task is in_progress. Did you call hw_update_task(id, "in_progress") first?`);
}

// Warn if editing a restartable file without a recent handoff
const filePath = toolCall?.tool_input?.file_path ?? toolCall?.tool_input?.path ?? '';
const RESTARTABLE = ['lib.rs', 'server.ts', 'main.tsx'];
const isRestartable = RESTARTABLE.some(name => filePath.endsWith(name));

if (isRestartable) {
  const lastContext = safeRead('last-context.json');
  const lastHandoff = safeRead('restart-handoff.json');
  // If there's no handoff written, warn
  if (!lastHandoff?.writtenAt) {
    warnings.push(`[HW WARNING] Editing ${filePath.split('/').pop()} which may trigger an app restart. Did you call hw_write_handoff() first?`);
  }
}

if (warnings.length > 0) {
  process.stdout.write(warnings.join('\n') + '\n');
}
