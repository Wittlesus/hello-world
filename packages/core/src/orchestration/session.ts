import type { Session, Task, Decision, Question } from '../types.js';
import { SessionSchema } from '../types.js';
import { JsonStore } from '../storage.js';
import { generateId, now } from '../utils.js';
import { StateManager } from '../state.js';
import { MemoryStore } from '../brain/store.js';
import { retrieveMemories } from '../brain/engine.js';
import { initBrainState } from '../brain/state.js';

export interface ContextSnapshot {
  projectName: string;
  sessionNumber: number;
  previousSession: { date: string; summary: string } | null;
  activeTasks: Task[];
  blockedTasks: Task[];
  recentDecisions: Decision[];
  openQuestions: Question[];
  memoryInjection: string;
  costSummary: { lifetimeUsd: number; budgetRemainingUsd: number };
  compiledText: string;
}

export class SessionManager {
  private store: JsonStore<{ sessions: Session[] }>;
  private current: Session | null = null;

  constructor(private readonly projectRoot: string) {
    this.store = new JsonStore<{ sessions: Session[] }>(projectRoot, 'sessions.json', { sessions: [] });
  }

  start(): Session {
    const sessions = this.store.read().sessions;
    const session = SessionSchema.parse({
      id: generateId('s'),
      startedAt: now(),
    });
    this.current = session;
    this.store.update(data => ({ sessions: [...data.sessions, session] }));
    return session;
  }

  end(summary: string, costUsd = 0, tokensUsed = 0): Session | null {
    if (!this.current) return null;
    const ended: Session = {
      ...this.current,
      endedAt: now(),
      summary,
      costUsd,
      tokensUsed,
    };
    this.current = null;
    this.store.update(data => ({
      sessions: data.sessions.map(s => s.id === ended.id ? ended : s),
    }));
    return ended;
  }

  recordTaskCompleted(taskId: string): void {
    if (!this.current) return;
    this.current.tasksCompleted.push(taskId);
    this.store.update(data => ({
      sessions: data.sessions.map(s => s.id === this.current!.id ? this.current! : s),
    }));
  }

  recordDecisionMade(decisionId: string): void {
    if (!this.current) return;
    this.current.decisionsMade.push(decisionId);
  }

  getCurrent(): Session | null {
    return this.current;
  }

  list(): Session[] {
    return this.store.read().sessions;
  }

  /**
   * Compile the context snapshot Claude sees at session start.
   * This is the critical function — it's what makes cross-session memory work.
   */
  compileContext(
    projectName: string,
    state: StateManager,
    memoryStore: MemoryStore,
    dailyBudget: number,
  ): ContextSnapshot {
    const sessions = this.list();
    const sessionNumber = sessions.length;
    const previous = sessions.length > 1 ? sessions[sessions.length - 2] : null;

    const activeTasks = state.listTasks('in_progress');
    const todoTasks = state.getUnblockedTasks();
    const blockedTasks = state.listTasks('blocked');
    const recentDecisions = state.getRecentDecisions(5);
    const openQuestions = state.listQuestions('open');

    // Initialize brain for this session
    const brainState = initBrainState(memoryStore.getBrainState());
    memoryStore.saveBrainState(brainState);

    // Run retrieval against current task context
    const taskContext = [...activeTasks, ...todoTasks]
      .map(t => t.title)
      .join('. ');
    const memories = memoryStore.getAllMemories();
    const retrieval = retrieveMemories(taskContext || projectName, memories, brainState);

    // Calculate cost summary
    const lifetimeUsd = sessions.reduce((sum, s) => sum + s.costUsd, 0);

    // Compile human-readable text
    const lines: string[] = [
      `Project: ${projectName}`,
      `Session: #${sessionNumber}`,
    ];

    if (previous) {
      lines.push(`Last session: ${previous.startedAt.split('T')[0]} — ${previous.summary || '(no summary)'}`);
    }

    if (activeTasks.length > 0) {
      lines.push('', 'Active tasks:');
      for (const t of activeTasks) lines.push(`  - [${t.status}] ${t.title}`);
    }

    if (todoTasks.length > 0) {
      lines.push('', 'Ready to start:');
      for (const t of todoTasks.slice(0, 5)) lines.push(`  - ${t.title}`);
      if (todoTasks.length > 5) lines.push(`  ... and ${todoTasks.length - 5} more`);
    }

    if (blockedTasks.length > 0) {
      lines.push('', 'Blocked:');
      for (const t of blockedTasks) lines.push(`  - ${t.title}`);
    }

    if (recentDecisions.length > 0) {
      lines.push('', 'Recent decisions:');
      for (const d of recentDecisions) lines.push(`  - ${d.title}: ${d.chosen}`);
    }

    if (openQuestions.length > 0) {
      lines.push('', 'Open questions:');
      for (const q of openQuestions) lines.push(`  - ${q.question}`);
    }

    lines.push('', `Cost: $${lifetimeUsd.toFixed(2)} lifetime | $${(dailyBudget - lifetimeUsd).toFixed(2)} remaining`);

    if (retrieval.injectionText) {
      lines.push('', '--- Memory ---', retrieval.injectionText);
    }

    return {
      projectName,
      sessionNumber,
      previousSession: previous ? { date: previous.startedAt, summary: previous.summary } : null,
      activeTasks: [...activeTasks, ...todoTasks],
      blockedTasks,
      recentDecisions,
      openQuestions,
      memoryInjection: retrieval.injectionText,
      costSummary: { lifetimeUsd, budgetRemainingUsd: dailyBudget - lifetimeUsd },
      compiledText: lines.join('\n'),
    };
  }
}
