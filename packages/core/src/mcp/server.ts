#!/usr/bin/env node
/**
 * Hello World MCP Server
 *
 * Exposes the brain engine, project state, and orchestration as MCP tools
 * that Claude Code can call natively.
 *
 * Usage in Claude Code settings:
 * {
 *   "mcpServers": {
 *     "hello-world": {
 *       "command": "node",
 *       "args": ["path/to/hello-world/packages/core/dist/mcp/server.js"],
 *       "env": { "HW_PROJECT_ROOT": "/path/to/your/project" }
 *     }
 *   }
 * }
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from '../project.js';
import { MemoryStore } from '../brain/store.js';
import { SessionManager } from '../orchestration/session.js';
import { ApprovalGates } from '../orchestration/approvals.js';
import { TwoStrikeEngine } from '../orchestration/strikes.js';
import { ActivityStore } from '../activity.js';
import { WorkflowEngine } from '../orchestration/workflow.js';
import { retrieveMemories } from '../brain/engine.js';
import { recordSynapticActivity, recordMemoryTraces, applySynapticPlasticity } from '../brain/state.js';
import { WatcherStore, type WatcherType } from '../watchers/store.js';
import type { MemoryType, MemorySeverity } from '../types.js';
import { analyzeGaps, learnFromObservations, createEmptyCortexStore, mergeCortex } from '../brain/cortex-learner.js';
import type { CortexLearnedStore } from '../brain/cortex-learner.js';
import { processPredictionEvent, createExpectationModel, createEventSignature, decayExpectationModel } from '../brain/prediction.js';
import type { ExpectationModel } from '../brain/prediction-types.js';
import { generateHealthReport, formatHealthReport } from '../brain/health.js';
import { pruneMemories, checkCapacity } from '../brain/pruner.js';
import type { MemoryArchiveStore } from '../brain/pruner.js';
import { extractRuleCandidates, learnRules, createEmptyRulesStore } from '../brain/rules.js';
import type { LearnedRulesStore } from '../brain/rules.js';
import { rankMemories } from '../brain/scoring.js';
import { DEFAULT_CORTEX } from '../types.js';
import { findLinks } from '../brain/linker.js';
// findContradictions is handled inline via quality-gate + linker (not needed here)
import {
  shouldReflect, generateMetaObservations, createReflection,
  filterRecentMemories, clusterByTagOverlap, generateConsolidation,
  isDuplicateReflection,
} from '../brain/reflection.js';
import { JsonStore } from '../storage.js';
import { ChatroomStore } from '../chatroom/chatroom-state.js';
import { AGENT_DEFINITIONS, DEFAULT_AGENTS, USER_SIM_AGENTS, AGENT_ROSTER } from '../chatroom/agent-definitions.js';
import { runDeliberation, stopDeliberation } from '../chatroom/agent-runner.js';

const projectRoot = process.env.HW_PROJECT_ROOT ?? process.cwd();

// ── Circuit breaker: graceful degradation for brain modules ─────

function safeBrainOp<T>(
  label: string,
  operation: () => T,
  fallback: T,
): { result: T; degraded: boolean; error?: string } {
  try {
    return { result: operation(), degraded: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { activity.append('brain_error', `${label} failed (degraded)`, msg); } catch { /* double-fault */ }
    console.error(`[circuit-breaker] ${label}: ${msg}`);
    return { result: fallback, degraded: true, error: msg };
  }
}

// ── Deferred cortex learning: accumulate gaps, flush periodically ─

let pendingCortexGaps: Array<{ gaps: string[]; prompt: string }> = [];
let lastCortexFlush = Date.now();
const CORTEX_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function flushCortexGaps(): void {
  if (pendingCortexGaps.length === 0) return;
  try {
    const memories = memoryStore.getAllMemories();
    const allObservations = pendingCortexGaps.flatMap(p =>
      analyzeGaps(p.gaps, p.prompt, memories),
    );
    if (allObservations.length > 0) {
      const cortexData = cortexStore.read();
      const learnResult = learnFromObservations(allObservations, cortexData.entries);
      cortexStore.write({
        entries: [...cortexData.entries.filter(e => !learnResult.updatedEntries.some(u => u.word === e.word)), ...learnResult.updatedEntries, ...learnResult.newEntries],
        totalGapsProcessed: cortexData.totalGapsProcessed + allObservations.length,
        lastUpdated: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[cortex-flush]', err instanceof Error ? err.message : err);
  }
  pendingCortexGaps = [];
  lastCortexFlush = Date.now();
}

// ── Auto-capture: promote high-confidence signals to memories ──

const SIGNAL_QUEUE_PATH = join(projectRoot, '.hello-world', 'signal-queue.json');

const SIGNAL_TYPE_TO_MEMORY: Record<string, MemoryType> = {
  bug_fix: 'pain',
  research_conclusion: 'fact',
  correction_confirmed: 'pain',
  user_instruction: 'fact',
  method: 'win',
};

function processSignalQueue(): void {
  try {
    if (!existsSync(SIGNAL_QUEUE_PATH)) return;
    const raw = JSON.parse(readFileSync(SIGNAL_QUEUE_PATH, 'utf-8'));
    const signals: Array<{ type: string; confidence: number; excerpt: string; detectedAt?: string }> = raw.signals ?? [];
    if (signals.length === 0) return;

    const kept: typeof signals = [];
    let stored = 0;

    for (const sig of signals) {
      const memType = SIGNAL_TYPE_TO_MEMORY[sig.type];
      if (sig.confidence >= 0.7 && memType) {
        safeBrainOp('signal_auto_capture', () => {
          memoryStore.storeMemory({
            type: memType,
            title: `${sig.type}: ${sig.excerpt.slice(0, 60)}`,
            content: sig.excerpt,
            tags: ['auto-captured', sig.type],
          });
        }, undefined);
        stored++;
      } else {
        kept.push(sig);
      }
    }

    if (stored > 0) {
      raw.signals = kept;
      writeFileSync(SIGNAL_QUEUE_PATH, JSON.stringify(raw, null, 2), 'utf-8');
      activity.append('signal_auto_capture', `Auto-stored ${stored} high-confidence signal(s) as memories`);
    }
  } catch (err) {
    console.error('[signal-auto-capture]', err instanceof Error ? err.message : err);
  }
}

const HANDOFF_FILE = join(projectRoot, '.hello-world', 'restart-handoff.json');

const RUNNER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'watchers', 'runner.mjs');

let project: Project;
let memoryStore: MemoryStore;
let sessions: SessionManager;
let approvals: ApprovalGates;
let strikes: TwoStrikeEngine;
let activity: ActivityStore;
let workflow: WorkflowEngine;
let watchers: WatcherStore;
let cortexStore: JsonStore<CortexLearnedStore>;
let rulesStore: JsonStore<LearnedRulesStore>;
let archiveStore: JsonStore<MemoryArchiveStore>;
let expectationStore: JsonStore<ExpectationModel>;
let chatroom: ChatroomStore;

try {
  project = Project.open(projectRoot);
  memoryStore = new MemoryStore(projectRoot, project.config.name);
  sessions = new SessionManager(projectRoot);
  approvals = new ApprovalGates(projectRoot);
  strikes = new TwoStrikeEngine(projectRoot);
  activity = new ActivityStore(projectRoot);
  workflow = new WorkflowEngine(projectRoot);
  watchers = new WatcherStore(projectRoot);
  cortexStore = new JsonStore<CortexLearnedStore>(projectRoot, 'cortex-learned.json', createEmptyCortexStore());
  rulesStore = new JsonStore<LearnedRulesStore>(projectRoot, 'learned-rules.json', createEmptyRulesStore());
  archiveStore = new JsonStore<MemoryArchiveStore>(projectRoot, 'memories-archive.json', { archived: [], totalArchived: 0, lastPruned: new Date().toISOString() });
  expectationStore = new JsonStore<ExpectationModel>(projectRoot, 'expectation-model.json', createExpectationModel());
  chatroom = new ChatroomStore(projectRoot);
} catch {
  console.error(`No Hello World project at ${projectRoot}. Run 'hello-world init' first.`);
  process.exit(1);
}

const server = new McpServer({ name: 'hello-world', version: '0.1.0' });
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

// ── Loopback notify: push file changes + summaries to Tauri UI ───

const SYNC_FILE = join(projectRoot, '.hello-world', 'sync.json');

function readSyncPort(): { port: number; pid: number } | null {
  try {
    const raw = JSON.parse(readFileSync(SYNC_FILE, 'utf-8'));
    if (typeof raw.port === 'number' && typeof raw.pid === 'number') return raw;
  } catch { /* app not running */ }
  return null;
}

function generateSummary(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'hw_add_task':      return `Added task: ${args.title}`;
    case 'hw_update_task':   return `Task ${args.id} → ${args.status}`;
    case 'hw_store_memory':  return `Stored ${args.type}: ${args.title}`;
    case 'hw_advance_phase': return `Phase → ${args.phase}`;
    case 'hw_notify':        return `Notified Pat`;
    case 'hw_record_decision': return `Decision: ${args.title}`;
    case 'hw_write_handoff': return `Handoff written`;
    case 'hw_spawn_watcher': return `Spawned watcher: ${args.type}`;
    case 'hw_get_context':   return `Context loaded`;
    case 'hw_start_task':    return `Started task: ${args.taskId}`;
    case 'hw_get_task':      return `Got task: ${args.taskId}`;
    case 'hw_reset_strikes': return `Strikes reset: ${args.taskId}`;
    case 'hw_start_deliberation':   return `Deliberation: "${String(args.topic).slice(0, 50)}"`;
    case 'hw_post_to_chatroom':     return `Claude: ${String(args.message).slice(0, 50)}`;
    case 'hw_conclude_deliberation': return `Deliberation concluded`;
    case 'hw_quick_insights':       return `Quick insights: ${String(args.topic).slice(0, 50)}`;
    default: return tool.replace('hw_', '').replace(/_/g, ' ');
  }
}

// File lists per tool — which .hello-world/*.json files does each tool write?
function toolFiles(tool: string): string[] {
  const map: Record<string, string[]> = {
    hw_add_task:          ['tasks.json'],
    hw_update_task:       ['tasks.json'],
    hw_list_tasks:        [],
    hw_store_memory:      ['memories.json', 'brain-state.json', 'expectation-model.json'],
    hw_retrieve_memories: ['brain-state.json', 'memories.json'],
    hw_advance_phase:     ['workflow.json'],
    hw_get_workflow_state:[],
    hw_record_decision:   ['decisions.json'],
    hw_notify:            [],
    hw_write_handoff:     [],
    hw_record_failure:    ['workflow.json'],
    hw_get_context:       ['sessions.json', 'activity.json'],
    hw_end_session:       ['sessions.json', 'memories-archive.json', 'learned-rules.json'],
    hw_brain_health:      [],
    hw_update_direction:  ['direction.json'],
    hw_process_direction_note: ['direction.json'],
    hw_spawn_watcher:     ['watchers.json'],
    hw_kill_watcher:      ['watchers.json'],
    hw_list_watchers:     [],
    hw_check_autonomous_timer: [],
    hw_get_claude_usage: ['claude-usage.json'],
    hw_start_task:            ['tasks.json', 'workflow.json'],
    hw_get_task:              [],
    hw_reset_strikes:         ['workflow.json'],
    hw_list_agents:            [],
    hw_plan_deliberation:      ['approvals.json'],
    hw_extract_deliberation_recommendations: ['approvals.json'],
    hw_start_deliberation:     ['chatroom.json'],
    hw_pause_deliberation:     ['chatroom.json'],
    hw_resume_deliberation:    ['chatroom.json'],
    hw_check_deliberation_coverage: ['chatroom.json'],
    hw_conclude_deliberation:  ['chatroom.json'],
    hw_quick_insights:         ['chatroom.json'],
    hw_post_to_chatroom:       ['chatroom.json'],
    hw_set_deliberation_phase: ['chatroom.json'],
    hw_react:                  ['chatroom.json'],
    hw_post_agent_message:     ['chatroom.json'],
  };
  return map[tool] ?? ['tasks.json'];
}

let pendingNotify: { files: Set<string>; events: Array<{ tool: string; summary: string }> } | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNotify(tool: string, args: Record<string, unknown>): void {
  const files = toolFiles(tool);
  const summary = generateSummary(tool, args);

  if (!pendingNotify) pendingNotify = { files: new Set(), events: [] };
  files.forEach(f => pendingNotify!.files.add(f));
  pendingNotify!.events.push({ tool, summary });

  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    const payload = pendingNotify!;
    pendingNotify = null;
    notifyTimer = null;

    const sync = readSyncPort();
    if (!sync) return;

    // Liveness check
    try { process.kill(sync.pid, 0); } catch { return; }

    const body = JSON.stringify({
      files: Array.from(payload.files),
      events: payload.events,
      summary: payload.events.map(e => e.summary).join(' · '),
    });

    try {
      await fetch(`http://127.0.0.1:${sync.port}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch { /* app not running */ }
  }, 150);
}

// Direct notify for the agent runner (no debounce -- called from background loop).
function notifyRunner(files: string[]): void {
  const sync = readSyncPort();
  if (!sync) return;
  fetch(`http://127.0.0.1:${sync.port}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  }).catch(() => {});
}

// Wrap registerTool so scheduleNotify fires automatically after every tool call.
// Individual tool handlers don't need to know about the notify system.
{
  const _register = server.registerTool.bind(server);
  (server as unknown as Record<string, unknown>)['registerTool'] = (
    name: string, schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>
  ) => {
    return _register(name as never, schema as never, async (args: Record<string, unknown>) => {
      let result: unknown;
      try {
        result = await handler(args);
      } catch (err) {
        try { scheduleNotify(name, args ?? {}); } catch { /* double-fault */ }
        throw err;
      }
      scheduleNotify(name, args ?? {});
      return result;
    });
  };
}

// ── Context & Memory ────────────────────────────────────────────

server.registerTool('hw_get_context', {
  title: 'Get Project Context',
  description: 'Get the full project context snapshot. Call this at the start of every session.',
  inputSchema: z.object({}),
}, async () => {
  processSignalQueue(); // Auto-store high-confidence signals on context load
  sessions.getCurrent() ?? sessions.start();
  const ctx = sessions.compileContext(project.config.name, project.state, memoryStore, project.config.dailyBudgetUsd);
  activity.append('context_loaded', `Session #${ctx.sessionNumber} started`, `Project: ${ctx.projectName}\nActive tasks: ${ctx.activeTasks.length}\nOpen questions: ${ctx.openQuestions.length}`);

  // Check for restart handoff — written by hw_write_handoff before a self-modifying restart
  let handoffSection = '';
  try {
    if (existsSync(HANDOFF_FILE)) {
      const handoff = JSON.parse(readFileSync(HANDOFF_FILE, 'utf-8')) as { message: string; timestamp: string };
      handoffSection = `\n\n## RESTART HANDOFF\nWritten: ${handoff.timestamp}\n\n${handoff.message}`;
      unlinkSync(HANDOFF_FILE);
      activity.append('handoff_loaded', 'Restart handoff consumed', handoff.message.slice(0, 120));
    }
  } catch { /* non-fatal */ }

  // Surface unread direction notes — must be processed before starting work
  let notesSection = '';
  try {
    const dir = readDirection();
    const unread = dir.notes.filter(n => !n.read);
    if (unread.length > 0) {
      const noteLines = unread.map(n => `  [${n.id}] ${n.text}`).join('\n');
      notesSection = `\n\n## UNREAD DIRECTION NOTES — PROCESS BEFORE STARTING WORK\nYou have ${unread.length} unread note(s) from Pat. Call hw_process_direction_note for each one.\nChoose an action: "task" (create a task), "decision" (record a decision), "scope" (add scope entry), or "dismiss" (with reason).\n\n${noteLines}`;
    }
  } catch { /* non-fatal */ }

  return text(ctx.compiledText + handoffSection + notesSection);
});

server.registerTool('hw_write_handoff', {
  title: 'Write Restart Handoff',
  description: 'Write a restart handoff before Hello World restarts due to self-modification. Call this BEFORE any edit that triggers a restart. The next session will pick it up automatically via hw_get_context.',
  inputSchema: z.object({
    message: z.string().describe('Full context: what you were doing, what changed, what to verify next'),
  }),
}, async (args: { message: string }) => {
  const handoff = { message: args.message, timestamp: new Date().toISOString(), elevated: true };
  writeFileSync(HANDOFF_FILE, JSON.stringify(handoff, null, 2));
  activity.append('handoff_written', 'Restart handoff saved', args.message.slice(0, 120));
  return text('Handoff written. Safe to restart Hello World now — next session will resume automatically.');
});

server.registerTool('hw_retrieve_memories', {
  title: 'Retrieve Memories',
  description: 'Query the brain for relevant memories. Returns pain (mistakes), wins (patterns), attention warnings.',
  inputSchema: z.object({ prompt: z.string() }),
}, async (args: { prompt: string }) => {
  // Auto-capture: promote high-confidence signals before retrieval
  processSignalQueue();

  const memories = memoryStore.getAllMemories();
  const brainState = memoryStore.getBrainState();

  // Zone A: Core retrieval (primary -- circuit breaker wraps link traversal inside engine)
  // Merge learned cortex entries with default cortex for richer matching
  const mergedCortex = safeBrainOp('retrieve:cortex_merge', () => {
    const learned = cortexStore.read();
    return mergeCortex(DEFAULT_CORTEX, learned.entries);
  }, DEFAULT_CORTEX);
  const result = retrieveMemories(args.prompt, memories, brainState, { cortex: mergedCortex.result });
  const tagRanked = rankMemories(memories, 0.15, result.matchedTags);

  // Zone B: Brain state update (degradable)
  if (brainState) {
    safeBrainOp('retrieve:brain_state', () => {
      let updated = brainState;
      updated = recordSynapticActivity(updated, result.matchedTags);
      const ids = [...result.painMemories, ...result.winMemories].map(s => s.memory.id);
      updated = recordMemoryTraces(updated, ids);
      memoryStore.saveBrainState(updated);
      memoryStore.incrementAccess(ids);
    }, undefined);
  }

  // Zone C: Cortex learning (deferred -- accumulate gaps, flush periodically)
  if (result.telemetry?.cortexGaps?.length) {
    pendingCortexGaps.push({ gaps: result.telemetry.cortexGaps, prompt: args.prompt });
    if (Date.now() - lastCortexFlush > CORTEX_FLUSH_INTERVAL_MS) {
      flushCortexGaps();
    }
  }

  // Zone D: Activity logging (degradable)
  const count = result.painMemories.length + result.winMemories.length;
  safeBrainOp('retrieve:activity', () => {
    activity.append('memory_retrieved', `Retrieved ${count} memories for: "${args.prompt.slice(0, 60)}" (${tagRanked.length} tag-ranked)`, result.injectionText || 'No matches.');
  }, undefined);

  return text(result.injectionText || 'No relevant memories found.');
});

server.registerTool('hw_store_memory', {
  title: 'Store Memory',
  description: 'Store a memory. Types: pain (mistakes), win (successes), fact (reference), decision, architecture.',
  inputSchema: z.object({
    type: z.enum(['pain', 'win', 'fact', 'decision', 'architecture', 'reflection']),
    title: z.string(),
    content: z.string().optional(),
    rule: z.string().optional(),
    tags: z.array(z.string()).optional(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
  }),
}, async (args: { type: string; title: string; content?: string; rule?: string; tags?: string[]; severity?: string }) => {
  // Zone A: Core store (primary -- quality gate runs inside)
  const decayExempt = args.type === 'pain' && args.severity === 'high';
  const result = memoryStore.storeMemory({
    type: args.type as MemoryType,
    title: args.title,
    content: args.content,
    rule: args.rule,
    tags: args.tags,
    severity: args.severity as MemorySeverity | undefined,
    decayExempt,
  });
  const mem = result.memory;
  if (result.gateResult.action === 'reject') {
    return text(`Memory rejected: ${result.gateResult.reason}`);
  }
  const suffix = result.merged ? ' (merged with existing)' : result.superseded?.length ? ` (superseded ${result.superseded.join(', ')})` : '';

  // Zone B: Link discovery (degradable -- new memory gets linked to existing graph)
  const linkResult = safeBrainOp('store:linker', () => {
    const allMems = memoryStore.getAllMemories();
    const links = findLinks(mem, allMems.filter(m => m.id !== mem.id));
    for (const link of links) {
      memoryStore.addLink(mem.id, link.targetId, link.relationship);
    }
    return links;
  }, []);

  // Surface contradictions and supersessions in the response
  let linkWarnings = '';
  if (linkResult.result.length > 0) {
    const contradictions = linkResult.result.filter(l => l.relationship === 'contradicts');
    const supersessions = linkResult.result.filter(l => l.relationship === 'supersedes');
    if (contradictions.length > 0) {
      linkWarnings += '\nWARNING: Contradicts ' + contradictions.map(c => `#${c.targetId} (score: ${c.weight.toFixed(2)})`).join(', ') + ' -- consider updating or superseding the older memory.';
    }
    if (supersessions.length > 0) {
      linkWarnings += '\nSupersedes: ' + supersessions.map(s => `#${s.targetId}`).join(', ');
    }
  }

  // Zone C: Activity logging (degradable)
  safeBrainOp('store:activity', () => {
    activity.append('memory_stored', `[${mem.type.toUpperCase()}] ${mem.title}`, mem.content ?? mem.rule ?? '');
  }, undefined);

  // Zone D: Brain state tracking (degradable)
  safeBrainOp('store:brain_state', () => {
    const bs = memoryStore.getBrainState();
    if (bs) {
      bs.significantEventsSinceCheckpoint = (bs.significantEventsSinceCheckpoint ?? 0) + 1;
      memoryStore.saveBrainState(bs);
    }
  }, undefined);

  // Zone E: Reflection trigger (degradable -- check if brain should reflect)
  safeBrainOp('store:reflection', () => {
    const bs = memoryStore.getBrainState();
    if (!bs) return;
    const check = shouldReflect(bs);
    if (!check.reflect) return;

    const allMems = memoryStore.getAllMemories();
    const recent = filterRecentMemories(allMems, 48); // last 48 hours
    const observations = generateMetaObservations(recent);

    for (const obs of observations) {
      if (isDuplicateReflection(obs, allMems)) continue;
      const reflectionMem = createReflection(obs);
      memoryStore.storeMemory({
        type: 'reflection',
        title: reflectionMem.title,
        content: reflectionMem.content,
        tags: reflectionMem.tags,
        severity: reflectionMem.severity,
      });
    }

    // Reset counter after reflecting
    bs.significantEventsSinceCheckpoint = 0;
    memoryStore.saveBrainState(bs);
    if (observations.length > 0) {
      activity.append('brain_reflection', `Generated ${observations.length} meta-observation(s): ${check.reason}`);
    }
  }, undefined);

  // Zone F: Prediction event (degradable -- update expectation model)
  if (mem.type === 'pain' || mem.type === 'win') {
    safeBrainOp('store:prediction', () => {
      const model = expectationStore.read();
      const bs = memoryStore.getBrainState();
      const recentMems = memoryStore.getAllMemories()
        .filter(m => m.createdAt > new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
        .map(m => ({ createdAt: m.createdAt }));

      const event = {
        category: mem.type === 'pain' ? 'error' as const : 'system' as const,
        description: mem.title,
        details: mem.content,
        tags: mem.tags,
        valence: mem.type === 'pain' ? 'negative' as const : 'positive' as const,
        severity: mem.severity,
      };

      const predResult = processPredictionEvent(event, model, recentMems, {
        sessionId: sessions.getCurrent()?.id,
        activeTaskId: undefined,
        sessionMessageCount: bs?.messageCount ?? 0,
      });

      expectationStore.write(predResult.updatedModel);

      if (predResult.captureResult.capture && predResult.captureResult.memory) {
        const sm = predResult.captureResult.memory;
        activity.append('brain_prediction', `Surprise detected (expectedness: ${predResult.captureResult.expectedness.toFixed(2)}): ${sm.title}`);
      }
    }, undefined);
  }

  // Zone G: Clear signal queue (storing a memory fulfills the obligation)
  safeBrainOp('store:clear_signals', () => {
    const signalQueuePath = join(project.hwDir, 'signal-queue.json');
    try {
      const raw = readFileSync(signalQueuePath, 'utf8');
      const q = JSON.parse(raw);
      if (q.signals && q.signals.length > 0) {
        q.signals = [];
        q.lastFlushed = new Date().toISOString();
        const tmp = signalQueuePath + '.tmp';
        writeFileSync(tmp, JSON.stringify(q, null, 2), 'utf8');
        renameSync(tmp, signalQueuePath);
      }
    } catch { /* non-fatal */ }
  }, undefined);

  // Zone H: Capacity check (nudge Claude when nearing limit)
  let capacityWarning = '';
  safeBrainOp('store:capacity', () => {
    const total = memoryStore.getAllMemories().length;
    const cap = checkCapacity(total);
    if (cap.level === 'critical') {
      capacityWarning = `\nCAPACITY CRITICAL: ${cap.total}/${cap.capacity} memories (${Math.round(cap.pct * 100)}%). Run /clean-quit or manually prune before storing more.`;
    } else if (cap.level === 'warning') {
      capacityWarning = `\nCapacity warning: ${cap.total}/${cap.capacity} memories (${Math.round(cap.pct * 100)}%).`;
    }
  }, undefined);

  return text(`Memory stored: ${mem.id} (${mem.type}, quality: ${result.gateResult.qualityScore.toFixed(2)}) "${mem.title}"${suffix}${linkWarnings}${capacityWarning}`);
});

// ── Tasks ───────────────────────────────────────────────────────

server.registerTool('hw_list_tasks', {
  title: 'List Tasks',
  description: 'List all tasks, optionally filtered by status.',
  inputSchema: z.object({ status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional() }),
}, async (args: { status?: string }) => {
  const tasks = args.status ? project.state.listTasks(args.status as any) : project.state.listTasks();
  if (tasks.length === 0) return text('No tasks.');
  const lines = tasks.map(t => `[${t.status}] ${t.id}: ${t.title}${t.dependsOn.length > 0 ? ` (deps: ${t.dependsOn.join(', ')})` : ''}`);
  return text(lines.join('\n'));
});

server.registerTool('hw_add_task', {
  title: 'Add Task',
  description: 'Add a new task.',
  inputSchema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
  }),
}, async (args: { title: string; description?: string; tags?: string[]; dependsOn?: string[] }) => {
  processSignalQueue(); // Auto-store high-confidence signals
  const task = project.state.addTask(args.title, { description: args.description, tags: args.tags, dependsOn: args.dependsOn });
  activity.append('task_added', `Task: ${task.title}`, args.description ?? '');
  return text(`Task created: ${task.id} "${task.title}"`);
});

server.registerTool('hw_update_task', {
  title: 'Update Task',
  description: 'Update task status or details.',
  inputSchema: z.object({
    id: z.string(),
    status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional(),
    description: z.string().optional(),
  }),
}, async (args: { id: string; status?: string; description?: string }) => {
  processSignalQueue(); // Auto-store high-confidence signals
  const updates: Record<string, unknown> = {};
  if (args.status) updates.status = args.status;
  if (args.description) updates.description = args.description;
  const task = project.state.updateTask(args.id, updates);
  if (args.status === 'done') {
    sessions.recordTaskCompleted(args.id);
    // Auto-capture win memory so brain learns from task completions without manual calls
    memoryStore.storeMemory({
      type: 'win',
      title: `Completed: ${task.title}`,
      content: task.description ?? 'Task completed successfully.',
      tags: ['auto-captured', ...(task.tags ?? [])],
      severity: 'low',
    });
    // Track significant event for checkpoint logic
    const bs = memoryStore.getBrainState();
    if (bs) {
      bs.significantEventsSinceCheckpoint = (bs.significantEventsSinceCheckpoint ?? 0) + 1;
      memoryStore.saveBrainState(bs);
    }
  }
  activity.append('task_updated', `[${task.status.toUpperCase()}] ${task.title}`, args.description ?? '');
  return text(`Task ${task.id} updated to [${task.status}]`);
});

server.registerTool('hw_start_task', {
  title: 'Start Task',
  description: 'Start a task: marks it in_progress, advances phase to scope if idle, returns task details. Shorthand replacing separate hw_update_task + hw_advance_phase calls.',
  inputSchema: z.object({
    taskId: z.string().describe('The task ID to start'),
  }),
}, async (args: { taskId: string }) => {
  // Enforce dependency gate — block if any depended-on tasks are not done
  const allTasks = project.state.listTasks();
  const candidate = allTasks.find(t => t.id === args.taskId);
  if (candidate?.dependsOn?.length) {
    const blockers = candidate.dependsOn.filter(depId => {
      const dep = allTasks.find(t => t.id === depId);
      return dep && dep.status !== 'done';
    });
    if (blockers.length > 0) {
      const blockerDetails = blockers.map(id => {
        const dep = allTasks.find(t => t.id === id);
        return `  ${id}: ${dep?.title ?? 'unknown'} [${dep?.status ?? '?'}]`;
      }).join('\n');
      return text(`BLOCKED: Task "${candidate.title}" has unmet dependencies:\n${blockerDetails}\n\nComplete those tasks first, or remove the dependency.`);
    }
  }
  const task = project.state.updateTask(args.taskId, { status: 'in_progress' });
  const wf = workflow.getState();
  if (wf.phase === 'idle') {
    workflow.assignTask(args.taskId);
  }
  activity.append('task_started', `Started: ${task.title}`, `Task ${task.id} → in_progress`);
  const lines = [
    `Task started: ${task.id}`,
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : null,
    task.tags?.length ? `Tags: ${task.tags.join(', ')}` : null,
    task.dependsOn?.length ? `Depends on: ${task.dependsOn.join(', ')}` : null,
  ].filter((l): l is string => l !== null);
  return text(lines.join('\n'));
});

// ── Decisions ───────────────────────────────────────────────────

server.registerTool('hw_record_decision', {
  title: 'Record Decision',
  description: 'Record an architecture/technical decision with rationale and alternatives.',
  inputSchema: z.object({
    title: z.string(),
    context: z.string(),
    chosen: z.string(),
    rationale: z.string(),
    decidedBy: z.enum(['pat', 'claude', 'both']),
    alternatives: z.array(z.object({ option: z.string(), tradeoff: z.string() })).optional(),
  }),
}, async (args: { title: string; context: string; chosen: string; rationale: string; decidedBy: 'pat' | 'claude' | 'both'; alternatives?: Array<{ option: string; tradeoff: string }> }) => {
  const dec = project.state.addDecision(args.title, args);
  sessions.recordDecisionMade(dec.id);
  activity.append('decision_recorded', `Decision: ${dec.title}`, `Chosen: ${dec.chosen}\n${dec.rationale}`);
  // Auto-capture decision memory so it surfaces during future relevant retrieval
  memoryStore.storeMemory({
    type: 'decision',
    title: dec.title,
    content: `Context: ${args.context}\nChosen: ${dec.chosen}\nRationale: ${dec.rationale}`,
    tags: ['auto-captured', 'decision'],
    severity: 'low',
  });
  // Track significant event for checkpoint logic
  const bs = memoryStore.getBrainState();
  if (bs) {
    bs.significantEventsSinceCheckpoint = (bs.significantEventsSinceCheckpoint ?? 0) + 1;
    memoryStore.saveBrainState(bs);
  }
  return text(`Decision recorded: ${dec.id} "${dec.title}" -> ${dec.chosen}`);
});

// ── Discord Notifications ────────────────────────────────────────

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const PAT_USER_ID = process.env.DISCORD_USER_ID ?? '';

async function sendDiscordDM(message: string): Promise<void> {
  try {
    // Open DM channel with Pat
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: PAT_USER_ID }),
    });
    const dm = await dmRes.json() as { id?: string };
    if (!dm.id) return;

    // Send message
    await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  } catch {
    // Notification failure is non-fatal
  }
}

server.registerTool('hw_notify', {
  title: 'Notify Pat',
  description: 'Send Pat a Discord DM notification. Use for important events, blockers, or when you need attention.',
  inputSchema: z.object({ message: z.string() }),
}, async (args: { message: string }) => {
  await sendDiscordDM(`**Hello World:** ${args.message}`);
  activity.append('notification', 'Discord DM sent to Pat', args.message);
  return text('Notification sent to Pat via Discord DM.');
});

// ── Approvals ───────────────────────────────────────────────────

// ── Strikes ─────────────────────────────────────────────────────

server.registerTool('hw_record_failure', {
  title: 'Record Failure',
  description: 'Record error for Two-Strike tracking. Same error class twice = MUST stop and present alternatives.',
  inputSchema: z.object({
    taskId: z.string(),
    errorMessage: z.string(),
    approach: z.string(),
    affectedFile: z.string().optional(),
  }),
}, async (args: { taskId: string; errorMessage: string; approach: string; affectedFile?: string }) => {
  const check = strikes.recordFailure(args.taskId, args.errorMessage, args.approach, args.affectedFile);

  // Auto-capture pain memory on every failure so brain learns without manual hw_store_memory calls
  const failedTask = project.state.listTasks().find(t => t.id === args.taskId);
  memoryStore.storeMemory({
    type: 'pain',
    title: `Strike: ${args.errorMessage.slice(0, 60)} (${failedTask?.title ?? args.taskId})`,
    content: `Approach tried: ${args.approach}${args.affectedFile ? `\nFile: ${args.affectedFile}` : ''}`,
    rule: args.errorMessage.slice(0, 300),
    tags: ['auto-captured', args.taskId, 'strike'],
    severity: check.shouldHalt ? 'high' : 'medium',
  });

  // Track significant event for checkpoint logic
  const bs = memoryStore.getBrainState();
  if (bs) {
    bs.significantEventsSinceCheckpoint = (bs.significantEventsSinceCheckpoint ?? 0) + 1;
    memoryStore.saveBrainState(bs);
  }

  if (check.shouldHalt) {
    activity.append('strike_halt', `TWO-STRIKE HALT on task ${args.taskId}`, args.errorMessage);
    return text(`TWO-STRIKE HALT!\n\n${strikes.getAlternatives(args.taskId)}\n\nSTOP. Present 2-3 fundamentally different approaches to Pat.`);
  }
  activity.append('strike_recorded', `Strike ${check.count}/2: ${args.errorMessage.slice(0, 80)}`, `Task: ${args.taskId}\nApproach: ${args.approach}`);
  return text(`Strike ${check.count}/2 recorded for task ${args.taskId}. Try a different angle.`);
});

server.registerTool('hw_get_task', {
  title: 'Get Task',
  description: 'Get full details of a specific task by ID — title, description, status, tags, dependencies.',
  inputSchema: z.object({ taskId: z.string() }),
}, async (args: { taskId: string }) => {
  const task = project.state.listTasks().find(t => t.id === args.taskId);
  if (!task) return text(`No task found with ID: ${args.taskId}`);
  const lines = [
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    task.description ? `Description: ${task.description}` : null,
    task.tags?.length ? `Tags: ${task.tags.join(', ')}` : null,
    task.dependsOn?.length ? `Depends on: ${task.dependsOn.join(', ')}` : null,
  ].filter((l): l is string => l !== null);
  return text(lines.join('\n'));
});

server.registerTool('hw_reset_strikes', {
  title: 'Reset Strikes',
  description: 'Clear Two-Strike halt for a task so work can resume with a new approach. Call after agreeing on a different approach with Pat.',
  inputSchema: z.object({ taskId: z.string() }),
}, async (args: { taskId: string }) => {
  strikes.resetStrikes(args.taskId);
  activity.append('strike_reset', `Strikes cleared for task ${args.taskId}`, 'New approach authorized');
  return text(`Strikes cleared for task ${args.taskId}. Safe to proceed with a different approach.`);
});

// ── Sessions ────────────────────────────────────────────────────

server.registerTool('hw_end_session', {
  title: 'End Session',
  description: 'End current session with a summary.',
  inputSchema: z.object({ summary: z.string() }),
}, async (args: { summary: string }) => {
  const degradations: string[] = [];

  // Zone A: Synaptic plasticity (degradable)
  safeBrainOp('end_session:plasticity', () => {
    const brainState = memoryStore.getBrainState();
    if (brainState) {
      const { state: plasticState, boosted } = applySynapticPlasticity(brainState);
      memoryStore.saveBrainState(plasticState);
      for (const id of boosted) {
        memoryStore.updateStrength(id, 0.1);
      }
      if (boosted.length > 0) {
        activity.append('brain_plasticity', `Boosted ${boosted.length} memory traces at session end`);
      }
    }
  }, undefined).degraded && degradations.push('plasticity');

  // Zone B: Capacity check (informational -- pruning is capacity-based, not session-based)
  safeBrainOp('end_session:capacity_check', () => {
    const allMems = memoryStore.getAllMemories();
    const cap = checkCapacity(allMems.length);
    if (cap.level !== 'ok') {
      activity.append('brain_capacity', `Memory capacity ${cap.level}: ${cap.total}/${cap.capacity} (${Math.round(cap.pct * 100)}%)`);
    }
  }, undefined);

  // Zone C: Rule learning (degradable) -- re-read memories after pruning
  safeBrainOp('end_session:rules', () => {
    const currentMems = memoryStore.getAllMemories();
    const rulesData = rulesStore.read();
    const candidates = extractRuleCandidates(currentMems);
    if (candidates.length > 0) {
      const { newRules, reinforced } = learnRules(candidates, rulesData.rules);
      if (newRules.length > 0 || reinforced.length > 0) {
        const existingIds = new Set(reinforced.map(r => r.id));
        const updatedRules = [
          ...rulesData.rules.filter(r => !existingIds.has(r.id)),
          ...reinforced,
          ...newRules,
        ];
        rulesStore.write({ rules: updatedRules, lastUpdated: new Date().toISOString() });
        if (newRules.length > 0) {
          activity.append('brain_rules', `Learned ${newRules.length} new rule(s), reinforced ${reinforced.length}`);
        }
      }
    }
  }, undefined).degraded && degradations.push('rules');

  // Zone D: Flush deferred cortex gaps (degradable)
  safeBrainOp('end_session:cortex_flush', () => {
    flushCortexGaps();
  }, undefined).degraded && degradations.push('cortex');

  // Zone E: Sleep consolidation -- cluster related memories and generate reflections (degradable)
  safeBrainOp('end_session:reflection', () => {
    const allMems = memoryStore.getAllMemories();
    const recent = filterRecentMemories(allMems, 72); // last 3 days
    if (recent.length < 5) return;

    // Meta-observations on recent patterns
    const observations = generateMetaObservations(recent);
    let storedCount = 0;
    for (const obs of observations) {
      if (isDuplicateReflection(obs, allMems)) continue;
      const reflectionMem = createReflection(obs);
      memoryStore.storeMemory({
        type: 'reflection',
        title: reflectionMem.title,
        content: reflectionMem.content,
        tags: reflectionMem.tags,
        severity: reflectionMem.severity,
      });
      storedCount++;
    }

    // Consolidation -- cluster similar memories, create abstractions
    const clusters = clusterByTagOverlap(recent, 2, 3);
    for (const cluster of clusters.slice(0, 3)) {
      const consolidated = generateConsolidation(cluster);
      if (!consolidated) continue;
      if (isDuplicateReflection(consolidated, allMems)) continue;
      const cMem = createReflection(consolidated);
      memoryStore.storeMemory({
        type: 'reflection',
        title: cMem.title,
        content: cMem.content,
        tags: cMem.tags,
        severity: cMem.severity,
      });
      storedCount++;
    }

    if (storedCount > 0) {
      activity.append('brain_reflection', `Session-end reflection: ${storedCount} reflection(s) generated`);
    }
  }, undefined).degraded && degradations.push('reflection');

  // Zone F: Decay expectation model (degradable)
  safeBrainOp('end_session:prediction_decay', () => {
    const model = expectationStore.read();
    if (model.totalEvents > 0) {
      const decayed = decayExpectationModel(model);
      expectationStore.write(decayed);
    }
  }, undefined).degraded && degradations.push('prediction');

  // Zone G: Session end (critical -- NOT degradable)
  activity.append('session_end', 'Session ended', args.summary);
  const session = sessions.end(args.summary);
  if (!session) return text('No active session.');

  let response = `Session ${session.id} ended. ${session.startedAt} -> ${session.endedAt}`;
  if (degradations.length > 0) {
    response += ` [DEGRADED: ${degradations.join(', ')} failed]`;
  }
  return text(response);
});

// ── Brain Health ─────────────────────────────────────────────────

server.registerTool('hw_brain_health', {
  title: 'Brain Health',
  description: 'Get brain health metrics: memory counts by type/health, review queue, cortex stats, learned rules, overall grade.',
  inputSchema: z.object({}),
}, async () => {
  const memories = memoryStore.getAllMemories();
  const brainState = memoryStore.getBrainState();
  const cortexData = cortexStore.read();
  const rulesData = rulesStore.read();
  const report = generateHealthReport(
    memories,
    brainState,
    cortexData.entries,
    rulesData.rules,
    Object.keys(DEFAULT_CORTEX).length,
    cortexData.totalGapsProcessed,
  );
  return text(formatHealthReport(report));
});

// ── Workflow ─────────────────────────────────────────────────────

server.registerTool('hw_get_workflow_state', {
  title: 'Get Workflow State',
  description: 'Get current workflow phase (SCOPE→PLAN→BUILD→VERIFY→SHIP) and autonomous timer status.',
  inputSchema: z.object({}),
}, async () => {
  const state = workflow.getState();
  const timer = workflow.checkAutonomousTimer();
  const lines = [
    `Phase: ${state.phase.toUpperCase()}`,
    `Task: ${state.currentTaskId ?? 'none'}`,
    `Strikes: ${state.strikes}/2`,
    `Context: ${state.contextUsagePercent}%`,
  ];
  if (timer.minutesElapsed > 0) {
    lines.push(`Autonomous timer: ${timer.minutesElapsed}min${timer.warn ? ' ⚠ WARN' : ''}${timer.halt ? ' 🛑 HALT' : ''}`);
  }
  if (state.lastStrikeError) lines.push(`Last error: ${state.lastStrikeError}`);
  return text(lines.join('\n'));
});

server.registerTool('hw_advance_phase', {
  title: 'Advance Workflow Phase',
  description: 'Transition to the next workflow phase. Valid: idle→scope, scope→plan/build, plan→build, build→verify, verify→ship/build, ship→idle.',
  inputSchema: z.object({
    phase: z.enum(['idle', 'scope', 'plan', 'build', 'verify', 'ship', 'waiting_approval', 'blocked']),
    taskId: z.string().optional(),
  }),
}, async (args: { phase: string; taskId?: string }) => {
  if (args.taskId) workflow.assignTask(args.taskId);
  const result = workflow.transition(args.phase as any);
  if (!result.ok) return text(`ERROR: ${result.reason}`);
  activity.append('context_loaded', `Workflow → ${args.phase.toUpperCase()}`, args.taskId ? `Task: ${args.taskId}` : '');
  return text(`Phase advanced to: ${result.state.phase.toUpperCase()}\nTask: ${result.state.currentTaskId ?? 'none'}`);
});

server.registerTool('hw_check_autonomous_timer', {
  title: 'Check Autonomous Timer',
  description: 'Check how long Claude has been working autonomously. Warns at 15min, halts at 20min.',
  inputSchema: z.object({}),
}, async () => {
  const timer = workflow.checkAutonomousTimer();
  if (timer.minutesElapsed === 0) return text('Autonomous timer not running (not in BUILD phase).');
  const status = timer.halt ? '🛑 HALT — check in with Pat NOW' : timer.warn ? '⚠ WARNING — approaching limit' : 'OK';
  return text(`Autonomous timer: ${timer.minutesElapsed} minutes elapsed\nStatus: ${status}`);
});

// ── Direction ────────────────────────────────────────────────────

const directionPath = join(projectRoot, '.hello-world', 'direction.json');

function readDirection(): { vision: string; scope: Array<{ area: string; decision: string; rationale: string; capturedAt: string }>; notes: Array<{ id: string; text: string; source: string; read: boolean; capturedAt: string }> } {
  try {
    const raw = JSON.parse(readFileSync(directionPath, 'utf-8'));
    return {
      vision: raw.vision ?? '',
      scope: Array.isArray(raw.scope) ? raw.scope : [],
      notes: Array.isArray(raw.notes) ? raw.notes : [],
    };
  } catch {
    return { vision: '', scope: [], notes: [] };
  }
}

server.registerTool('hw_update_direction', {
  title: 'Update Direction',
  description: 'Write vision, scope decisions, or notes from Pat to direction.json. Call IMMEDIATELY when Pat discusses project strategy, scope, or leaves feedback. Do not wait until end of session.',
  inputSchema: z.object({
    vision: z.string().optional(),
    scope: z.object({
      area: z.string(),
      decision: z.enum(['in', 'out']),
      rationale: z.string(),
    }).optional(),
    note: z.string().optional(),
  }),
}, async (args: { vision?: string; scope?: { area: string; decision: 'in' | 'out'; rationale: string }; note?: string }) => {
  const dir = readDirection();
  const updated = { ...dir };
  const changes: string[] = [];

  if (args.vision) {
    updated.vision = args.vision;
    changes.push('vision updated');
  }

  if (args.scope) {
    updated.scope = [...dir.scope, { ...args.scope, capturedAt: new Date().toISOString() }];
    changes.push(`scope entry added: ${args.scope.area} [${args.scope.decision.toUpperCase()}]`);
  }

  if (args.note) {
    const id = `n_${Date.now().toString(36)}`;
    updated.notes = [...dir.notes, { id, text: args.note, source: 'session', read: false, capturedAt: new Date().toISOString() }];
    changes.push(`note added: ${args.note.slice(0, 60)}`);
  }

  writeFileSync(directionPath, JSON.stringify(updated, null, 2), 'utf-8');
  activity.append('direction_updated', `Direction updated`, changes.join(', '));
  return text(`direction.json updated: ${changes.join(', ')}`);
});

server.registerTool('hw_process_direction_note', {
  title: 'Process Direction Note',
  description: 'Route an unread direction note to a concrete action: create a task, record a decision, add a scope entry, or dismiss with a reason. Call for every unread note returned by hw_get_context.',
  inputSchema: z.object({
    noteId: z.string().describe('The note ID from hw_get_context unread notes list'),
    action: z.enum(['task', 'decision', 'scope', 'dismiss']),
    task: z.object({ title: z.string(), description: z.string() }).optional(),
    decision: z.object({ title: z.string(), context: z.string(), chosen: z.string(), rationale: z.string(), decidedBy: z.enum(['pat', 'claude', 'both']) }).optional(),
    scope: z.object({ area: z.string(), decision: z.enum(['in', 'out']), rationale: z.string() }).optional(),
    dismiss: z.object({ reason: z.string() }).optional(),
  }),
}, async (args: { noteId: string; action: string; task?: { title: string; description: string }; decision?: { title: string; context: string; chosen: string; rationale: string; decidedBy: 'pat' | 'claude' | 'both' }; scope?: { area: string; decision: 'in' | 'out'; rationale: string }; dismiss?: { reason: string } }) => {
  const dir = readDirection();
  const note = dir.notes.find(n => n.id === args.noteId);
  if (!note) return text(`Note ${args.noteId} not found`);
  if (note.read) return text(`Note ${args.noteId} already processed`);

  let outcome = '';
  let actionId: string | undefined;

  if (args.action === 'task' && args.task) {
    const task = project.state.addTask(args.task.title, { description: args.task.description });
    actionId = task.id;
    outcome = `task created: ${task.id} "${task.title}"`;
  } else if (args.action === 'decision' && args.decision) {
    const d = project.state.addDecision(args.decision.title, {
      context: args.decision.context,
      chosen: args.decision.chosen,
      rationale: args.decision.rationale,
      decidedBy: args.decision.decidedBy,
    });
    actionId = d.id;
    outcome = `decision recorded: ${d.id} "${d.title}"`;
  } else if (args.action === 'scope' && args.scope) {
    const fresh = readDirection();
    fresh.scope = [...fresh.scope, { ...args.scope, capturedAt: new Date().toISOString() }];
    writeFileSync(directionPath, JSON.stringify(fresh, null, 2), 'utf-8');
    outcome = `scope entry added: ${args.scope.area} [${args.scope.decision.toUpperCase()}]`;
  } else if (args.action === 'dismiss' && args.dismiss) {
    outcome = `dismissed: ${args.dismiss.reason}`;
  } else {
    return text(`Missing data for action "${args.action}". Provide the matching field (task/decision/scope/dismiss).`);
  }

  // Mark note read with action recorded
  const updated = readDirection();
  const idx = updated.notes.findIndex(n => n.id === args.noteId);
  if (idx >= 0) {
    (updated.notes[idx] as Record<string, unknown>).read = true;
    (updated.notes[idx] as Record<string, unknown>).actionTaken = args.action;
    if (actionId) (updated.notes[idx] as Record<string, unknown>).actionId = actionId;
  }
  writeFileSync(directionPath, JSON.stringify(updated, null, 2), 'utf-8');

  activity.append('note_processed', `Direction note ${args.noteId} processed via ${args.action}`, outcome);
  return text(`Note processed.\n${outcome}`);
});

// ── Watchers ────────────────────────────────────────────────────

server.registerTool('hw_spawn_watcher', {
  title: 'Spawn Watcher',
  description: 'Spawn a detached background watcher. type="app_shutdown_copy" waits for the Tauri app to exit, then copies files from worktree to main. Use before editing lib.rs in a worktree.',
  inputSchema: z.object({
    type: z.enum(['app_shutdown_copy']),
    config: z.object({
      copies: z.array(z.object({ from: z.string(), to: z.string() })),
      label: z.string().optional(),
      timeoutMinutes: z.number().optional(),
    }),
  }),
}, async (args: { type: string; config: { copies: Array<{ from: string; to: string }>; label?: string; timeoutMinutes?: number } }) => {
  const cfg = {
    copies: args.config.copies,
    label: args.config.label ?? 'Rust file changes',
    timeoutMinutes: args.config.timeoutMinutes ?? 60,
  };
  // Generate ID first so runner can reference it when writing results
  const watcherId = watchers.generateName(args.type as WatcherType);
  const child = spawn(process.execPath, [RUNNER_PATH, watcherId, projectRoot, JSON.stringify(cfg)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const entry = watchers.add({ id: watcherId, type: 'app_shutdown_copy', label: cfg.label, pid: child.pid ?? 0, config: cfg });
  activity.append('watcher_spawned', `Watcher ${entry.id} spawned`, `${cfg.label} — ${cfg.copies.length} file(s)`);
  return text(`Watcher spawned: ${entry.id} (pid ${child.pid})\nWaiting for app shutdown to apply ${cfg.copies.length} file copy/copies.\nLabel: ${cfg.label}`);
});

server.registerTool('hw_list_watchers', {
  title: 'List Watchers',
  description: 'List active and recent completed watchers.',
  inputSchema: z.object({}),
}, async () => {
  const all = watchers.listRecent();
  if (all.length === 0) return text('No watchers.');
  const lines = all.map((w) =>
    `[${w.id}] ${w.type} — ${w.status.toUpperCase()}\n  Label: ${w.label}\n  Spawned: ${w.spawnedAt}${w.completedAt ? `\n  Completed: ${w.completedAt}` : ''}\n  PID: ${w.pid}${w.resultSummary ? `\n  Result: ${w.resultSummary}` : ''}`
  );
  return text(lines.join('\n\n'));
});

server.registerTool('hw_kill_watcher', {
  title: 'Kill Watcher',
  description: 'Kill an active watcher by ID.',
  inputSchema: z.object({ watcherId: z.string() }),
}, async (args: { watcherId: string }) => {
  const result = watchers.kill(args.watcherId);
  activity.append('watcher_killed', `Watcher ${args.watcherId} killed`, result);
  return text(`${args.watcherId}: ${result}`);
});

// ── Boardrooms ──────────────────────────────────────────────────

import {
  createBoardroom, readBoardroom, listBoardrooms,
  postChat, writeWhiteboard, closeBoardroom,
  runBoardroom, stopBoardroom,
  runPanel, formatPanelResult,
  type BoardroomAgent, type PanelAgent,
} from '../boardroom/index.js';
import { getUsageSummary } from '../boardroom/usage.js';

server.registerTool('hw_create_boardroom', {
  title: 'Create Boardroom',
  description: 'Create a collaborative boardroom for agent teams. Agents chat (160-char limit) and share a whiteboard.',
  inputSchema: z.object({
    topic: z.string().describe('What the team is working on'),
    agents: z.array(z.object({
      id: z.string(),
      name: z.string(),
      provider: z.enum(['claude', 'qwen']).default('qwen'),
      role: z.string().describe('One-line role description'),
      color: z.string().default('#888888'),
    })).describe('Team members'),
  }),
}, async (args: { topic: string; agents: BoardroomAgent[] }) => {
  const boardroom = createBoardroom(projectRoot, args.topic, args.agents);
  activity.append('boardroom_created', `Boardroom: ${args.topic}`, boardroom.id);
  return text(`Boardroom ${boardroom.id} created: "${args.topic}" with ${args.agents.length} agents`);
});

server.registerTool('hw_run_boardroom', {
  title: 'Run Boardroom',
  description: 'Start agent collaboration in a boardroom. Agents take turns chatting.',
  inputSchema: z.object({
    boardroomId: z.string(),
    rounds: z.number().optional().describe('Number of rounds (default 8)'),
  }),
}, async (args: { boardroomId: string; rounds?: number }) => {
  const boardroom = readBoardroom(projectRoot, args.boardroomId);
  if (!boardroom) return text(`Boardroom ${args.boardroomId} not found`);

  // Run in background -- don't block the MCP call.
  // File watcher in Tauri detects JSON changes automatically.
  const noopNotify = () => {};
  runBoardroom(projectRoot, args.boardroomId, noopNotify, args.rounds).catch(() => {});
  return text(`Boardroom ${args.boardroomId} running with ${boardroom.agents.length} agents for ${args.rounds ?? 8} rounds`);
});

server.registerTool('hw_stop_boardroom', {
  title: 'Stop Boardroom',
  description: 'Stop a running boardroom session.',
  inputSchema: z.object({}),
}, async () => {
  stopBoardroom();
  return text('Boardroom stopped');
});

server.registerTool('hw_read_boardroom', {
  title: 'Read Boardroom',
  description: 'Read a boardroom\'s chat and whiteboard.',
  inputSchema: z.object({ boardroomId: z.string() }),
}, async (args: { boardroomId: string }) => {
  const boardroom = readBoardroom(projectRoot, args.boardroomId);
  if (!boardroom) return text(`Boardroom ${args.boardroomId} not found`);

  const chatLines = boardroom.chat.map((m) => {
    const agent = boardroom.agents.find((a) => a.id === m.agentId);
    return `[${agent?.name ?? m.agentId}] ${m.text}`;
  });

  const wbLines = boardroom.whiteboard.map((w) => {
    const agent = boardroom.agents.find((a) => a.id === w.agentId);
    return `[${w.section}] (${agent?.name ?? w.agentId}) ${w.content}`;
  });

  return text([
    `Boardroom: ${boardroom.topic} (${boardroom.status})`,
    `Agents: ${boardroom.agents.map((a) => `${a.name} (${a.provider})`).join(', ')}`,
    `\n--- Chat (${boardroom.chat.length} messages) ---`,
    ...chatLines,
    `\n--- Whiteboard (${boardroom.whiteboard.length} entries) ---`,
    ...wbLines,
  ].join('\n'));
});

server.registerTool('hw_list_boardrooms', {
  title: 'List Boardrooms',
  description: 'List all boardrooms.',
  inputSchema: z.object({}),
}, async () => {
  const rooms = listBoardrooms(projectRoot);
  if (rooms.length === 0) return text('No boardrooms yet.');
  const lines = rooms.map((r) =>
    `${r.id} | ${r.status} | ${r.agents.length} agents | ${r.chat.length} msgs | ${r.topic}`
  );
  return text(lines.join('\n'));
});

server.registerTool('hw_usage', {
  title: 'Usage Summary',
  description: 'Get Qwen and Claude token usage and cost summary.',
  inputSchema: z.object({}),
}, async () => {
  const summary = getUsageSummary(projectRoot);
  const lines = [
    `=== Usage Summary ===`,
    `Total: ${summary.totalTokens.toLocaleString()} tokens | $${summary.totalCostUsd.toFixed(4)}`,
    `Claude: ${summary.claudeTokens.toLocaleString()} tokens | $${summary.claudeCostUsd.toFixed(4)}`,
    `Qwen: ${summary.qwenTokens.toLocaleString()} tokens | $${summary.qwenCostUsd.toFixed(4)}`,
    `This session: ${summary.sessionTokens.toLocaleString()} tokens | $${summary.sessionCostUsd.toFixed(4)}`,
    `Entries: ${summary.entries}`,
  ];
  if (Object.keys(summary.byContext).length > 0) {
    lines.push('', 'By context:');
    for (const [ctx, data] of Object.entries(summary.byContext)) {
      lines.push(`  ${ctx}: ${data.tokens.toLocaleString()} tokens | $${data.costUsd.toFixed(4)}`);
    }
  }
  return text(lines.join('\n'));
});

server.registerTool('hw_close_boardroom', {
  title: 'Close Boardroom',
  description: 'Close a boardroom session.',
  inputSchema: z.object({ boardroomId: z.string() }),
}, async (args: { boardroomId: string }) => {
  closeBoardroom(projectRoot, args.boardroomId);
  return text(`Boardroom ${args.boardroomId} closed`);
});

server.registerTool('hw_qwen_panel', {
  title: 'Qwen Panel',
  description: 'Run parallel Qwen agents on a topic with file injection. No char limit, no rounds. Each agent gets the full topic + injected files and produces an independent analysis. Results saved to .hello-world/panels/.',
  inputSchema: z.object({
    topic: z.string().describe('What the panel should analyze'),
    agents: z.array(z.object({
      id: z.string(),
      name: z.string(),
      role: z.string().describe('System prompt for this agent perspective'),
    })).describe('Panel agents (3-7 recommended)'),
    filePaths: z.array(z.string()).optional().describe('Absolute paths to files to inject into agent prompts'),
    facts: z.array(z.string()).optional().describe('Known facts to inject'),
    questions: z.array(z.string()).optional().describe('Required questions each agent must answer'),
    maxTokens: z.number().optional().describe('Max output tokens per agent (default 4000)'),
  }),
}, async (args: { topic: string; agents: PanelAgent[]; filePaths?: string[]; facts?: string[]; questions?: string[]; maxTokens?: number }) => {
  activity.append('panel_started', `Panel: ${args.topic}`, `${args.agents.length} agents, ${args.filePaths?.length ?? 0} files`);

  const result = await runPanel(projectRoot, args.topic, args.agents, {
    filePaths: args.filePaths,
    facts: args.facts,
    questions: args.questions,
    maxTokens: args.maxTokens,
  });

  activity.append('panel_completed', `Panel ${result.id}: ${args.topic}`, `${result.totalTokens} tokens, ${(result.durationMs / 1000).toFixed(1)}s`);

  return text(formatPanelResult(result));
});

// ── Claude Usage ─────────────────────────────────────────────────

// LiteLLM pricing (per-token, not per-million). Updated Feb 2026.
const CLAUDE_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-4-6':            { input: 15e-6,  output: 75e-6,  cacheWrite: 18.75e-6, cacheRead: 1.5e-6 },
  'claude-sonnet-4-5-20250929': { input: 3e-6,   output: 15e-6,  cacheWrite: 3.75e-6,  cacheRead: 0.3e-6 },
  'claude-sonnet-4-6':          { input: 3e-6,   output: 15e-6,  cacheWrite: 3.75e-6,  cacheRead: 0.3e-6 },
  'claude-haiku-4-5-20251001':  { input: 0.8e-6, output: 4e-6,   cacheWrite: 1e-6,     cacheRead: 0.08e-6 },
};

function calcModelCost(model: string, usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number }): number {
  // Try exact match, then prefix match
  const p = CLAUDE_PRICING[model] ?? Object.entries(CLAUDE_PRICING).find(([k]) => model.includes(k))?.[1];
  if (!p) return 0;
  return (usage.inputTokens * p.input)
       + (usage.outputTokens * p.output)
       + (usage.cacheCreationInputTokens * p.cacheWrite)
       + (usage.cacheReadInputTokens * p.cacheRead);
}

server.registerTool('hw_get_claude_usage', {
  title: 'Get Claude Usage',
  description: 'Read Claude Code usage stats from ~/.claude/stats-cache.json and write enriched data to .hello-world/claude-usage.json.',
  inputSchema: z.object({}),
}, async () => {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cachePath = join(home, '.claude', 'stats-cache.json');

  if (!existsSync(cachePath)) {
    return text('No stats-cache.json found at ' + cachePath);
  }

  const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));

  // Enrich model usage with calculated costs
  const modelBreakdown: Record<string, unknown> = {};
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (const [model, usage] of Object.entries(raw.modelUsage ?? {})) {
    const u = usage as { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };
    const cost = calcModelCost(model, { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheCreationInputTokens: u.cacheCreationInputTokens, cacheReadInputTokens: u.cacheReadInputTokens });
    totalCostUsd += cost;
    totalInputTokens += u.inputTokens;
    totalOutputTokens += u.outputTokens;
    totalCacheRead += u.cacheReadInputTokens;
    totalCacheWrite += u.cacheCreationInputTokens;
    modelBreakdown[model] = { ...u, costUsd: Math.round(cost * 100) / 100 };
  }

  // Build daily usage with costs
  const dailyTokens = (raw.dailyModelTokens ?? []).map((day: { date: string; tokensByModel: Record<string, number> }) => ({
    date: day.date,
    totalTokens: Object.values(day.tokensByModel).reduce((s: number, v: number) => s + v, 0),
    byModel: day.tokensByModel,
  }));

  const result = {
    generatedAt: new Date().toISOString(),
    lastComputedDate: raw.lastComputedDate,
    totalSessions: raw.totalSessions ?? 0,
    totalMessages: raw.totalMessages ?? 0,
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    totalInputTokens,
    totalOutputTokens,
    totalCacheRead,
    totalCacheWrite,
    modelBreakdown,
    dailyActivity: raw.dailyActivity ?? [],
    dailyTokens,
    firstSessionDate: raw.firstSessionDate,
    hourCounts: raw.hourCounts ?? {},
  };

  // Write to .hello-world/ so the frontend can read it
  const outPath = join(projectRoot, '.hello-world', 'claude-usage.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  return text(
    `Claude usage: $${result.totalCostUsd.toFixed(2)} total across ${result.totalSessions} sessions, ${result.totalMessages.toLocaleString()} messages.\n` +
    `Models: ${Object.keys(modelBreakdown).join(', ')}\n` +
    `Input: ${totalInputTokens.toLocaleString()} | Output: ${totalOutputTokens.toLocaleString()} | Cache read: ${totalCacheRead.toLocaleString()} | Cache write: ${totalCacheWrite.toLocaleString()}`
  );
});

// ── Deliberation & Chatroom Tools ────────────────────────────────

server.registerTool('hw_list_agents', {
  title: 'List Deliberation Agents',
  description: 'List all available deliberation agents grouped by category (cognitive, domain, usersim). Use this to select the right agents before planning a deliberation.',
  inputSchema: z.object({}),
}, async () => {
  const grouped: Record<string, typeof AGENT_ROSTER> = {};
  for (const a of AGENT_ROSTER) {
    (grouped[a.category] ??= []).push(a);
  }
  const lines = Object.entries(grouped).map(([cat, agents]) =>
    `${cat}:\n${agents.map(a => `  ${a.id} — ${a.name}`).join('\n')}`
  ).join('\n\n');
  return text(`${AGENT_ROSTER.length} agents available:\n\n${lines}`);
});

server.registerTool('hw_plan_deliberation', {
  title: 'Plan Deliberation',
  description: `Plan a deliberation before running it. Creates a block-tier approval for Pat to review.

REQUIRED: You must provide numbered sub-questions and a balance assessment.
- subQuestions: Break the topic into specific numbered questions that each need a substantive answer.
- balanceNotes: For each agent that might dominate or skew consensus, state the risk and your counterbalance strategy.

The plan is stored on the session and enforced: hw_conclude_deliberation will require a coverage report showing how each sub-question was resolved. After approval, call hw_start_deliberation with the same agents.`,
  inputSchema: z.object({
    topic: z.string().describe('The concrete, well-framed deliberation topic'),
    agents: z.array(z.string()).min(2).max(6).describe('Agent IDs selected for this topic'),
    framing: z.string().describe('Why this topic needs deliberation and what outcome you expect'),
    rationale: z.string().describe('Why these specific agents were chosen for this topic'),
    subQuestions: z.array(z.string()).min(2).max(10).describe('Numbered sub-questions that each need a substantive answer. Every question must be addressed before synthesis.'),
    balanceNotes: z.array(z.object({
      agentId: z.string().describe('Agent ID that might skew the deliberation'),
      risk: z.string().describe('How this agent might dominate or distort consensus'),
      counterbalance: z.string().describe('What the mediator will do to counteract this risk'),
    })).optional().describe('Optional balance assessment: which agents might dominate and your counterbalance strategy for each'),
  }),
}, async (args: { topic: string; agents: string[]; framing: string; rationale: string; subQuestions: string[]; balanceNotes?: { agentId: string; risk: string; counterbalance: string }[] }) => {
  const agentNames = args.agents.map(id => AGENT_DEFINITIONS[id]?.name ?? id);

  const sqList = args.subQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n');

  const descParts = [
    `Topic: ${args.topic}`,
    `\nFraming: ${args.framing}`,
    `\nAgents: ${agentNames.join(', ')}`,
    `\nRationale: ${args.rationale}`,
    `\nSub-questions (each must be addressed before synthesis):\n${sqList}`,
  ];
  if (args.balanceNotes?.length) {
    const bnList = args.balanceNotes.map(b => `  - ${AGENT_DEFINITIONS[b.agentId]?.name ?? b.agentId}: Risk: ${b.risk} | Counter: ${b.counterbalance}`).join('\n');
    descParts.push(`\nBalance assessment:\n${bnList}`);
  }
  const description = descParts.join('\n');

  const plan: { subQuestions: { id: number; text: string; status: 'pending' }[]; balanceNotes?: { agentId: string; risk: string; counterbalance: string }[] } = {
    subQuestions: args.subQuestions.map((q, i) => ({
      id: i + 1,
      text: q,
      status: 'pending' as const,
    })),
  };
  if (args.balanceNotes?.length) {
    plan.balanceNotes = args.balanceNotes;
  }
  const planPath = join(projectRoot, '.hello-world', 'deliberation-plan-pending.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');

  const bnCount = args.balanceNotes?.length ?? 0;
  const request = approvals.requestApproval('deliberation_plan', `Run deliberation: "${args.topic.slice(0, 80)}"`, description);
  activity.append('deliberation_planned', `Deliberation plan: "${args.topic.slice(0, 60)}"`, `Agents: ${agentNames.join(', ')}\nSub-questions: ${args.subQuestions.length}${bnCount ? `\nBalance notes: ${bnCount}` : ''}`);

  sendDiscordDM(`Deliberation plan needs approval (${request.id})\nTopic: ${args.topic.slice(0, 100)}\nAgents: ${agentNames.join(', ')}\n${args.subQuestions.length} sub-questions${bnCount ? `, ${bnCount} balance notes` : ''}\nReply "approve ${request.id}" or "reject ${request.id}"`).catch(() => {});

  return text(`Deliberation plan created. Approval required: ${request.id}\nTopic: "${args.topic}"\nAgents: ${agentNames.join(', ')}\nSub-questions: ${args.subQuestions.length}${bnCount ? `\nBalance notes: ${bnCount}` : ''}\nPat must approve before deliberation starts.`);
});

server.registerTool('hw_extract_deliberation_recommendations', {
  title: 'Extract Deliberation Recommendations',
  description: 'After a deliberation concludes, extract concrete recommendations into individual approval tasks. Each recommendation becomes a block-tier approval that Pat can approve or reject in the Approvals tab.',
  inputSchema: z.object({
    recommendations: z.array(z.object({
      title: z.string().describe('Short title for the recommendation'),
      description: z.string().describe('What should be done and why'),
      type: z.enum(['task', 'decision', 'scope']).describe('What this becomes if approved'),
    })).min(1).max(10).describe('Recommendations extracted from the deliberation synthesis'),
  }),
}, async (args: { recommendations: { title: string; description: string; type: string }[] }) => {
  const state = chatroom.read();
  const topicRef = state.session.topic?.slice(0, 80) ?? 'unknown';
  const ids: string[] = [];

  for (const rec of args.recommendations) {
    const context = `From deliberation: "${topicRef}"\nType: ${rec.type}\n\n${rec.description}`;
    const request = approvals.requestApproval('deliberation_recommendation', rec.title, context);
    ids.push(request.id);
  }

  activity.append('deliberation_recommendations', `${args.recommendations.length} recommendations extracted`, `From: "${topicRef}"`);

  const lines = args.recommendations.map((r, i) => `${i + 1}. [${r.type}] ${r.title} (${ids[i]})`).join('\n');
  sendDiscordDM(`${args.recommendations.length} deliberation recommendations need approval:\n${lines}\nReply "approve <id>" or "reject <id>" for each.`).catch(() => {});

  return text(`${args.recommendations.length} recommendations created as approval requests:\n${args.recommendations.map((r, i) => `- ${ids[i]}: [${r.type}] ${r.title}`).join('\n')}\n\nPat can approve/reject each in the Approvals tab.`);
});

server.registerTool('hw_start_deliberation', {
  title: 'Start Deliberation',
  description: 'Start a multi-agent chatroom deliberation session. Available agents: cognitive (contrarian, premortem, firstprinciples, steelman, analogist, constraint, pragmatist), domain (uxdesigner, backendarch, productmgr, costanalyst, devops, security), usersim (newuser, poweruser). Use hw_plan_deliberation first to get Pat approval.',
  inputSchema: z.object({
    topic: z.string().describe('The topic or question to deliberate on'),
    mode: z.enum(['default', 'usersim']).optional().describe('Agent set to use. default = cognitive lenses, usersim = user perspectives.'),
    agents: z.array(z.string()).optional().describe('Override: specific agent IDs. Overrides mode.'),
    providerOverrides: z.record(z.enum(['claude', 'qwen'])).optional().describe('Per-agent provider override. E.g. {"contrarian": "qwen", "pragmatist": "qwen"} to run those agents on Qwen instead of Claude.'),
  }),
}, async (args: { topic: string; mode?: 'default' | 'usersim'; agents?: string[]; providerOverrides?: Record<string, 'claude' | 'qwen'> }) => {
  const agentIds = args.agents ?? (args.mode === 'usersim' ? USER_SIM_AGENTS : DEFAULT_AGENTS);
  const state = chatroom.startSession(args.topic, agentIds, 'claude', AGENT_DEFINITIONS, args.providerOverrides);

  const planPath = join(projectRoot, '.hello-world', 'deliberation-plan-pending.json');
  try {
    const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
    chatroom.setDeliberationPlan(plan);
    unlinkSync(planPath);
  } catch { /* no plan file = no guardrails, deliberation still works */ }

  activity.append('deliberation_started', `Deliberation: "${args.topic}"`, `Agents: ${agentIds.join(', ')}`);
  runDeliberation(chatroom, notifyRunner).catch(() => {});

  const planState = chatroom.read();
  const sqCount = planState.session.plan?.subQuestions.length ?? 0;
  const planNote = sqCount > 0 ? `\n${sqCount} sub-questions tracked. Coverage check required before synthesis.` : '';

  return text(`Deliberation started with ${state.agents.length} agents: ${state.agents.map(a => a.name).join(', ')}\nTopic: "${args.topic}"\nIntro sequence running -- agents will appear one by one.${planNote}`);
});

server.registerTool('hw_pause_deliberation', {
  title: 'Pause Deliberation',
  description: 'Pause the active deliberation to allow input or review.',
  inputSchema: z.object({}),
}, async () => {
  stopDeliberation();
  chatroom.setSessionStatus('paused', true);
  activity.append('deliberation_paused', 'Deliberation paused', '');
  return text('Deliberation paused. Resume with hw_resume_deliberation or conclude with hw_conclude_deliberation.');
});

server.registerTool('hw_resume_deliberation', {
  title: 'Resume Deliberation',
  description: 'Resume a paused deliberation.',
  inputSchema: z.object({}),
}, async () => {
  chatroom.setSessionStatus('active', false);
  activity.append('deliberation_resumed', 'Deliberation resumed', '');
  runDeliberation(chatroom, notifyRunner).catch(() => {});
  return text('Deliberation resumed.');
});

server.registerTool('hw_check_deliberation_coverage', {
  title: 'Check Deliberation Coverage',
  description: `REQUIRED before synthesis. Reports which sub-questions have been addressed and how. You must call this and resolve any gaps before calling hw_conclude_deliberation.

For each sub-question, provide its current status AND quality tag:
- status: "addressed" (engaged), "lumped" (dismissed without engagement), "pending" (not discussed)
- quality: "consensus" (agents agreed quickly -- potential red flag), "tension" (real disagreement surfaced), "shifted" (an agent changed position)

If any question is "lumped" or "pending", you must redirect the deliberation to address it before concluding.
WARNING: All-consensus across every sub-question is a yellow flag -- it may indicate shallow deliberation or groupthink.`,
  inputSchema: z.object({
    coverage: z.array(z.object({
      questionId: z.number().describe('The sub-question number (1-based)'),
      status: z.enum(['addressed', 'lumped', 'pending']).describe('Whether agents substantively engaged with this question'),
      quality: z.enum(['consensus', 'tension', 'shifted']).optional().describe('Quality of engagement: consensus = quick agreement (potential red flag), tension = real disagreement, shifted = position changed'),
      addressedBy: z.array(z.string()).optional().describe('Agent IDs that substantively addressed it'),
      resolution: z.string().optional().describe('One-line summary of what was decided for this question'),
    })),
  }),
}, async (args: { coverage: { questionId: number; status: 'addressed' | 'lumped' | 'pending'; quality?: 'consensus' | 'tension' | 'shifted'; addressedBy?: string[]; resolution?: string }[] }) => {
  const state = chatroom.read();
  if (!state.session.plan) {
    return text('No deliberation plan found. Coverage check only applies to planned deliberations.');
  }

  for (const c of args.coverage) {
    chatroom.updateSubQuestion(c.questionId, c.status, c.addressedBy, c.resolution, c.quality);
  }

  const updated = chatroom.read();
  const plan = updated.session.plan!;
  const gaps = plan.subQuestions.filter(sq => sq.status === 'pending' || sq.status === 'lumped');
  const addressed = plan.subQuestions.filter(sq => sq.status === 'addressed');

  if (gaps.length > 0) {
    const gapList = gaps.map(sq => `  ${sq.id}. [${sq.status.toUpperCase()}] ${sq.text}`).join('\n');
    activity.append('deliberation_coverage_gap', `${gaps.length} sub-questions unresolved`, gapList);
    return text(`COVERAGE GAP: ${gaps.length} of ${plan.subQuestions.length} sub-questions need attention:\n${gapList}\n\nYou must redirect the deliberation to address these before concluding. Use hw_post_to_chatroom to intervene as mediator.`);
  }

  const qualityTags = addressed.map(sq => sq.quality ?? 'consensus');
  const allConsensus = qualityTags.every(q => q === 'consensus');
  const tensionCount = qualityTags.filter(q => q === 'tension').length;
  const shiftedCount = qualityTags.filter(q => q === 'shifted').length;
  const consensusCount = qualityTags.filter(q => q === 'consensus').length;

  const qualityLabel = (sq: typeof addressed[0]) => {
    const q = sq.quality ?? 'consensus';
    const tag = q === 'tension' ? 'TENSION' : q === 'shifted' ? 'SHIFTED' : 'CONSENSUS';
    return `[${tag}]`;
  };

  const summary = addressed.map(sq => `  ${sq.id}. ${qualityLabel(sq)} ${sq.text} -> ${sq.resolution ?? 'addressed'}`).join('\n');
  const qualitySummary = `Quality: ${tensionCount} tension, ${shiftedCount} shifted, ${consensusCount} consensus`;

  if (allConsensus) {
    activity.append('deliberation_coverage_warning', `All ${plan.subQuestions.length} sub-questions addressed but ALL CONSENSUS`, `${qualitySummary}\n${summary}`);
    return text(`COVERAGE COMPLETE but ALL-CONSENSUS WARNING: Every sub-question reached quick agreement. This may indicate shallow deliberation or groupthink.\n${qualitySummary}\n${summary}\n\nConsider: Did any agent actually push back? Should you re-engage contrarian perspectives before concluding?`);
  }

  activity.append('deliberation_coverage_complete', `All ${plan.subQuestions.length} sub-questions addressed`, `${qualitySummary}\n${summary}`);
  return text(`COVERAGE COMPLETE: All ${plan.subQuestions.length} sub-questions addressed.\n${qualitySummary}\n${summary}\n\nYou may now call hw_conclude_deliberation.`);
});

server.registerTool('hw_conclude_deliberation', {
  title: 'Conclude Deliberation',
  description: `Conclude the deliberation with a summary decision. If a deliberation plan exists with sub-questions, you MUST call hw_check_deliberation_coverage first and all questions must be addressed.

IMPORTANT: Your conclusion summary should reference the synthesis. If a synthesis message exists in the chatroom, your conclusion must align with it -- do not revert to earlier positions that were superseded during discussion.`,
  inputSchema: z.object({
    summary: z.string().describe('Summary of the deliberation outcome / decision reached. Must align with the synthesis if one exists.'),
  }),
}, async (args: { summary: string }) => {
  const state = chatroom.read();
  const plan = state.session.plan;

  if (plan && plan.subQuestions.length > 0) {
    const gaps = plan.subQuestions.filter(sq => sq.status === 'pending' || sq.status === 'lumped');
    if (gaps.length > 0) {
      const gapList = gaps.map(sq => `  ${sq.id}. [${sq.status.toUpperCase()}] ${sq.text}`).join('\n');
      return text(`BLOCKED: Cannot conclude -- ${gaps.length} sub-questions unresolved:\n${gapList}\n\nCall hw_check_deliberation_coverage after addressing these gaps.`);
    }
  }

  const synthMessages = state.messages.filter(m =>
    m.agentId === 'claude' && m.type === 'claude' &&
    (m.text.toLowerCase().includes('synthesis') || m.text.toLowerCase().includes('## synthesis'))
  );
  const synthesisWarning = synthMessages.length === 0
    ? '\nWARNING: No synthesis message found in chatroom. Conclusion may not reflect the full discussion.'
    : '';

  chatroom.appendMessage('system', `Concluded: ${args.summary}`, 'system');
  chatroom.setSessionStatus('concluded');
  activity.append('deliberation_concluded', 'Deliberation concluded', args.summary);
  return text(`Deliberation concluded. Summary recorded: "${args.summary}"${synthesisWarning}`);
});

server.registerTool('hw_quick_insights', {
  title: 'Quick Insights',
  description: `Run a lightweight, non-binding insight session. NOT a deliberation -- no sub-questions, no coverage tracking, no approval gates. Use this for flavor-testing ideas, quick sanity checks, or exploring a topic before deciding whether to run a full deliberation.

Output is bulk-dismissable and clearly labeled as non-binding. If real tension surfaces, escalate to a full deliberation with hw_plan_deliberation.

This is separate from deliberation by design. Do NOT use this as a shortcut to skip guardrails on decisions that matter.`,
  inputSchema: z.object({
    topic: z.string().describe('The question or topic to get quick insights on'),
    agents: z.array(z.string()).min(2).max(4).optional().describe('Agent IDs (2-4). Defaults to contrarian + pragmatist + firstprinciples.'),
    providerOverrides: z.record(z.enum(['claude', 'qwen'])).optional().describe('Per-agent provider override. E.g. {"contrarian": "qwen"} to run that agent on Qwen.'),
  }),
}, async (args: { topic: string; agents?: string[]; providerOverrides?: Record<string, 'claude' | 'qwen'> }) => {
  const agentIds = args.agents ?? ['contrarian', 'pragmatist', 'firstprinciples'];
  const state = chatroom.startSession(args.topic, agentIds, 'claude', AGENT_DEFINITIONS, args.providerOverrides);

  chatroom.appendMessage('system', 'Quick insights session (non-binding). No coverage tracking. Escalate to full deliberation if real tension surfaces.', 'system');

  activity.append('quick_insights_started', `Quick insights: "${args.topic.slice(0, 60)}"`, `Agents: ${agentIds.join(', ')}`);
  runDeliberation(chatroom, notifyRunner).catch(() => {});

  return text(`Quick insights session started with ${state.agents.length} agents: ${state.agents.map(a => a.name).join(', ')}\nTopic: "${args.topic}"\nThis is NON-BINDING flavor-testing. No sub-questions or coverage tracking.\nIf real tension surfaces, escalate to hw_plan_deliberation.`);
});

server.registerTool('hw_set_deliberation_phase', {
  title: 'Set Deliberation Phase',
  description: 'Advance the deliberation to a named phase. Claude (Reason) calls this to signal phase transitions to the UI. Phases: frame -> deliberate -> synthesis -> patinput -> decision.',
  inputSchema: z.object({
    phase: z.enum(['frame', 'deliberate', 'synthesis', 'patinput', 'decision']).describe('The phase to move to'),
  }),
}, async (args: { phase: 'frame' | 'deliberate' | 'synthesis' | 'patinput' | 'decision' }) => {
  const state = chatroom.read();
  if (state.session.status === 'idle') {
    return text('No active deliberation.');
  }
  chatroom.setDeliberationPhase(args.phase);
  chatroom.appendMessage('system', `Phase: ${args.phase}`, 'system');
  activity.append('deliberation_phase', `Phase -> ${args.phase}`, '');
  return text(`Deliberation phase set to: ${args.phase}`);
});

server.registerTool('hw_react', {
  title: 'React',
  description: 'Post an emoji reaction as an agent -- appears as a combat-text floater above their head in the UI. Use while another agent is speaking to show real-time reactions (e.g. agreement, skepticism, surprise). Keep it to a single emoji.',
  inputSchema: z.object({
    agentId: z.string().describe('The reacting agent ID'),
    emoji: z.string().describe('Single emoji to react with'),
  }),
}, async (args: { agentId: string; emoji: string }) => {
  const state = chatroom.read();
  if (state.session.status === 'idle') return text('No active deliberation.');
  const valid = [...state.agents.map(a => a.id), 'claude'];
  if (!valid.includes(args.agentId)) return text(`Unknown agent "${args.agentId}". Valid: ${valid.join(', ')}`);
  chatroom.appendReaction(args.agentId, args.emoji);
  activity.append('agent_reacted', `${args.agentId}: ${args.emoji}`, '');
  return text(`Reaction posted: ${args.agentId} ${args.emoji}`);
});

server.registerTool('hw_post_to_chatroom', {
  title: 'Post to Chatroom',
  description: 'Post a message as Claude (golden buddy) to the deliberation chatroom.',
  inputSchema: z.object({
    message: z.string().describe('Message to post as Claude'),
  }),
}, async (args: { message: string }) => {
  const state = chatroom.read();
  if (state.session.status === 'idle') {
    return text('No active deliberation. Start one with hw_start_deliberation first.');
  }
  if (args.message.length > 670) {
    return text(`Message too long (${args.message.length} chars). Keep it under 670 -- 1-2 sentences, occasional paragraph.`);
  }
  chatroom.appendMessage('claude', args.message, 'claude');
  activity.append('claude_posted_to_chatroom', `Claude: ${args.message.slice(0, 60)}`, '');
  return text('Posted to chatroom.');
});

server.registerTool('hw_post_agent_message', {
  title: 'Post Agent Message',
  description: 'Post a message as a specific agent (architect, critic, product, security) to the deliberation chatroom. Claude uses this to voice each agent persona during a deliberation. Etiquette: agents have full conversation context, respond to what was actually said, speak in natural turn order (not round-robin), stay silent when they have nothing to add, and keep messages under 670 chars (1-2 sentences; a paragraph when truly needed).',
  inputSchema: z.object({
    agentId: z.string().describe('The agent ID to post as (e.g. architect, critic, product, security)'),
    message: z.string().describe('The message to post as this agent'),
  }),
}, async (args: { agentId: string; message: string }) => {
  const state = chatroom.read();
  if (state.session.status === 'idle') {
    return text('No active deliberation. Start one with hw_start_deliberation first.');
  }
  const validAgent = state.agents.find(a => a.id === args.agentId);
  if (!validAgent) {
    const valid = state.agents.map(a => a.id).join(', ');
    return text(`Unknown agent "${args.agentId}". Active agents: ${valid}`);
  }
  if (args.message.length > 670) {
    return text(`Message too long (${args.message.length} chars). Keep it under 670 -- 1-2 sentences, occasional paragraph.`);
  }
  chatroom.appendMessage(args.agentId, args.message, 'message');
  activity.append('agent_posted_to_chatroom', `${validAgent.name}: ${args.message.slice(0, 60)}`, '');

  const updated = chatroom.read();
  const recent = updated.messages.slice(-6).map(m => `[${m.agentId}] ${m.text}`).join('\n');
  return text(`Posted as ${validAgent.name}.\n\nRecent thread:\n${recent}`);
});

// ── Start ───────────────────────────────────────────────────────

// Write capabilities manifest so hooks + app can check MCP status
const capabilitiesPath = join(projectRoot, '.hello-world', 'capabilities.json');
const TOOL_CATALOG = [
  { name: 'hw_get_context', category: 'context' },
  { name: 'hw_write_handoff', category: 'context' },
  { name: 'hw_retrieve_memories', category: 'memory' },
  { name: 'hw_store_memory', category: 'memory' },
  { name: 'hw_list_tasks', category: 'tasks' },
  { name: 'hw_add_task', category: 'tasks' },
  { name: 'hw_update_task', category: 'tasks' },
  { name: 'hw_record_decision', category: 'decisions' },
  { name: 'hw_update_direction', category: 'direction' },
  { name: 'hw_process_direction_note', category: 'direction' },
  { name: 'hw_notify', category: 'notifications' },
  { name: 'hw_record_failure', category: 'safety' },
  { name: 'hw_end_session', category: 'sessions' },
  { name: 'hw_brain_health', category: 'brain' },
  { name: 'hw_get_workflow_state', category: 'workflow' },
  { name: 'hw_advance_phase', category: 'workflow' },
  { name: 'hw_check_autonomous_timer', category: 'workflow' },
  { name: 'hw_spawn_watcher', category: 'watchers' },
  { name: 'hw_list_watchers', category: 'watchers' },
  { name: 'hw_kill_watcher', category: 'watchers' },
  { name: 'hw_get_claude_usage', category: 'usage' },
  { name: 'hw_create_boardroom', category: 'boardroom' },
  { name: 'hw_run_boardroom', category: 'boardroom' },
  { name: 'hw_stop_boardroom', category: 'boardroom' },
  { name: 'hw_read_boardroom', category: 'boardroom' },
  { name: 'hw_list_boardrooms', category: 'boardroom' },
  { name: 'hw_close_boardroom', category: 'boardroom' },
  { name: 'hw_qwen_panel', category: 'boardroom' },
  { name: 'hw_usage', category: 'cost' },
  { name: 'hw_list_agents', category: 'deliberation' },
  { name: 'hw_plan_deliberation', category: 'deliberation' },
  { name: 'hw_start_deliberation', category: 'deliberation' },
  { name: 'hw_pause_deliberation', category: 'deliberation' },
  { name: 'hw_resume_deliberation', category: 'deliberation' },
  { name: 'hw_check_deliberation_coverage', category: 'deliberation' },
  { name: 'hw_conclude_deliberation', category: 'deliberation' },
  { name: 'hw_extract_deliberation_recommendations', category: 'deliberation' },
  { name: 'hw_quick_insights', category: 'deliberation' },
  { name: 'hw_set_deliberation_phase', category: 'chatroom' },
  { name: 'hw_react', category: 'chatroom' },
  { name: 'hw_post_to_chatroom', category: 'chatroom' },
  { name: 'hw_post_agent_message', category: 'chatroom' },
];

try {
  writeFileSync(capabilitiesPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    status: 'running',
    pid: process.pid,
    tools: TOOL_CATALOG,
  }, null, 2), 'utf-8');
} catch { /* non-fatal */ }

process.on('exit', () => {
  try {
    writeFileSync(capabilitiesPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: 'stopped',
      pid: process.pid,
      tools: TOOL_CATALOG,
    }, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
});

const transport = new StdioServerTransport();
await server.connect(transport);
