#!/usr/bin/env node
/**
 * Hello World — SessionStart hook
 * Outputs a checklist-format brief so Claude has a concrete action list, not prose rules.
 * Exploits Claude's training bias to complete ordered checklists.
 * Also initializes brain state (decay + session counter reset).
 *
 * 3-layer resilience:
 *   Layer 1: Full context (normal path)
 *   Layer 2: Minimal context from key files + fallback to hw_get_context()
 *   Layer 3: Emergency hardcoded string
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { pathToFileURL } from 'url';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');
const MEMORY_DIR = 'C:/Users/Patri/.claude/projects/C--Users-Patri-CascadeProjects-hello-world/memory';
const TRANSCRIPTS_DIR = 'C:/Users/Patri/.claude/projects/C--Users-Patri-CascadeProjects-hello-world';

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

/**
 * Extract a condensed recap from the previous session's JSONL transcript.
 * Finds the most recent .jsonl file (by mtime), skipping the current session.
 * Returns a string recap or null if unavailable.
 */
function extractPreviousSessionRecap(currentSessionId) {
  try {
    const files = readdirSync(TRANSCRIPTS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const full = join(TRANSCRIPTS_DIR, f);
        return { name: f, path: full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    // Find previous session (skip current, and skip very recent files
    // that might be this session just starting up -- check if file is < 10s old and < 5KB)
    const now = Date.now();
    const prev = files.find(f => {
      const id = basename(f.name, '.jsonl');
      if (id === currentSessionId) return false;
      // Skip files that are likely the current session being initialized
      const ageMs = now - f.mtime;
      const size = statSync(f.path).size;
      if (ageMs < 10000 && size < 5000) return false;
      return true;
    });
    if (!prev) return null;

    const raw = readFileSync(prev.path, 'utf8');
    const jsonLines = raw.trim().split('\n');

    const conversation = [];
    let userNum = 0;

    for (const line of jsonLines) {
      try {
        const obj = JSON.parse(line);

        // User messages
        if (obj.type === 'user' && obj.message?.content) {
          const content = typeof obj.message.content === 'string'
            ? obj.message.content
            : null;
          // Skip tool_result messages (they're system responses, not Pat talking)
          if (!content) continue;
          // Skip messages that are just hook injections
          if (content.startsWith('<system-reminder>')) continue;
          userNum++;
          const short = content.replace(/\n/g, ' ').substring(0, 200);
          conversation.push(`[PAT ${userNum}] ${short}`);
        }

        // Assistant text responses (not tool calls)
        if (obj.type === 'assistant' && obj.message?.content) {
          const texts = obj.message.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join(' ');
          if (texts.length > 20) {
            const short = texts.replace(/\n/g, ' ').substring(0, 200);
            conversation.push(`[CLAUDE] ${short}`);
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    if (conversation.length === 0) return null;

    const sessionId = basename(prev.name, '.jsonl');
    const sessionDate = new Date(prev.mtime).toISOString().split('T')[0];
    const header = `Previous session (${sessionId.substring(0, 8)}..., ${sessionDate}):`;

    // Cap at 40 exchanges to keep it useful but bounded
    const capped = conversation.slice(0, 40);
    const truncated = conversation.length > 40
      ? `\n  ... (${conversation.length - 40} more exchanges)`
      : '';

    return `${header}\n${capped.join('\n')}${truncated}`;
  } catch {
    return null;
  }
}

function writeDiagnostic(error, layer) {
  try {
    if (!existsSync(HW)) mkdirSync(HW, { recursive: true });
    writeFileSync(
      join(HW, 'session-start-error.json'),
      JSON.stringify({
        error: String(error?.message ?? error),
        stack: String(error?.stack ?? ''),
        timestamp: new Date().toISOString(),
        layer,
      }, null, 2),
      'utf8'
    );
  } catch {
    // Diagnostic write failed -- nothing we can do
  }
}

// ── Layer 3: Emergency fallback (hardcoded) ──────────────────────────────
function layer3Emergency(outerError) {
  writeDiagnostic(outerError, 3);
  console.log([
    '## Hello World -- SESSION START FAILED (emergency fallback)',
    '',
    `Project root: ${PROJECT}`,
    `State dir: ${HW}`,
    '',
    'The SessionStart hook crashed completely. No context could be loaded.',
    '',
    'YOUR CHECKLIST:',
    '[ ] hw_get_context() -- load full project state',
    '[ ] hw_retrieve_memories("session start crash") -- check for known issues',
    '[ ] hw_list_tasks() -- find current work',
    '',
    'TOOLS: hw_get_context, hw_retrieve_memories, hw_store_memory, hw_list_tasks,',
    '  hw_add_task, hw_update_task, hw_advance_phase, hw_check_approval,',
    '  hw_notify, hw_write_handoff, hw_record_failure, hw_end_session',
  ].join('\n'));
}

// ── Layer 2: Minimal context from key files ──────────────────────────────
function layer2Minimal(layer1Error) {
  try {
    writeDiagnostic(layer1Error, 2);

    const fragments = [];
    fragments.push('## Hello World -- SESSION START (degraded mode)');
    fragments.push('');
    fragments.push('Layer 1 (full context) failed. Showing minimal context.');
    fragments.push(`Error: ${String(layer1Error?.message ?? layer1Error)}`);
    fragments.push('');

    // Try MEMORY.md (first 50 lines)
    try {
      const memPath = join(MEMORY_DIR, 'MEMORY.md');
      const memContent = readFileSync(memPath, 'utf8');
      const memLines = memContent.split('\n').slice(0, 50).join('\n');
      fragments.push('--- MEMORY.md (first 50 lines) ---');
      fragments.push(memLines);
      fragments.push('');
    } catch {
      fragments.push('MEMORY.md: unreadable');
    }

    // Try active-state.md
    try {
      const asPath = join(MEMORY_DIR, 'active-state.md');
      const asContent = readFileSync(asPath, 'utf8');
      fragments.push('--- active-state.md ---');
      fragments.push(asContent);
      fragments.push('');
    } catch {
      fragments.push('active-state.md: unreadable');
    }

    // Try restart-handoff.json
    try {
      const handoffRaw = readFileSync(join(HW, 'restart-handoff.json'), 'utf8');
      const handoff = JSON.parse(handoffRaw);
      if (handoff?.message) {
        fragments.push('--- restart-handoff.json ---');
        fragments.push(handoff.message);
        fragments.push('');
      }
    } catch {
      fragments.push('restart-handoff.json: unreadable');
    }

    fragments.push('');
    fragments.push('YOUR CHECKLIST:');
    fragments.push('[ ] hw_get_context() -- REQUIRED in degraded mode, load full state');
    fragments.push('[ ] hw_retrieve_memories("session start") -- check for known issues');
    fragments.push('[ ] hw_list_tasks() -- find current work');
    fragments.push('');
    fragments.push('TOOLS: hw_get_context, hw_retrieve_memories, hw_store_memory, hw_list_tasks,');
    fragments.push('  hw_add_task, hw_update_task, hw_advance_phase, hw_check_approval,');
    fragments.push('  hw_notify, hw_write_handoff, hw_record_failure, hw_end_session');

    console.log(fragments.join('\n'));
  } catch (layer2Error) {
    // Layer 2 also failed -- fall through to Layer 3
    layer3Emergency(layer2Error);
  }
}

// ── Layer 1: Full context (normal path) ──────────────────────────────────
try {
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

  const allTasks  = Array.isArray(state?.tasks) ? state.tasks : [];
  const active    = allTasks.filter(t => t.status === 'in_progress');
  const pending   = allTasks.filter(t => t.status === 'todo').slice(0, 5);
  const doneCount = allTasks.filter(t => t.status === 'done').length;

  const openQs      = (Array.isArray(state?.questions) ? state.questions : []).filter(q => q.status === 'open');
  const dirNotes    = Array.isArray(directions.notes) ? directions.notes : [];
  const unreadNotes = dirNotes.filter(n => !n.read);
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
  const pendingRust = (Array.isArray(pendingChanges?.pending) ? pendingChanges.pending : []).filter(p => p.status === 'pending');
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

  // Previous session transcript recap
  try {
    // Get current session ID from environment or sessions list
    const currentSessionId = process.env.CLAUDE_SESSION_ID ?? '';
    const recap = extractPreviousSessionRecap(currentSessionId);
    if (recap) {
      lines.push('## LAST SESSION TRANSCRIPT');
      lines.push(recap);
      lines.push('');
    }
  } catch {
    // Non-fatal -- skip recap
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

  // ── Brain state init (decay + session reset) ──────────────────────────────

  try {
    const DIST_BRAIN = join(PROJECT, 'packages/core/dist/brain');
    const stateUrl = pathToFileURL(join(DIST_BRAIN, 'state.js')).href;
    const { initBrainState } = await import(stateUrl);

    // Read existing brain-state.json (handle wrapped or bare)
    const brainStateRaw = safeRead('brain-state.json');
    let existing = brainStateRaw;
    if (brainStateRaw && brainStateRaw.state && typeof brainStateRaw.state === 'object' && !Array.isArray(brainStateRaw.state)) {
      existing = brainStateRaw.state;
    }

    // Apply decay and reset session counters
    const freshState = initBrainState(existing || undefined);

    // Write atomically
    const brainStatePath = join(HW, 'brain-state.json');
    const tmp = brainStatePath + '.tmp';
    writeFileSync(tmp, JSON.stringify({ state: freshState }, null, 2), 'utf8');
    renameSync(tmp, brainStatePath);

    lines.push('BRAIN: State initialized (decay applied, session counters reset).');
    lines.push('');
  } catch {
    // Brain init is non-fatal
  }

  // ── Generate claude-usage.json from stats-cache ────────────────
  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const cachePath = join(home, '.claude', 'stats-cache.json');
    if (existsSync(cachePath)) {
      const raw = JSON.parse(readFileSync(cachePath, 'utf8'));
      const PRICING = {
        'claude-opus-4-6':            { input: 15e-6,  output: 75e-6,  cw: 18.75e-6, cr: 1.5e-6 },
        'claude-sonnet-4-5-20250929': { input: 3e-6,   output: 15e-6,  cw: 3.75e-6,  cr: 0.3e-6 },
        'claude-sonnet-4-6':          { input: 3e-6,   output: 15e-6,  cw: 3.75e-6,  cr: 0.3e-6 },
        'claude-haiku-4-5-20251001':  { input: 0.8e-6, output: 4e-6,   cw: 1e-6,     cr: 0.08e-6 },
      };
      const modelBreakdown = {};
      let totalCost = 0, totalIn = 0, totalOut = 0, totalCR = 0, totalCW = 0;
      for (const [model, u] of Object.entries(raw.modelUsage ?? {})) {
        const p = PRICING[model] ?? Object.values(PRICING)[0];
        const cost = (u.inputTokens * p.input) + (u.outputTokens * p.output)
                   + (u.cacheCreationInputTokens * p.cw) + (u.cacheReadInputTokens * p.cr);
        totalCost += cost; totalIn += u.inputTokens; totalOut += u.outputTokens;
        totalCR += u.cacheReadInputTokens; totalCW += u.cacheCreationInputTokens;
        modelBreakdown[model] = { ...u, costUsd: Math.round(cost * 100) / 100 };
      }
      const dailyTokens = (raw.dailyModelTokens ?? []).map(d => ({
        date: d.date,
        totalTokens: Object.values(d.tokensByModel).reduce((s, v) => s + v, 0),
        byModel: d.tokensByModel,
      }));
      // Carry forward webUsage from previous file (fetched via browser)
      let prevWebUsage = null;
      try {
        const prev = JSON.parse(readFileSync(join(HW, 'claude-usage.json'), 'utf8'));
        if (prev.webUsage) prevWebUsage = prev.webUsage;
      } catch { /* no previous file */ }

      const result = {
        generatedAt: new Date().toISOString(),
        lastComputedDate: raw.lastComputedDate,
        totalSessions: raw.totalSessions ?? 0,
        totalMessages: raw.totalMessages ?? 0,
        totalCostUsd: Math.round(totalCost * 100) / 100,
        totalInputTokens: totalIn, totalOutputTokens: totalOut,
        totalCacheRead: totalCR, totalCacheWrite: totalCW,
        modelBreakdown, dailyActivity: raw.dailyActivity ?? [], dailyTokens,
        firstSessionDate: raw.firstSessionDate, hourCounts: raw.hourCounts ?? {},
        ...(prevWebUsage ? { webUsage: prevWebUsage } : {}),
      };
      const outPath = join(HW, 'claude-usage.json');
      const tmp2 = outPath + '.tmp';
      writeFileSync(tmp2, JSON.stringify(result, null, 2), 'utf8');
      renameSync(tmp2, outPath);
    }
  } catch {
    // Usage generation is non-fatal
  }

  console.log(lines.join('\n'));

} catch (layer1Error) {
  // ── Layer 1 failed -- try Layer 2 ──────────────────────────────────
  layer2Minimal(layer1Error);
}
