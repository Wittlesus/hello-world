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

interface StateData {
  tasks: Task[];
  milestones: Milestone[];
  decisions: Decision[];
  questions: Question[];
}

const EMPTY_STATE: StateData = {
  tasks: [],
  milestones: [],
  decisions: [],
  questions: [],
};

export class StateManager {
  private store: JsonStore<StateData>;

  constructor(projectRoot: string) {
    this.store = new JsonStore<StateData>(projectRoot, 'state.json', EMPTY_STATE);
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

    this.store.update(data => ({
      ...data,
      tasks: [...data.tasks, task],
    }));

    return task;
  }

  updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): Task {
    let updated: Task | undefined;

    this.store.update(data => ({
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

  removeTask(id: string): void {
    this.store.update(data => ({
      ...data,
      tasks: data.tasks.filter(t => t.id !== id),
    }));
  }

  getTask(id: string): Task | undefined {
    return this.store.read().tasks.find(t => t.id === id);
  }

  listTasks(status?: TaskStatus): Task[] {
    const { tasks } = this.store.read();
    return status ? tasks.filter(t => t.status === status) : tasks;
  }

  getUnblockedTasks(): Task[] {
    const { tasks } = this.store.read();
    const doneTasks = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));

    return tasks
      .filter(t => t.status === 'todo')
      .filter(t => t.dependsOn.every(dep => doneTasks.has(dep)));
  }

  getDependencies(taskId: string): Task[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    const { tasks } = this.store.read();
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

    this.store.update(data => ({
      ...data,
      milestones: [...data.milestones, milestone],
    }));

    return milestone;
  }

  completeMilestone(id: string): Milestone {
    let updated: Milestone | undefined;

    this.store.update(data => ({
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
    return this.store.read().milestones;
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

    this.store.update(data => ({
      ...data,
      decisions: [...data.decisions, decision],
    }));

    return decision;
  }

  listDecisions(): Decision[] {
    return this.store.read().decisions;
  }

  getRecentDecisions(count = 5): Decision[] {
    return this.store.read().decisions.slice(-count);
  }

  // ── Questions (Known Unknowns) ──────────────────────────────

  addQuestion(question: string, context = ''): Question {
    const q = QuestionSchema.parse({
      id: generateId('q'),
      question,
      context,
      createdAt: now(),
    });

    this.store.update(data => ({
      ...data,
      questions: [...data.questions, q],
    }));

    return q;
  }

  answerQuestion(id: string, answer: string): Question {
    let updated: Question | undefined;

    this.store.update(data => ({
      ...data,
      questions: data.questions.map(q => {
        if (q.id !== id) return q;
        updated = { ...q, status: 'answered' as QuestionStatus, answer, answeredAt: now() };
        return updated;
      }),
    }));

    if (!updated) throw new Error(`Question not found: ${id}`);
    return updated;
  }

  deferQuestion(id: string): Question {
    let updated: Question | undefined;

    this.store.update(data => ({
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
    const { questions } = this.store.read();
    return status ? questions.filter(q => q.status === status) : questions;
  }
}
