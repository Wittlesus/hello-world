#!/usr/bin/env node
/**
 * Hello World — SessionStart hook
 * Outputs a checklist-format brief so Claude has a concrete action list, not prose rules.
 * Exploits Claude's training bias to complete ordered checklists.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

const config      = safeRead('config.json');
const workflow    = safeRead('workflow.json');
const state       = safeRead('state.json');
const lastContext = safeRead('last-context.json');
const directionRaw = safeRead('direction.json');
const directions  = Array.isArray(directionRaw)
  ? { vision: '', scope: [], notes: directionRaw }
  : (directionRaw ?? { vision: '', scope: [], notes: [] });
const sessions      = safeRead('sessions.json');
const handoff       = safeRead('restart-handoff.json');
const pendingChanges = safeRead('pending-changes.json');
const crashReport   = safeRead('crash-report.json');

const projectName   = config?.config?.name ?? 'Claude AI Interface';
const phase         = workflow?.phase ?? 'idle';
const currentTaskId = workflow?.currentTaskId ?? null;

const allTasks  = state?.tasks ?? [];
const active    = allTasks.filter(t => t.status === 'in_progress');
const pending   = allTasks.filter(t => t.status === 'todo').slice(0, 5);
const doneCount = allTasks.filter(t => t.status === 'done').length;

const openQs      = (state?.questions ?? []).filter(q => q.status === 'open');
const unreadNotes = (directions.notes ?? []).filter(n => !n.read);
const vision      = directions.vision ?? '';

const lastSession = Array.isArray(sessions)
  ? sessions.filter(s => s.status === 'closed').slice(-1)[0]
  : null;

const resumeFile = lastContext?.file ?? null;
const resumeTask = lastContext?.task ?? null;

// ── Build the brief ──────────────────────────────────────────────

const lines = [];

lines.push(`## Hello World — Session Start`);
lines.push(`Project: ${projectName} | Phase: ${phase.toUpperCase()} | Tasks done: ${doneCount}`);
lines.push('');

// Vision — one line
if (vision) {
  const visionShort = vision.length > 120 ? vision.slice(0, 117) + '...' : vision;
  lines.push(`VISION: ${visionShort}`);
  lines.push('');
}

// Crash report — watcher applied Rust changes on last shutdown
if (crashReport?.appliedCopies?.length > 0) {
  const ageMs = Date.now() - new Date(crashReport.reportedAt).getTime();
  if (ageMs < 24 * 60 * 60 * 1000) { // only surface if under 24h old
    const allOk = crashReport.appliedCopies.every(c => c.status === 'ok');
    lines.push(`## RUST CHANGES APPLIED (watcher fired on last shutdown)`);
    lines.push(`${crashReport.pendingChangesDescription} — applied ${crashReport.reportedAt}`);
    crashReport.appliedCopies.forEach(c => {
      lines.push(`  ${c.status === 'ok' ? '[OK]' : '[FAIL]'} ${c.to}`);
      if (c.errorMessage) lines.push(`       Error: ${c.errorMessage}`);
    });
    if (!allOk) lines.push(`ATTENTION: Some copies failed — check .hello-world/watcher-results.json`);
    lines.push('');
  }
}

// Pending Rust changes — worktree edits not yet applied
const pendingRust = (pendingChanges?.pending ?? []).filter(p => p.status === 'pending');
if (pendingRust.length > 0) {
  lines.push(`## PENDING RUST CHANGES (not yet applied to master)`);
  pendingRust.forEach(p => {
    lines.push(`  [ ] ${p.description}`);
    lines.push(`      from: ${p.fromPath}`);
    lines.push(`      to:   ${p.toPath}`);
  });
  lines.push(`  Apply after app shutdown: cp <from> <to>, then git add + commit`);
  lines.push('');
}

// Restart handoff — highest priority
if (handoff?.message) {
  lines.push(`## RESTART HANDOFF`);
  lines.push(`Written: ${handoff.writtenAt ?? 'unknown'}`);
  lines.push('');
  lines.push(handoff.message);
  lines.push('');
}

// Active task
if (active.length > 0) {
  const t = active[0];
  lines.push(`ACTIVE TASK: ${t.id} — ${t.title}`);
  if (t.description) lines.push(`  ${t.description}`);
  lines.push('');
}

// Resume hint
if (resumeFile) {
  const hint = resumeTask ? `${resumeFile} (task: ${resumeTask})` : resumeFile;
  lines.push(`RESUME HINT: ${hint}`);
  lines.push('');
}

// Ordered checklist — concrete tool calls to make now
lines.push(`YOUR CHECKLIST:`);
lines.push(`[ ] hw_get_context() — full state + handoff check`);
if (active.length > 0) {
  const t = active[0];
  lines.push(`[ ] hw_retrieve_memories("${t.title.slice(0, 50)}") — check pain/wins`);
  lines.push(`[ ] hw_update_task("${t.id}", "in_progress") — confirm active`);
  lines.push(`[ ] hw_advance_phase("build", "${t.id}") — start workflow timer`);
} else if (pending.length > 0) {
  const t = pending[0];
  lines.push(`[ ] hw_list_tasks("todo") — pick next task`);
  lines.push(`[ ] hw_update_task("<id>", "in_progress") — mark it active`);
  lines.push(`[ ] hw_advance_phase("scope") — start workflow`);
} else {
  lines.push(`[ ] hw_list_tasks() — see all tasks`);
  lines.push(`[ ] hw_advance_phase("scope") — begin new work`);
}
lines.push('');

// Unread direction from Pat
if (unreadNotes.length > 0) {
  lines.push(`UNREAD DIRECTION:`);
  unreadNotes.forEach(n => lines.push(`  >> ${n.text}`));
  lines.push('');
}

// Pending tasks
if (pending.length > 0) {
  lines.push(`PENDING TASKS:`);
  pending.forEach(t => lines.push(`  [ ] ${t.id}: ${t.title}`));
  lines.push('');
}

// Open questions
if (openQs.length > 0) {
  lines.push(`OPEN QUESTIONS:`);
  openQs.forEach(q => lines.push(`  ? ${q.id}: ${q.question}`));
  lines.push('');
}

// Last session
if (lastSession?.summary) {
  lines.push(`LAST SESSION: ${lastSession.summary}`);
  lines.push('');
}

// Tool reference — always show, compact
lines.push(`TOOLS (use these actively):`);
lines.push(`  hw_get_context · hw_retrieve_memories · hw_store_memory · hw_update_direction`);
lines.push(`  hw_list_tasks · hw_add_task · hw_update_task`);
lines.push(`  hw_advance_phase · hw_get_workflow_state · hw_check_autonomous_timer`);
lines.push(`  hw_record_decision · hw_add_question · hw_answer_question`);
lines.push(`  hw_check_approval · hw_notify · hw_list_approvals · hw_resolve_approval`);
lines.push(`  hw_write_handoff · hw_record_failure · hw_end_session`);
lines.push('');
lines.push(`## Your Role`);
lines.push(`You are Claude, autonomous developer. Pat steers strategy and approves decisions.`);
lines.push(`- Work the checklist above in order`);
lines.push(`- hw_check_approval() before destructive ops (git push, deploy, delete, architecture changes)`);
lines.push(`- hw_notify() when blocked — DM Pat, don't wait`);
lines.push(`- hw_write_handoff() before any edit that could trigger an app restart`);
lines.push(`- ALL code changes go in a git worktree — never edit main while the app is running`);
lines.push(`- End each work cycle with: "restart app and commit changes?" for Pat to confirm`);

console.log(lines.join('\n'));
