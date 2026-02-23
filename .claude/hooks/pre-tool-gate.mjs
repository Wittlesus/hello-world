#!/usr/bin/env node
/**
 * Hello World — PreToolUse hook (Write|Edit matcher)
 * Fires before every Write or Edit tool call.
 * Hard-blocks dangerous edits (exit code 2). Warns on skipped workflow steps.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

// Read tool input — Claude Code sets env vars; stdin is fallback
let toolCall = null;
try {
  const envInput = process.env.CLAUDE_TOOL_INPUT;
  if (envInput) {
    toolCall = { tool_name: process.env.CLAUDE_TOOL_NAME, tool_input: JSON.parse(envInput) };
  } else {
    const buf = readFileSync('/dev/stdin');
    toolCall = JSON.parse(buf.toString());
  }
} catch { /* not available */ }

const filePath = (toolCall?.tool_input?.file_path ?? toolCall?.tool_input?.path ?? '').replace(/\\/g, '/');

// ── HARD BLOCK: Rust source edits on main workspace ──────────────
// Editing lib.rs while the Tauri app runs in dev mode triggers a recompile,
// kills the app window, kills the PTY, and kills this Claude session.
// Use the worktree workflow instead.

const isRustSource = filePath.includes('/src-tauri/src/') && filePath.endsWith('.rs');
const inWorktree   = filePath.includes('/.claude/worktrees/');

if (isRustSource && !inWorktree) {
  const worktreePath = `${PROJECT}/.claude/worktrees/rust-edits/packages/app/src-tauri/src/lib.rs`;
  process.stdout.write([
    `[HW BLOCK] Refused to edit ${filePath.split('/').pop()} on main workspace.`,
    ``,
    `Editing Rust source while the Tauri app is running kills the Claude session.`,
    `(cargo tauri dev watches src-tauri/src/ -> recompile -> app restart -> PTY death)`,
    ``,
    `WORKTREE FLOW:`,
    `  1. git worktree add .claude/worktrees/rust-edits -b rust/edits-$(date +%Y%m%d)`,
    `  2. hw_write_handoff("editing lib.rs in worktree, changes: ...")`,
    `  3. Edit at: ${worktreePath}`,
    `  4. Write pending entry to .hello-world/pending-changes.json`,
    `  5. hw_notify Pat — wait for app shutdown before applying to master`,
    ``,
  ].join('\n'));
  process.exit(2);
}

// ── Warnings (non-blocking) ───────────────────────────────────────

const workflow = safeRead('workflow.json');
const state    = safeRead('state.json');

const phase      = workflow?.phase ?? 'idle';
const allTasks   = state?.tasks ?? [];
const inProgress = allTasks.filter(t => t.status === 'in_progress');

const warnings = [];

if (phase === 'idle') {
  warnings.push(`[HW WARNING] Workflow phase is IDLE. Did you call hw_advance_phase("scope") first?`);
}

if (inProgress.length === 0) {
  warnings.push(`[HW WARNING] No task is in_progress. Did you call hw_update_task(id, "in_progress") first?`);
}

// Warn if editing other restartable files without a handoff
const RESTARTABLE = ['server.ts', 'main.tsx'];
const isRestartable = RESTARTABLE.some(name => filePath.endsWith(name));

if (isRestartable) {
  const lastHandoff = safeRead('restart-handoff.json');
  if (!lastHandoff?.writtenAt) {
    warnings.push(`[HW WARNING] Editing ${filePath.split('/').pop()} may trigger an app restart. Did you call hw_write_handoff() first?`);
  }
}

if (warnings.length > 0) {
  process.stdout.write(warnings.join('\n') + '\n');
}
