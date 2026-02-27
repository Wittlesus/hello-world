#!/usr/bin/env node
/**
 * Hello World — PreToolUse hook (Write|Edit matcher)
 * Fires before every Write or Edit tool call.
 * Hard-blocks dangerous edits and untracked work (exit code 2). Warns on workflow gaps.
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Read active project from app config; fall back to hello-world
const DEFAULT_PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const PROJECT = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.hello-world-app.json'), 'utf8'));
    return cfg?.projectPath || DEFAULT_PROJECT;
  } catch {
    return DEFAULT_PROJECT;
  }
})();
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try {
    return JSON.parse(readFileSync(join(HW, file), 'utf8'));
  } catch {
    return null;
  }
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
} catch {
  /* not available */
}

const filePath = (toolCall?.tool_input?.file_path ?? toolCall?.tool_input?.path ?? '').replace(
  /\\/g,
  '/',
);

// ── HARD BLOCK: Rust source edits on main workspace ──────────────
// Editing lib.rs while the Tauri app runs in dev mode triggers a recompile,
// kills the app window, kills the PTY, and kills this Claude session.
// Use the worktree workflow instead.

const isRustSource = filePath.includes('/src-tauri/src/') && filePath.endsWith('.rs');
const inWorktree = filePath.includes('/.claude/worktrees/');

if (isRustSource && !inWorktree) {
  const worktreePath = `${PROJECT}/.claude/worktrees/rust-edits/packages/app/src-tauri/src/lib.rs`;
  process.stdout.write(
    [
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
    ].join('\n'),
  );
  process.exit(2);
}

// ── HARD BLOCKS ──────────────────────────────────────────────────

const workflow = safeRead('workflow.json');
const tasks = safeRead('tasks.json');

const phase = workflow?.phase ?? 'idle';
const allTasks = Array.isArray(tasks) ? tasks : (tasks?.tasks ?? []);
const inProgress = allTasks.filter((t) => t.status === 'in_progress');

// Block 1: No active task
if (inProgress.length === 0) {
  process.stdout.write(
    [
      `[HW BLOCK] No task is in_progress. Cannot write code without an active task.`,
      ``,
      `Fix: hw_update_task(id, "in_progress") to start an existing task,`,
      `  or hw_add_task(title, desc) + hw_update_task(id, "in_progress") for a new one.`,
      ``,
    ].join('\n'),
  );
  process.exit(2);
}

// Block 2: Uncaptured signals with HIGH confidence (user instructions, confirmed corrections)
const signalQueue = safeRead('signal-queue.json');
const queuedSignals = signalQueue?.signals ?? [];
const highPrioritySignals = queuedSignals.filter(s =>
  s.confidence >= 0.8 || s.type === 'user_instruction' || s.type === 'correction_confirmed'
);

if (highPrioritySignals.length > 0) {
  const items = highPrioritySignals.slice(0, 5).map(s =>
    `  - [${s.type}] "${(s.excerpt || '').slice(0, 80)}"`
  ).join('\n');
  process.stdout.write(
    [
      `[HW BLOCK] ${highPrioritySignals.length} uncaptured signal(s) need action before writing code.`,
      ``,
      items,
      ``,
      `Fix: hw_store_memory() for each significant signal, or dismiss noise.`,
      `Then the signal queue clears and you can proceed.`,
      ``,
    ].join('\n'),
  );
  process.exit(2);
}

// Block 3: Hippocampal checkpoint overdue (12+ messages, 3+ traces, no recent memory stored)
const brainStateRaw = safeRead('brain-state.json');
const brainState = brainStateRaw?.state ?? brainStateRaw ?? {};
const msgCount = brainState.messageCount ?? 0;
const activeTraces = brainState.activeTraces?.length ?? 0;
const lastCheckpoint = brainState.lastCheckpointAt ?? brainState.sessionStart ?? '';
const checkpointAge = lastCheckpoint ? (Date.now() - new Date(lastCheckpoint).getTime()) / 60000 : 999;

// Checkpoint is overdue if: 12+ messages, 3+ active traces, and 20+ min since last checkpoint
if (msgCount >= 12 && activeTraces >= 3 && checkpointAge >= 20) {
  process.stdout.write(
    [
      `[HW BLOCK] Memory consolidation overdue (${msgCount} msgs, ${activeTraces} traces, ${Math.round(checkpointAge)}min since checkpoint).`,
      ``,
      `Fix: hw_store_memory() for lessons learned this session.`,
      `This clears the checkpoint and unblocks code edits.`,
      ``,
    ].join('\n'),
  );
  process.exit(2);
}

// Block 4: Workflow phase is idle (should be in scope/plan/build)
if (phase === 'idle') {
  process.stdout.write(
    [
      `[HW BLOCK] Workflow phase is IDLE. Cannot write code outside a workflow.`,
      ``,
      `Fix: hw_advance_phase("scope") or hw_advance_phase("build") to enter a workflow.`,
      ``,
    ].join('\n'),
  );
  process.exit(2);
}

// ── Warnings (non-blocking) ───────────────────────────────────────

const warnings = [];

// Warn if editing restartable files without a handoff
const RESTARTABLE = ['server.ts', 'main.tsx'];
const isRestartable = RESTARTABLE.some((name) => filePath.endsWith(name));

if (isRestartable) {
  const lastHandoff = safeRead('restart-handoff.json');
  if (!lastHandoff?.writtenAt) {
    warnings.push(
      `[HW WARNING] Editing ${filePath.split('/').pop()} may trigger an app restart. Did you call hw_write_handoff() first?`,
    );
  }
}

// Warn if medium-confidence signals exist (not blocking, but nudge)
const medSignals = queuedSignals.filter(s => s.confidence >= 0.5 && s.confidence < 0.8);
if (medSignals.length > 0) {
  warnings.push(
    `[HW WARNING] ${medSignals.length} uncaptured signal(s) pending. Consider hw_store_memory() soon.`,
  );
}

if (warnings.length > 0) {
  process.stdout.write(warnings.join('\n') + '\n');
}
