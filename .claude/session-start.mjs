#!/usr/bin/env node
/**
 * Hello World — SessionStart hook
 * Single source of truth for session context. Replaces the need to call hw_get_context().
 * Creates session, consumes handoff, injects full state so Claude can work immediately.
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Skip hook entirely when running as an agent subprocess (prevents chatroom interference)
if (process.env.HW_AGENT_MODE) process.exit(0);

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');
const MEMORY_DIR = 'C:/Users/Patri/.claude/projects/C--Users-Patri-CascadeProjects-hello-world/memory';

const health = { loaded: [], failed: [] };

function safeRead(file) {
  try {
    const data = JSON.parse(readFileSync(join(HW, file), 'utf8'));
    health.loaded.push(file);
    return data;
  } catch (err) {
    health.failed.push({ file, error: err.code || err.message });
    return null;
  }
}

function safeReadText(path) {
  const label = path.replace(/.*[/\\]/, '');
  try {
    const text = readFileSync(path, 'utf8');
    health.loaded.push(label);
    return text;
  } catch (err) {
    health.failed.push({ file: label, error: err.code || err.message });
    return null;
  }
}

function generateId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

// ── Archive non-idle deliberation ────────────────────────────────
function archiveChatroom() {
  try {
    const chatroom = safeRead('chatroom.json');
    if (!chatroom || chatroom.session?.status === 'idle' || !chatroom.messages?.length) return;

    const deliberationsDir = join(HW, 'deliberations');
    mkdirSync(deliberationsDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const slug = (chatroom.session?.topic ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const filename = `${date}-${slug || chatroom.session?.id || 'session'}.json`;
    writeFileSync(join(deliberationsDir, filename), JSON.stringify(chatroom, null, 2), 'utf-8');

    const empty = { session: { id: '', topic: '', status: 'idle', startedAt: '', startedBy: 'claude', waitingForInput: false, roundNumber: 0 }, agents: [], messages: [] };
    writeFileSync(join(HW, 'chatroom.json'), JSON.stringify(empty, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

// ── Create session entry in sessions.json ────────────────────────
function createSession() {
  try {
    const data = safeRead('sessions.json') ?? { sessions: [] };
    const sessions = data.sessions ?? [];

    // Auto-close orphaned sessions (no endedAt)
    const now = new Date().toISOString();
    const closed = sessions.map(s =>
      s.endedAt ? s : { ...s, endedAt: now, summary: '(orphaned -- auto-closed)' }
    );

    const newSession = {
      id: generateId('s'),
      startedAt: now,
      tasksCompleted: [],
      decisionsMade: [],
      costUsd: 0,
      tokensUsed: 0,
    };

    writeFileSync(join(HW, 'sessions.json'), JSON.stringify({ sessions: [...closed, newSession] }, null, 2), 'utf-8');
    return { session: newSession, number: closed.length + 1 };
  } catch {
    return { session: null, number: '?' };
  }
}

// ── Consume handoff (read + delete) ──────────────────────────────
function consumeHandoff() {
  const handoffPath = join(HW, 'restart-handoff.json');
  try {
    if (!existsSync(handoffPath)) return null;
    const handoff = JSON.parse(readFileSync(handoffPath, 'utf8'));
    unlinkSync(handoffPath); // consume it
    return handoff;
  } catch {
    return null;
  }
}

// ── Run side effects ─────────────────────────────────────────────
archiveChatroom();
const { session: newSession, number: sessionNumber } = createSession();
const handoff = consumeHandoff();

// ── Read state (split files with backward compat) ────────────────
const config       = safeRead('config.json');
const workflow     = safeRead('workflow.json');
const lastContext  = safeRead('last-context.json');
const directionRaw = safeRead('direction.json');
const directions   = Array.isArray(directionRaw)
  ? { vision: '', scope: [], notes: directionRaw }
  : (directionRaw ?? { vision: '', scope: [], notes: [] });
const pendingChanges = safeRead('pending-changes.json');
const crashReport    = safeRead('crash-report.json');
const activeState    = safeReadText(join(MEMORY_DIR, 'active-state.md'));

// Read split state files (B+ storage)
const tasksData     = safeRead('tasks.json');
const decisionsData = safeRead('decisions.json');
const questionsData = safeRead('questions.json');

// Silent fallback to old state.json for migration (no health tracking -- file was migrated)
let oldState = null;
try { oldState = JSON.parse(readFileSync(join(HW, 'state.json'), 'utf8')); } catch { /* expected: file was migrated */ }

const allTasks  = tasksData?.tasks ?? (Array.isArray(tasksData) ? tasksData : null) ?? oldState?.tasks ?? [];
const allDecisions = decisionsData?.decisions ?? (Array.isArray(decisionsData) ? decisionsData : null) ?? oldState?.decisions ?? [];
const allQuestions = questionsData?.questions ?? (Array.isArray(questionsData) ? questionsData : null) ?? oldState?.questions ?? [];

const projectName   = config?.config?.name ?? 'Claude AI Interface';
const phase         = workflow?.phase ?? 'idle';

const active    = allTasks.filter(t => t.status === 'in_progress');
const pending   = allTasks.filter(t => t.status === 'todo');
const doneCount = allTasks.filter(t => t.status === 'done').length;
const blocked   = allTasks.filter(t => t.status === 'blocked');

const decisions   = allDecisions.slice(-5);
const openQs      = allQuestions.filter(q => q.status === 'open');
const unreadNotes = (directions.notes ?? []).filter(n => !n.read);
const vision      = directions.vision ?? '';

const resumeFile = lastContext?.file ?? null;
const resumeTask = lastContext?.task ?? null;

// ── Build the brief ──────────────────────────────────────────────

const lines = [];

lines.push(`## Hello World -- Session #${sessionNumber}`);
lines.push(`Project: ${projectName} | Phase: ${phase.toUpperCase()} | Done: ${doneCount} | Pending: ${pending.length} | Blocked: ${blocked.length}`);
lines.push('');

// Vision
if (vision) {
  const visionShort = vision.length > 120 ? vision.slice(0, 117) + '...' : vision;
  lines.push(`VISION: ${visionShort}`);
  lines.push('');
}

// Crash report -- watcher applied Rust changes on last shutdown
if (crashReport?.appliedCopies?.length > 0) {
  const ageMs = Date.now() - new Date(crashReport.reportedAt).getTime();
  if (ageMs < 24 * 60 * 60 * 1000) {
    const allOk = crashReport.appliedCopies.every(c => c.status === 'ok');
    lines.push(`## RUST CHANGES APPLIED (watcher fired on last shutdown)`);
    lines.push(`${crashReport.pendingChangesDescription} -- applied ${crashReport.reportedAt}`);
    crashReport.appliedCopies.forEach(c => {
      lines.push(`  ${c.status === 'ok' ? '[OK]' : '[FAIL]'} ${c.to}`);
      if (c.errorMessage) lines.push(`       Error: ${c.errorMessage}`);
    });
    if (!allOk) lines.push(`ATTENTION: Some copies failed -- check .hello-world/watcher-results.json`);
    lines.push('');
  }
}

// Pending Rust changes
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

// Restart handoff -- highest priority
if (handoff?.message) {
  lines.push(`## RESTART HANDOFF (consumed)`);
  lines.push(`Written: ${handoff.writtenAt ?? handoff.timestamp ?? 'unknown'}`);
  lines.push('');
  lines.push(handoff.message);
  lines.push('');
}

// Active tasks
if (active.length > 0) {
  lines.push(`ACTIVE TASKS:`);
  active.forEach(t => {
    lines.push(`  [in_progress] ${t.id}: ${t.title}`);
    if (t.description) lines.push(`    ${t.description.slice(0, 120)}`);
  });
  lines.push('');
}

// Resume hint
if (resumeFile) {
  const hint = resumeTask ? `${resumeFile} (task: ${resumeTask})` : resumeFile;
  lines.push(`RESUME HINT: ${hint}`);
  lines.push('');
}

// Unread direction from Pat
if (unreadNotes.length > 0) {
  lines.push(`## UNREAD DIRECTION -- process with hw_process_direction_note before other work`);
  unreadNotes.forEach(n => lines.push(`  [${n.id}] ${n.text}`));
  lines.push('');
}

// Pending tasks (top 7)
if (pending.length > 0) {
  lines.push(`PENDING TASKS:`);
  pending.slice(0, 7).forEach(t => {
    const deps = t.dependsOn?.length ? ` (deps: ${t.dependsOn.join(', ')})` : '';
    lines.push(`  [ ] ${t.id}: ${t.title}${deps}`);
  });
  if (pending.length > 7) lines.push(`  ... and ${pending.length - 7} more`);
  lines.push('');
}

// Blocked tasks
if (blocked.length > 0) {
  lines.push(`BLOCKED TASKS:`);
  blocked.forEach(t => lines.push(`  [blocked] ${t.id}: ${t.title}`));
  lines.push('');
}

// Recent decisions
if (decisions.length > 0) {
  lines.push(`RECENT DECISIONS:`);
  decisions.forEach(d => lines.push(`  - ${d.title}: ${d.chosen}`));
  lines.push('');
}

// Open questions
if (openQs.length > 0) {
  lines.push(`OPEN QUESTIONS:`);
  openQs.forEach(q => lines.push(`  ? ${q.id}: ${q.question}`));
  lines.push('');
}

// Health check -- warn about any failed file reads
if (health.failed.length > 0) {
  lines.push(`## WARNING: ${health.failed.length} file(s) failed to load`);
  health.failed.forEach(f => lines.push(`  [FAIL] ${f.file}: ${f.error}`));
  lines.push(`  Context may be incomplete. Check .hello-world/ for corrupted files.`);
  lines.push('');
}

// Context is complete -- tell Claude to start working
lines.push(`## Ready`);
lines.push(`Session registered. Handoff consumed. Context is complete.`);
lines.push(`You do NOT need to call hw_get_context() -- this hook already loaded everything.`);
lines.push(`Start working immediately: pick up the active task, or grab the next pending one.`);
lines.push('');

// Compact tool reference
lines.push(`TOOLS: hw_list_tasks hw_add_task hw_update_task hw_start_task hw_advance_phase`);
lines.push(`  hw_retrieve_memories hw_store_memory hw_record_decision hw_write_handoff`);
lines.push(`  hw_check_approval hw_notify hw_record_failure hw_end_session`);
lines.push('');

lines.push(`## Rules`);
lines.push(`- hw_check_approval() before destructive ops (git push, deploy, delete)`);
lines.push(`- hw_write_handoff() before any edit that could trigger an app restart`);
lines.push(`- ALL code changes in a git worktree -- never edit main while app is running`);
lines.push(`- hw_notify() when blocked -- DM Pat, don't wait`);

console.log(lines.join('\n'));
