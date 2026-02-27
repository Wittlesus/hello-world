#!/usr/bin/env node
/**
 * Hello World -- SessionEnd hook
 * Fires when Claude Code session ends.
 * Auto-generates a session summary from activity.json and writes to sessions.json.
 * No LLM needed -- summarizes from logged events.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';

if (process.env.HW_AGENT_MODE) process.exit(0); // Skip for subagents

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

// Find the current session (latest without endedAt, or latest overall)
const sessionsData = safeRead('sessions.json');
if (!sessionsData?.sessions?.length) process.exit(0);

const sessions = sessionsData.sessions;
const current = sessions.findLast(s => !s.endedAt) || sessions[sessions.length - 1];
if (!current) process.exit(0);

const sessionStart = current.startedAt;

// Read activity since session start
const activityData = safeRead('activity.json');
const rawEntries = activityData?.activities ?? activityData?.entries ?? (Array.isArray(activityData) ? activityData : []);
const entries = rawEntries.filter(e => {
  return e.timestamp && e.timestamp >= sessionStart;
});

// Extract key events
const tasksCompleted = [];
const memoriesStored = [];
const phases = [];
const commits = [];
const decisions = [];
const key_actions = [];

for (const e of entries) {
  const type = e.type || e.action || '';
  const msg = e.message || e.details || e.summary || '';

  if (type === 'task_updated' && msg.includes('done')) {
    const title = msg.replace(/.*done[:\s]*/i, '').trim();
    if (title) tasksCompleted.push(title.slice(0, 60));
  }
  if (type === 'memory_stored') {
    memoriesStored.push(msg.slice(0, 60));
  }
  if (type === 'phase_advanced' || type === 'workflow') {
    phases.push(msg.slice(0, 30));
  }
  if (type === 'decision_recorded') {
    decisions.push(msg.slice(0, 60));
  }
  if (msg.includes('commit') || msg.includes('Commit')) {
    commits.push(msg.slice(0, 80));
  }
  // General significant actions
  if (type.includes('build') || type.includes('fix') || type.includes('feature') ||
      msg.includes('shipped') || msg.includes('built') || msg.includes('fixed')) {
    key_actions.push(msg.slice(0, 80));
  }
}

// Build summary
const parts = [];

if (tasksCompleted.length > 0) {
  parts.push(`${tasksCompleted.length} task(s): ${tasksCompleted.slice(0, 3).join(', ')}`);
}
if (decisions.length > 0) {
  parts.push(`${decisions.length} decision(s)`);
}
if (memoriesStored.length > 0) {
  parts.push(`${memoriesStored.length} memories stored`);
}
if (commits.length > 0) {
  parts.push(`${commits.length} commit(s)`);
}

let summary = parts.join('. ');

// If we got nothing from activity, try to extract from tasks in_progress -> done transitions
if (summary.length < 10) {
  const tasksData = safeRead('tasks.json');
  const allTasks = tasksData?.tasks ?? (Array.isArray(tasksData) ? tasksData : []);
  const recentDone = allTasks
    .filter(t => t.status === 'done' && t.completedAt && t.completedAt >= sessionStart)
    .map(t => t.title?.slice(0, 50));

  if (recentDone.length > 0) {
    summary = `Completed: ${recentDone.slice(0, 3).join(', ')}`;
  }
}

// Fallback: count messages
if (summary.length < 10) {
  const msgCount = entries.length;
  summary = msgCount > 0 ? `${msgCount} activity entries logged` : '(no activity recorded)';
}

// Stamp the session
const now = new Date().toISOString();
current.endedAt = current.endedAt || now;
current.summary = summary.slice(0, 250);

// Write atomically
const filePath = join(HW, 'sessions.json');
const tmp = filePath + '.tmp';
writeFileSync(tmp, JSON.stringify(sessionsData, null, 2), 'utf8');
renameSync(tmp, filePath);

process.stderr.write(`[session-end] Summary: ${summary.slice(0, 100)}\n`);
