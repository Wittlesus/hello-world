import {
  type Task,
  type Milestone,
  type Decision,
  type Question,
  type TaskStatus,
  type QuestionStatus,
  TaskSchema,
  MilestoneSchema,
  DecisionSchema,
  QuestionSchema,
} from './types.js';
import { JsonStore } from './storage.js';
import { generateId, now } from './utils.js';

import { existsSync, readFileSync, renameSync as fsRenameSync } from 'node:fs';
import { join } from 'node:path';
import { HW_DIR } from './types.js';

interface TasksData { tasks: Task[]; milestones: Milestone[]; }
interface DecisionsData { decisions: Decision[]; }
interface QuestionsData { questions: Question[]; }

export class StateManager {
  private taskStore: JsonStore<TasksData>;
  private decisionStore: JsonStore<DecisionsData>;
  private questionStore: JsonStore<QuestionsData>;

  constructor(projectRoot: string) {
    this.taskStore = new JsonStore<TasksData>(projectRoot, 'tasks.json', { tasks: [], milestones: [] });
    this.decisionStore = new JsonStore<DecisionsData>(projectRoot, 'decisions.json', { decisions: [] });
    this.questionStore = new JsonStore<QuestionsData>(projectRoot, 'questions.json', { questions: [] });

    // Migration: if old state.json exists, split it into new files
    this.migrateFromStateJson(projectRoot);
  }

  private migrateFromStateJson(projectRoot: string): void {
    const oldPath = join(projectRoot, HW_DIR, 'state.json');
    if (!existsSync(oldPath)) return;

    try {
      const old = JSON.parse(readFileSync(oldPath, 'utf-8'));
      if (old.tasks || old.milestones) {
        // Only migrate if new files don't have data yet
        const current = this.taskStore.read();
        if (current.tasks.length === 0) {
          this.taskStore.write({
            tasks: old.tasks ?? [],
            milestones: old.milestones ?? [],
          });
        }
      }
      if (old.decisions) {
        const current = this.decisionStore.read();
        if (current.decisions.length === 0) {
          this.decisionStore.write({ decisions: old.decisions });
        }
      }
      if (old.questions) {
        const current = this.questionStore.read();
        if (current.questions.length === 0) {
          this.questionStore.write({ questions: old.questions });
        }
      }
      // Mark as migrated by renaming
      const migratedPath = join(projectRoot, HW_DIR, 'state.json.migrated');
      if (!existsSync(migratedPath)) {
        try { fsRenameSync(oldPath, migratedPath); } catch { /* idempotent */ }
      }
    } catch {
      // Old file is corrupted or unreadable -- skip migration
    }
  }

  // ── Tasks ───────────────────────────────────────────────────

  addTask(title: string, opts: Partial<Omit<Task, 'id' | 'title' | 'createdAt' | 'updatedAt'>> = {}): Task {
    const timestamp = now();
    const task = TaskSchema.parse({
      id: generateId('t'),
      title,
      ...opts,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    this.taskStore.update(data => ({
      ...data,
      tasks: [...data.tasks, task],
    }));

    return task;
  }

  updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): Task {
    // Epics cannot be started directly — they must be decomposed into child tasks first
    if (updates.status === 'in_progress') {
      const task = this.getTask(id);
      if (task?.size === 'Epic') {
        const children = this.getEpicChildren(id);
        if (children.length === 0) {
          throw new Error(`Cannot start Epic "${task.title}" — decompose it into child tasks first`);
        }
      }
    }

    let updated: Task | undefined;

    this.taskStore.update(data => ({
      ...data,
      tasks: data.tasks.map(t => {
        if (t.id !== id) return t;
        updated = { ...t, ...updates, updatedAt: now() };
        return updated;
      }),
    }));

    if (!updated) throw new Error(`Task not found: ${id}`);
    return updated;
  }

  getEpicChildren(epicId: string): Task[] {
    return this.taskStore.read().tasks.filter(t => t.parentId === epicId);
  }

  removeTask(id: string): void {
    this.taskStore.update(data => ({
      ...data,
      tasks: data.tasks.filter(t => t.id !== id),
    }));
  }

  getTask(id: string): Task | undefined {
    return this.taskStore.read().tasks.find(t => t.id === id);
  }

  listTasks(status?: TaskStatus): Task[] {
    const { tasks } = this.taskStore.read();
    return status ? tasks.filter(t => t.status === status) : tasks;
  }

  getUnblockedTasks(): Task[] {
    const { tasks } = this.taskStore.read();
    const doneTasks = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));

    return tasks
      .filter(t => t.status === 'todo')
      .filter(t => t.dependsOn.every(dep => doneTasks.has(dep)));
  }

  getDependencies(taskId: string): Task[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    const { tasks } = this.taskStore.read();
    return tasks.filter(t => task.dependsOn.includes(t.id));
  }

  // ── Milestones ──────────────────────────────────────────────

  addMilestone(title: string, description = ''): Milestone {
    const milestone = MilestoneSchema.parse({
      id: generateId('m'),
      title,
      description,
      createdAt: now(),
    });

    this.taskStore.update(data => ({
      ...data,
      milestones: [...data.milestones, milestone],
    }));

    return milestone;
  }

  completeMilestone(id: string): Milestone {
    let updated: Milestone | undefined;

    this.taskStore.update(data => ({
      ...data,
      milestones: data.milestones.map(m => {
        if (m.id !== id) return m;
        updated = { ...m, completed: true, completedAt: now() };
        return updated;
      }),
    }));

    if (!updated) throw new Error(`Milestone not found: ${id}`);
    return updated;
  }

  listMilestones(): Milestone[] {
    return this.taskStore.read().milestones;
  }

  // ── Decisions ───────────────────────────────────────────────

  addDecision(
    title: string,
    opts: {
      context: string;
      chosen: string;
      rationale: string;
      decidedBy: 'pat' | 'claude' | 'both';
      alternatives?: Array<{ option: string; tradeoff: string }>;
    },
  ): Decision {
    const decision = DecisionSchema.parse({
      id: generateId('d'),
      title,
      ...opts,
      decidedAt: now(),
    });

    this.decisionStore.update(data => ({
      ...data,
      decisions: [...data.decisions, decision],
    }));

    return decision;
  }

  listDecisions(): Decision[] {
    return this.decisionStore.read().decisions;
  }

  getRecentDecisions(count = 5): Decision[] {
    return this.decisionStore.read().decisions.slice(-count);
  }

  // ── Questions (Known Unknowns) ──────────────────────────────

  addQuestion(question: string, context = ''): Question {
    const q = QuestionSchema.parse({
      id: generateId('q'),
      question,
      context,
      createdAt: now(),
    });

    this.questionStore.update(data => ({
      ...data,
      questions: [...data.questions, q],
    }));

    return q;
  }

  answerQuestion(id: string, answer: string, opts?: { linkedTaskId?: string; linkedDecisionId?: string }): Question {
    let updated: Question | undefined;

    this.questionStore.update(data => ({
      ...data,
      questions: data.questions.map(q => {
        if (q.id !== id) return q;
        updated = { ...q, status: 'answered' as QuestionStatus, answer, answeredAt: now(), ...opts };
        return updated;
      }),
    }));

    if (!updated) throw new Error(`Question not found: ${id}`);
    return updated;
  }

  deferQuestion(id: string): Question {
    let updated: Question | undefined;

    this.questionStore.update(data => ({
      ...data,
      questions: data.questions.map(q => {
        if (q.id !== id) return q;
        updated = { ...q, status: 'deferred' as QuestionStatus };
        return updated;
      }),
    }));

    if (!updated) throw new Error(`Question not found: ${id}`);
    return updated;
  }

  listQuestions(status?: QuestionStatus): Question[] {
    const { questions } = this.questionStore.read();
    return status ? questions.filter(q => q.status === status) : questions;
  }
}
