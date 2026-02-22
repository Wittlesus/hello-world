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
import { Project } from '../project.js';
import { MemoryStore } from '../brain/store.js';
import { SessionManager } from '../orchestration/session.js';
import { ApprovalGates } from '../orchestration/approvals.js';
import { TwoStrikeEngine } from '../orchestration/strikes.js';
import { ActivityStore } from '../activity.js';
import { retrieveMemories } from '../brain/engine.js';
import { tickMessageCount, recordSynapticActivity, recordMemoryTraces } from '../brain/state.js';
import type { MemoryType, MemorySeverity } from '../types.js';

const projectRoot = process.env.HW_PROJECT_ROOT ?? process.cwd();

let project: Project;
let memoryStore: MemoryStore;
let sessions: SessionManager;
let approvals: ApprovalGates;
let strikes: TwoStrikeEngine;
let activity: ActivityStore;

try {
  project = Project.open(projectRoot);
  memoryStore = new MemoryStore(projectRoot, project.config.name);
  sessions = new SessionManager(projectRoot);
  approvals = new ApprovalGates();
  strikes = new TwoStrikeEngine();
  activity = new ActivityStore(projectRoot);
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
  return text(ctx.compiledText);
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
  return text(`BLOCKED: "${args.action}" requires Pat's approval. Request: ${req.id}. STOP and ask Pat. ${args.description}`);
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
  description: 'Answer a previously recorded question.',
  inputSchema: z.object({ id: z.string(), answer: z.string() }),
}, async (args: { id: string; answer: string }) => {
  const q = project.state.answerQuestion(args.id, args.answer);
  activity.append('question_answered', `Answered: ${q.question.slice(0, 60)}`, args.answer);
  return text(`Question ${q.id} answered: "${args.answer}"`);
});

// ── Start ───────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
