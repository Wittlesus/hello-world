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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Project } from '../project.js';
import { MemoryStore } from '../brain/store.js';
import { SessionManager } from '../orchestration/session.js';
import { ApprovalGates } from '../orchestration/approvals.js';
import { TwoStrikeEngine } from '../orchestration/strikes.js';
import { ActivityStore } from '../activity.js';
import { WorkflowEngine } from '../orchestration/workflow.js';
import { retrieveMemories } from '../brain/engine.js';
import { tickMessageCount, recordSynapticActivity, recordMemoryTraces } from '../brain/state.js';
import type { MemoryType, MemorySeverity } from '../types.js';

const projectRoot = process.env.HW_PROJECT_ROOT ?? process.cwd();
const HANDOFF_FILE = join(projectRoot, '.hello-world', 'restart-handoff.json');

let project: Project;
let memoryStore: MemoryStore;
let sessions: SessionManager;
let approvals: ApprovalGates;
let strikes: TwoStrikeEngine;
let activity: ActivityStore;
let workflow: WorkflowEngine;

try {
  project = Project.open(projectRoot);
  memoryStore = new MemoryStore(projectRoot, project.config.name);
  sessions = new SessionManager(projectRoot);
  approvals = new ApprovalGates(projectRoot);
  strikes = new TwoStrikeEngine(projectRoot);
  activity = new ActivityStore(projectRoot);
  workflow = new WorkflowEngine(projectRoot);
} catch {
  console.error(`No Hello World project at ${projectRoot}. Run 'hello-world init' first.`);
  process.exit(1);
}

const server = new McpServer({ name: 'hello-world', version: '0.1.0' });
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

// ── Context & Memory ────────────────────────────────────────────

server.registerTool('hw_get_context', {
  title: 'Get Project Context',
  description: 'Get the full project context snapshot. Call this at the start of every session.',
  inputSchema: z.object({}),
}, async () => {
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

  return text(ctx.compiledText + handoffSection);
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
  const memories = memoryStore.getAllMemories();
  const brainState = memoryStore.getBrainState();
  const result = retrieveMemories(args.prompt, memories, brainState);
  if (brainState) {
    let updated = tickMessageCount(brainState);
    updated = recordSynapticActivity(updated, result.matchedTags);
    const ids = [...result.painMemories, ...result.winMemories].map(s => s.memory.id);
    updated = recordMemoryTraces(updated, ids);
    memoryStore.saveBrainState(updated);
    memoryStore.incrementAccess(ids);
  }
  const count = result.painMemories.length + result.winMemories.length;
  activity.append('memory_retrieved', `Retrieved ${count} memories for: "${args.prompt.slice(0, 60)}"`, result.injectionText || 'No matches.');
  return text(result.injectionText || 'No relevant memories found.');
});

server.registerTool('hw_store_memory', {
  title: 'Store Memory',
  description: 'Store a memory. Types: pain (mistakes), win (successes), fact (reference), decision, architecture.',
  inputSchema: z.object({
    type: z.enum(['pain', 'win', 'fact', 'decision', 'architecture']),
    title: z.string(),
    content: z.string().optional(),
    rule: z.string().optional(),
    tags: z.array(z.string()).optional(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
  }),
}, async (args: { type: string; title: string; content?: string; rule?: string; tags?: string[]; severity?: string }) => {
  const mem = memoryStore.storeMemory({
    type: args.type as MemoryType,
    title: args.title,
    content: args.content,
    rule: args.rule,
    tags: args.tags,
    severity: args.severity as MemorySeverity | undefined,
  });
  activity.append('memory_stored', `[${mem.type.toUpperCase()}] ${mem.title}`, mem.content ?? mem.rule ?? '');
  return text(`Memory stored: ${mem.id} (${mem.type}) "${mem.title}"`);
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
  const updates: Record<string, unknown> = {};
  if (args.status) updates.status = args.status;
  if (args.description) updates.description = args.description;
  const task = project.state.updateTask(args.id, updates);
  if (args.status === 'done') sessions.recordTaskCompleted(args.id);
  activity.append('task_updated', `[${task.status.toUpperCase()}] ${task.title}`, args.description ?? '');
  return text(`Task ${task.id} updated to [${task.status}]`);
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
  return text(`Decision recorded: ${dec.id} "${dec.title}" -> ${dec.chosen}`);
});

// ── Discord Notifications ────────────────────────────────────────

const DISCORD_BOT_TOKEN = 'MTQ3NTI3NjQ3OTY4MzIzNTk0Mg.GMInN0.NxGNJTClBjBfSx8Jde5UXC3QT4-lVg1Yjzlr1o';
const PAT_USER_ID = '403706305144946690';

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

server.registerTool('hw_check_approval', {
  title: 'Check Approval',
  description: 'Check if an action needs human approval. Call before destructive ops (git push, delete, deploy).',
  inputSchema: z.object({ action: z.string(), description: z.string() }),
}, async (args: { action: string; description: string }) => {
  const tier = approvals.classifyAction(args.action);
  if (tier === 'auto') {
    activity.append('approval_auto', `Auto-approved: ${args.action}`, args.description);
    return text(`AUTO-APPROVED: "${args.action}" is safe to proceed.`);
  }
  if (tier === 'notify') {
    activity.append('approval_auto', `Notify: ${args.action}`, args.description);
    return text(`NOTIFY: "${args.action}" — proceeding. Pat will see this. ${args.description}`);
  }
  const req = approvals.requestApproval(args.action, args.description);
  activity.append('approval_requested', `BLOCKED: ${args.action} — waiting for Pat`, args.description);
  await sendDiscordDM(`🔴 **Approval needed** (${req.id})\n**Action:** ${args.action}\n**Reason:** ${args.description}\n\nReply \`approve ${req.id}\` or \`reject ${req.id}\``);
  return text(`BLOCKED: "${args.action}" requires Pat's approval. Request: ${req.id}. STOP and ask Pat. ${args.description}`);
});

server.registerTool('hw_list_approvals', {
  title: 'List Approval Requests',
  description: 'List pending approval requests that need Pat\'s decision.',
  inputSchema: z.object({}),
}, async () => {
  const pending = approvals.getPending();
  if (pending.length === 0) return text('No pending approvals.');
  const lines = pending.map(r =>
    `[${r.id}] ${r.action} (${r.tier})\n  ${r.description}${r.context ? `\n  Context: ${r.context}` : ''}`
  );
  return text(`${pending.length} pending:\n\n${lines.join('\n\n')}`);
});

server.registerTool('hw_resolve_approval', {
  title: 'Resolve Approval',
  description: 'Approve or reject a pending approval request.',
  inputSchema: z.object({
    requestId: z.string(),
    decision: z.enum(['approved', 'rejected']),
    notes: z.string().optional(),
  }),
}, async (args: { requestId: string; decision: 'approved' | 'rejected'; notes?: string }) => {
  const resolved = approvals.resolveApproval(args.requestId, args.decision, args.notes);
  activity.append('approval_resolved', `${args.decision.toUpperCase()}: ${resolved.action}`, args.notes ?? '');
  return text(`${args.decision.toUpperCase()}: "${resolved.action}" (${resolved.id})`);
});

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
  if (check.shouldHalt) {
    activity.append('strike_halt', `TWO-STRIKE HALT on task ${args.taskId}`, args.errorMessage);
    return text(`TWO-STRIKE HALT!\n\n${strikes.getAlternatives(args.taskId)}\n\nSTOP. Present 2-3 fundamentally different approaches to Pat.`);
  }
  activity.append('strike_recorded', `Strike ${check.count}/2: ${args.errorMessage.slice(0, 80)}`, `Task: ${args.taskId}\nApproach: ${args.approach}`);
  return text(`Strike ${check.count}/2 recorded for task ${args.taskId}. Try a different angle.`);
});

// ── Sessions ────────────────────────────────────────────────────

server.registerTool('hw_end_session', {
  title: 'End Session',
  description: 'End current session with a summary.',
  inputSchema: z.object({ summary: z.string() }),
}, async (args: { summary: string }) => {
  activity.append('session_end', 'Session ended', args.summary);
  const session = sessions.end(args.summary);
  if (!session) return text('No active session.');
  return text(`Session ${session.id} ended. ${session.startedAt} -> ${session.endedAt}`);
});

// ── Questions ───────────────────────────────────────────────────

server.registerTool('hw_add_question', {
  title: 'Add Question',
  description: 'Record a known unknown.',
  inputSchema: z.object({ question: z.string(), context: z.string().optional() }),
}, async (args: { question: string; context?: string }) => {
  const q = project.state.addQuestion(args.question, args.context);
  activity.append('question_added', `Question: ${q.question.slice(0, 80)}`, args.context ?? '');
  return text(`Question recorded: ${q.id} "${q.question}"`);
});

server.registerTool('hw_answer_question', {
  title: 'Answer Question',
  description: 'Answer a previously recorded question. Optionally route to a task (if the answer implies action) or a decision (if it reveals a tradeoff).',
  inputSchema: z.object({
    id: z.string(),
    answer: z.string(),
    route: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('task'),
        title: z.string(),
        description: z.string().optional(),
      }),
      z.object({
        type: z.literal('decision'),
        title: z.string(),
        context: z.string(),
        chosen: z.string(),
        rationale: z.string(),
        decidedBy: z.enum(['pat', 'claude', 'both']).default('claude'),
      }),
    ]).optional(),
  }),
}, async (args: { id: string; answer: string; route?: { type: 'task'; title: string; description?: string } | { type: 'decision'; title: string; context: string; chosen: string; rationale: string; decidedBy: 'pat' | 'claude' | 'both' } }) => {
  let linkedTaskId: string | undefined;
  let linkedDecisionId: string | undefined;
  const routeMsgs: string[] = [];

  if (args.route?.type === 'task') {
    const task = project.state.addTask(args.route.title, {
      description: args.route.description ?? '',
      status: 'todo',
    });
    linkedTaskId = task.id;
    activity.append('task_added', `Task from Q&A: ${task.title}`, `Triggered by question ${args.id}`);
    routeMsgs.push(`Task created: ${task.id} "${task.title}"`);
  } else if (args.route?.type === 'decision') {
    const decision = project.state.addDecision(args.route.title, {
      context: args.route.context,
      chosen: args.route.chosen,
      rationale: args.route.rationale,
      decidedBy: args.route.decidedBy ?? 'claude',
    });
    linkedDecisionId = decision.id;
    activity.append('decision_added', `Decision from Q&A: ${decision.title}`, `Triggered by question ${args.id}`);
    routeMsgs.push(`Decision logged: ${decision.id} "${decision.title}"`);
  }

  const q = project.state.answerQuestion(args.id, args.answer, { linkedTaskId, linkedDecisionId });
  activity.append('question_answered', `Answered: ${q.question.slice(0, 60)}`, args.answer);

  const lines = [`Question ${q.id} answered.`, ...routeMsgs];
  return text(lines.join('\n'));
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
  { name: 'hw_add_question', category: 'questions' },
  { name: 'hw_answer_question', category: 'questions' },
  { name: 'hw_update_direction', category: 'direction' },
  { name: 'hw_notify', category: 'notifications' },
  { name: 'hw_check_approval', category: 'approvals' },
  { name: 'hw_list_approvals', category: 'approvals' },
  { name: 'hw_resolve_approval', category: 'approvals' },
  { name: 'hw_record_failure', category: 'safety' },
  { name: 'hw_end_session', category: 'sessions' },
  { name: 'hw_get_workflow_state', category: 'workflow' },
  { name: 'hw_advance_phase', category: 'workflow' },
  { name: 'hw_check_autonomous_timer', category: 'workflow' },
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
