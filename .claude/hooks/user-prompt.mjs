#!/usr/bin/env node
/**
 * Hello World — UserPromptSubmit hook
 * Fires before every user message Claude processes.
 * 1. Injects a compact one-liner with current phase, task, and tool names.
 * 2. Runs hippocampal retrieval (brain engine) to auto-surface relevant memories.
 * 3. Signals Buddy that Claude is about to respond (typing signal).
 *
 * Brain retrieval is the core addition: reads the user prompt from stdin,
 * runs the 9-stage retrieval pipeline, updates brain-state.json, and
 * injects matched memories into Claude's context window.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join } from 'path';
import { request } from 'http';
import { pathToFileURL } from 'url';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');
const DIST_BRAIN = join(PROJECT, 'packages/core/dist/brain');

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(HW, file), 'utf8')); }
  catch { return null; }
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

const workflow  = safeRead('workflow.json');
const tasksData = safeRead('tasks.json');
const caps      = safeRead('capabilities.json');
const direction = safeRead('direction.json');

const phase   = workflow?.phase ?? 'idle';
const taskId  = workflow?.currentTaskId ?? null;

const allTasks    = Array.isArray(tasksData?.tasks) ? tasksData.tasks : (Array.isArray(tasksData) ? tasksData : []);
const inProgress  = allTasks.filter(t => t.status === 'in_progress').length;
const pendingCount = allTasks.filter(t => t.status === 'todo').length;

// MCP watchdog: verify PID is actually alive, not just what capabilities.json claims
let mcpStatus = 'mcp:down';
if (caps?.status === 'running' && caps?.pid) {
  try {
    process.kill(caps.pid, 0); // signal 0 = existence check
    mcpStatus = 'mcp:ok';
  } catch {
    mcpStatus = 'mcp:dead'; // PID in capabilities.json is stale
  }
} else if (caps?.status === 'running') {
  mcpStatus = 'mcp:ok'; // no PID to check, trust status
}
const unreadNotes = Array.isArray(direction?.notes) ? direction.notes.filter(n => !n.read).length : 0;

function taskSlug(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return id;
  return task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 28);
}

// ── Status line (existing, always output first) ─────────────────

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

// ── Brain retrieval ─────────────────────────────────────────────

let brainSignalFiles = [];
let prompt = '';

try {
  // Read user prompt from stdin (synchronous, works on Windows)
  try {
    const raw = readFileSync(0, 'utf8');
    const parsed = JSON.parse(raw);
    prompt = parsed?.prompt ?? '';
  } catch {
    prompt = '';
  }

  // Skip retrieval for empty/short prompts
  if (prompt.length >= 15) {
    // Dynamic import of compiled brain engine (absolute path for reliability)
    const engineUrl = pathToFileURL(join(DIST_BRAIN, 'engine.js')).href;
    const stateUrl = pathToFileURL(join(DIST_BRAIN, 'state.js')).href;

    const { retrieveMemories } = await import(engineUrl);
    const { tickMessageCount, recordSynapticActivity, recordMemoryTraces, shouldCheckpoint } = await import(stateUrl);

    // Load memories (handle wrapped or bare array)
    const memoriesRaw = safeRead('memories.json');
    const memories = Array.isArray(memoriesRaw)
      ? memoriesRaw
      : (memoriesRaw?.memories ?? []);

    // Load brain state (handle wrapped or bare object)
    const brainStateRaw = safeRead('brain-state.json');
    let brainState = brainStateRaw;
    if (brainStateRaw && brainStateRaw.state && typeof brainStateRaw.state === 'object' && !Array.isArray(brainStateRaw.state)) {
      brainState = brainStateRaw.state;
    }
    if (!brainState || typeof brainState !== 'object') {
      brainState = {
        sessionStart: new Date().toISOString(),
        messageCount: 0,
        contextPhase: 'early',
        synapticActivity: {},
        memoryTraces: {},
        firingFrequency: {},
        activeTraces: [],
        significantEventsSinceCheckpoint: 0,
      };
    }

    // Pipeline: tick -> retrieve -> record activity -> record traces
    let state = tickMessageCount(brainState);
    const result = retrieveMemories(prompt, memories, state);
    state = recordSynapticActivity(state, result.matchedTags);

    const surfacedIds = [
      ...result.painMemories.map(sm => sm.memory.id),
      ...result.winMemories.map(sm => sm.memory.id),
    ];
    state = recordMemoryTraces(state, surfacedIds);

    // Write updated brain-state.json (atomic)
    const brainStatePath = join(HW, 'brain-state.json');
    atomicWrite(brainStatePath, { state });
    brainSignalFiles.push('brain-state.json');

    // Output injection text (memories surfaced for Claude)
    if (result.injectionText) {
      process.stdout.write(result.injectionText + '\n');
    }

    // Hippocampal checkpoint signal
    if (shouldCheckpoint(state) && (state.activeTraces?.length ?? 0) >= 3) {
      process.stdout.write(
        '\n[HIPPOCAMPAL CHECKPOINT] Memory consolidation due. ' +
        `Phase: ${state.contextPhase}, messages: ${state.messageCount}, ` +
        `active traces: ${state.activeTraces.length}. ` +
        'Consider hw_store_memory for any new lessons learned this session.\n'
      );
    }
  }
} catch {
  // Brain retrieval is non-fatal. Status line was already output.
}

// ── MCP watchdog: warn if server PID is dead ──────────────────────
if (mcpStatus === 'mcp:dead') {
  process.stdout.write(
    '\n[MCP WATCHDOG] The MCP server process (PID ' + caps.pid + ') is DEAD. ' +
    'All hw_* tools will fail silently. Restart it:\n' +
    '  npm --workspace=packages/core run mcp\n' +
    'Or check if a new instance already started (capabilities.json may be stale).\n\n'
  );
}

// ── Proactive task creation nudge ──────────────────────────────────
try {
  if (prompt && prompt.length >= 10) {
    const { detectActionableItems } =
      await import(pathToFileURL(join(PROJECT, '.claude/hooks/signal-detector.mjs')).href);
    if (detectActionableItems(prompt)) {
      process.stdout.write(
        '\n[ACTIONABLE ITEMS] Pat\'s message contains work items. ' +
        'Scan for implied tasks and hw_add_task() for each before starting work. ' +
        'Multiple items = multiple tasks.\n'
      );
    }
  }
} catch { /* non-fatal */ }

// ── Signal Queue: inject uncaptured signal nudges ─────────────────
try {
  const { peekQueue, flushQueue, formatSignalNudge, detectUserSignals, enqueueSignals } =
    await import(pathToFileURL(join(PROJECT, '.claude/hooks/signal-detector.mjs')).href);

  // Save current user prompt for structural validation in Stop hook
  if (prompt && prompt.length > 10) {
    const queuePath = join(HW, 'signal-queue.json');
    try {
      const q = JSON.parse(readFileSync(queuePath, 'utf8'));
      q.lastUserMessage = prompt.slice(0, 500);
      const tmp = queuePath + '.tmp';
      writeFileSync(tmp, JSON.stringify(q, null, 2), 'utf8');
      renameSync(tmp, queuePath);
    } catch { /* non-fatal */ }

    // Detect signals in user message (pushback, instructions)
    const userSignals = detectUserSignals(prompt);
    if (userSignals.length > 0) {
      enqueueSignals(userSignals);
    }
  }

  // Read queued signals and format nudge
  const queued = peekQueue();
  if (queued.length > 0) {
    const nudge = formatSignalNudge(queued);
    if (nudge) {
      process.stdout.write('\n' + nudge + '\n');
    }
    // Only flush LOW confidence signals automatically.
    // HIGH signals stay in queue until hw_store_memory clears them (enforced by pre-tool-gate).
    const lowOnly = queued.filter(s => s.confidence < 0.5);
    const keepSignals = queued.filter(s => s.confidence >= 0.5);
    if (keepSignals.length > 0) {
      // Rewrite queue with only the signals that need action
      const queuePath = join(HW, 'signal-queue.json');
      try {
        const q = JSON.parse(readFileSync(queuePath, 'utf8'));
        q.signals = keepSignals;
        const tmp = queuePath + '.tmp';
        writeFileSync(tmp, JSON.stringify(q, null, 2), 'utf8');
        renameSync(tmp, queuePath);
      } catch { /* non-fatal */ }
    } else {
      flushQueue();
    }
  }
} catch (err) {
  // Signal queue is non-fatal, but log for debugging
  process.stderr.write(`[signal-queue] Error: ${err.message}\n`);
}

// ── Signal Buddy: Claude is about to respond ────────────────────
// This sets hadActivity=true in Buddy so the Stop-hook chime always fires,
// even for pure text responses that produce no PTY or file-change events.
const sync = (() => {
  try { return JSON.parse(readFileSync(join(HW, 'sync.json'), 'utf8')); }
  catch { return null; }
})();
if (sync?.port) {
  const signalData = { type: 'typing', summary: 'Responding...' };
  if (brainSignalFiles.length > 0) {
    signalData.filesChanged = brainSignalFiles;
  }
  const body = JSON.stringify(signalData);
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
  req.setTimeout(1500, () => { req.destroy(); process.exit(0); });
  req.on('error', () => { process.exit(0); });
  req.write(body);
  req.end();
}
