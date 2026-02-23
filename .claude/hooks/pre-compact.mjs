#!/usr/bin/env node
/**
 * Hello World — PreCompact hook
 * Fires before Claude Code compresses context.
 * 1. Appends (or updates) the current session's entry in timeline.md.
 * 2. Updates the current session's costUsd + tokensUsed in sessions.json
 *    by scanning JSONL conversation logs.
 * Idempotent: safe to fire multiple times.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW      = join(PROJECT, '.hello-world');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

function safeReadRaw(file) {
  try { return readFileSync(join(HW, file), 'utf8'); }
  catch { return ''; }
}

// ── Load data ──────────────────────────────────────────────────────────────

const sessions  = safeRead('sessions.json') ?? [];
const activities = safeRead('activity.json') ?? [];
const state     = safeRead('state.json') ?? {};

// Current session = last entry without endedAt
const sessionList   = Array.isArray(sessions) ? sessions : (sessions.sessions ?? []);
const currentSession = sessionList.findLast(s => !s.endedAt);
if (!currentSession) process.exit(0);

const sessionIndex  = sessionList.indexOf(currentSession);
const sessionNumber = sessionIndex + 1;
const sessionId     = currentSession.id;

// ── Resolve task IDs to titles ─────────────────────────────────────────────

const allTasks = state.tasks ?? [];
function taskTitle(id) {
  return allTasks.find(t => t.id === id)?.title ?? id;
}

// ── Extract key events from this session ──────────────────────────────────

const actArr = Array.isArray(activities) ? activities : (activities.activities ?? []);
const sessionStart = new Date(currentSession.startedAt);

const sessionActivities = actArr.filter(a => new Date(a.timestamp) >= sessionStart);

const completions = sessionActivities
  .filter(a => a.type === 'task_updated' && a.description?.startsWith('[DONE]'))
  .map(a => a.description.replace('[DONE]', '').trim());

const decisions = sessionActivities
  .filter(a => a.type === 'decision_recorded')
  .map(a => a.description ?? a.details ?? '');

const phases = sessionActivities
  .filter(a => a.type === 'context_loaded' && a.description?.startsWith('Workflow'))
  .map(a => a.description.replace('Workflow → ', '').toLowerCase());

// Also capture completions via tasksCompleted array on session object
const completedIds = currentSession.tasksCompleted ?? [];
const completedTitles = completedIds.map(taskTitle);

// Merge, deduplicate
const allCompletions = [...new Set([...completions, ...completedTitles])].filter(Boolean);

// ── Format the timeline entry ──────────────────────────────────────────────

const startTime = sessionStart.toLocaleTimeString('en-US', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago'
});
const dateStr = sessionStart.toLocaleDateString('en-US', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Chicago'
}).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');

const lines = [];
lines.push(`## Session ${sessionNumber} -- ${dateStr} (~${startTime} CST)`);

if (allCompletions.length > 0) {
  lines.push('');
  lines.push('### Completed');
  allCompletions.forEach(t => lines.push(`- ${t}`));
}

if (decisions.length > 0) {
  lines.push('');
  lines.push('### Decisions');
  decisions.forEach(d => lines.push(`- ${d}`));
}

if (phases.length > 0) {
  const uniquePhases = [...new Set(phases)];
  lines.push('');
  lines.push(`### Phases: ${uniquePhases.join(' -> ')}`);
}

if (allCompletions.length === 0 && decisions.length === 0 && phases.length === 0) {
  lines.push('');
  lines.push('- (no significant events recorded)');
}

lines.push('');
lines.push(`<!-- session:${sessionId} -->`);

const entry = lines.join('\n');

// ── Read existing timeline.md ──────────────────────────────────────────────

const timelinePath = join(HW, 'timeline.md');
let existing = safeReadRaw('timeline.md');

const marker = `<!-- session:${sessionId} -->`;

if (existing.includes(marker)) {
  // Replace existing entry for this session
  // Find the ## heading before the marker and replace up to the next ## or EOF
  const markerIdx = existing.indexOf(marker);
  // Find start of this session block (last ## before marker)
  const before   = existing.slice(0, markerIdx);
  const headingMatch = before.lastIndexOf('\n## Session ');
  const blockStart = headingMatch >= 0 ? headingMatch + 1 : 0;
  // Find end: next ## heading after marker, or EOF
  const after       = existing.slice(markerIdx + marker.length);
  const nextHeading = after.search(/\n## /);
  const blockEnd    = nextHeading >= 0
    ? markerIdx + marker.length + nextHeading + 1
    : existing.length;

  existing = existing.slice(0, blockStart) + entry + '\n' + existing.slice(blockEnd);
} else {
  // Append new entry before the architecture/feature status sections at the bottom
  // (those are the static reference sections that don't belong in the session log)
  const staticMarker = '\n## Architectural Decisions';
  const staticIdx = existing.indexOf(staticMarker);
  if (staticIdx >= 0) {
    existing = existing.slice(0, staticIdx) + '\n' + entry + '\n' + existing.slice(staticIdx);
  } else {
    existing = existing.trimEnd() + '\n\n' + entry + '\n';
  }
}

writeFileSync(timelinePath, existing, 'utf8');

// ── Cost tracking: scan JSONL for current session token usage ──────────────

const JSONL_DIR = 'C:/Users/Patri/.claude/projects/C--Users-Patri-CascadeProjects-hello-world';

// Pricing per 1M tokens (claude-sonnet-4-x)
const PRICE = {
  input:          3.00,
  cache_creation: 3.75,
  cache_read:     0.30,
  output:        15.00,
};

function computeCost(usage) {
  return (
    (usage.input          * PRICE.input +
     usage.cache_creation * PRICE.cache_creation +
     usage.cache_read     * PRICE.cache_read +
     usage.output         * PRICE.output) / 1_000_000
  );
}

try {
  const sessionStartMs = sessionStart.getTime();
  const sessionEndMs   = currentSession.endedAt
    ? new Date(currentSession.endedAt).getTime()
    : Date.now() + 5 * 60 * 1000; // open session: look up to 5min in future

  const SLACK = 5 * 60 * 1000; // 5 minute boundary slack

  let totalTokens = 0;
  let totalCost   = 0;

  const files = readdirSync(JSONL_DIR).filter(f => f.endsWith('.jsonl'));

  for (const file of files) {
    const filePath = `${JSONL_DIR}/${file}`;
    let content;
    try { content = readFileSync(filePath, 'utf8'); } catch { continue; }

    const lines = content.split('\n').filter(Boolean);
    if (lines.length === 0) continue;

    // Quick check: does this file's time range overlap with the session?
    // Sample first + last line timestamps to avoid parsing everything
    let fileMinMs = Infinity, fileMaxMs = -Infinity;
    for (const idx of [0, Math.floor(lines.length / 2), lines.length - 1]) {
      try {
        const ts = JSON.parse(lines[idx]).timestamp;
        if (ts) {
          const ms = new Date(ts).getTime();
          if (ms < fileMinMs) fileMinMs = ms;
          if (ms > fileMaxMs) fileMaxMs = ms;
        }
      } catch { /* skip */ }
    }

    // No overlap with session window (with slack)
    if (fileMaxMs < sessionStartMs - SLACK || fileMinMs > sessionEndMs + SLACK) continue;

    // Full parse: sum usage records that fall within session window
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        const ts  = rec.timestamp ? new Date(rec.timestamp).getTime() : null;
        if (!ts || ts < sessionStartMs - SLACK || ts > sessionEndMs + SLACK) continue;

        const u = rec.message?.usage;
        if (!u) continue;

        const input          = (u.input_tokens ?? 0);
        const cache_creation = (u.cache_creation_input_tokens ?? 0);
        const cache_read     = (u.cache_read_input_tokens ?? 0);
        const output         = (u.output_tokens ?? 0);

        totalTokens += input + cache_creation + cache_read + output;
        totalCost   += computeCost({ input, cache_creation, cache_read, output });
      } catch { /* skip malformed lines */ }
    }
  }

  // Update sessions.json with real numbers
  if (totalTokens > 0) {
    const sessionsPath = join(HW, 'sessions.json');
    const sessionsRaw  = safeRead('sessions.json');
    const isBare       = Array.isArray(sessionsRaw);
    const list         = isBare ? sessionsRaw : (sessionsRaw?.sessions ?? []);
    const idx          = list.findIndex(s => s.id === sessionId);
    if (idx >= 0) {
      list[idx].tokensUsed = totalTokens;
      list[idx].costUsd    = Math.round(totalCost * 10000) / 10000;
      const out = isBare ? list : { ...sessionsRaw, sessions: list };
      writeFileSync(sessionsPath, JSON.stringify(out, null, 2), 'utf8');
    }
  }
} catch { /* cost tracking is non-fatal */ }
