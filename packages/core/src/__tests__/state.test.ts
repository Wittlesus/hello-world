import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Project } from '../project.js';

describe('StateManager', () => {
  let tmpDir: string;
  let project: Project;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hw-test-'));
    project = Project.init(tmpDir, 'test-project', 'A test project');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Tasks', () => {
    it('creates and retrieves tasks', () => {
      const task = project.state.addTask('Build the thing');
      expect(task.id).toMatch(/^t_/);
      expect(task.title).toBe('Build the thing');
      expect(task.status).toBe('todo');

      const retrieved = project.state.getTask(task.id);
      expect(retrieved).toEqual(task);
    });

    it('updates task status', () => {
      const task = project.state.addTask('Fix the bug');
      const updated = project.state.updateTask(task.id, { status: 'in_progress' });
      expect(updated.status).toBe('in_progress');
    });

    it('lists tasks by status', () => {
      project.state.addTask('Task A');
      const b = project.state.addTask('Task B');
      project.state.addTask('Task C');
      project.state.updateTask(b.id, { status: 'in_progress' });

      expect(project.state.listTasks('todo')).toHaveLength(2);
      expect(project.state.listTasks('in_progress')).toHaveLength(1);
    });

    it('tracks task dependencies', () => {
      const a = project.state.addTask('Task A');
      const b = project.state.addTask('Task B', { dependsOn: [a.id] });
      const c = project.state.addTask('Task C', { dependsOn: [a.id, b.id] });

      const deps = project.state.getDependencies(c.id);
      expect(deps).toHaveLength(2);
      expect(deps.map((d) => d.id)).toContain(a.id);
      expect(deps.map((d) => d.id)).toContain(b.id);
    });

    it('finds unblocked tasks', () => {
      const a = project.state.addTask('Task A');
      const b = project.state.addTask('Task B', { dependsOn: [a.id] });
      project.state.addTask('Task C');

      // A and C are unblocked, B is blocked by A
      let unblocked = project.state.getUnblockedTasks();
      expect(unblocked).toHaveLength(2);
      expect(unblocked.map((t) => t.id)).not.toContain(b.id);

      // Complete A → B becomes unblocked
      project.state.updateTask(a.id, { status: 'done' });
      unblocked = project.state.getUnblockedTasks();
      expect(unblocked.map((t) => t.id)).toContain(b.id);
    });

    it('removes tasks', () => {
      const task = project.state.addTask('Doomed task');
      project.state.removeTask(task.id);
      expect(project.state.getTask(task.id)).toBeUndefined();
    });
  });

  describe('Milestones', () => {
    it('creates and completes milestones', () => {
      const ms = project.state.addMilestone('v1.0', 'First release');
      expect(ms.completed).toBe(false);

      const completed = project.state.completeMilestone(ms.id);
      expect(completed.completed).toBe(true);
      expect(completed.completedAt).toBeDefined();
    });
  });

  describe('Decisions', () => {
    it('records architecture decisions', () => {
      const dec = project.state.addDecision('Use Tauri over Electron', {
        context: 'Need a desktop app framework',
        chosen: 'Tauri',
        rationale: 'Smaller bundle, Rust process spawning, no subprocess hang',
        decidedBy: 'both',
        alternatives: [
          { option: 'Electron', tradeoff: 'Larger bundle, subprocess issues' },
          { option: 'VS Code extension', tradeoff: 'Limited UX control' },
        ],
      });

      expect(dec.id).toMatch(/^d_/);
      expect(dec.chosen).toBe('Tauri');
      expect(dec.alternatives).toHaveLength(2);

      const recent = project.state.getRecentDecisions(1);
      expect(recent[0].id).toBe(dec.id);
    });
  });

  describe('Questions', () => {
    it('tracks known unknowns through lifecycle', () => {
      const q = project.state.addQuestion('What database should we use?', 'Need persistence');
      expect(q.status).toBe('open');

      const answered = project.state.answerQuestion(q.id, 'SQLite — local-first');
      expect(answered.status).toBe('answered');
      expect(answered.answer).toBe('SQLite — local-first');

      const open = project.state.listQuestions('open');
      expect(open).toHaveLength(0);
    });

    it('defers questions', () => {
      const q = project.state.addQuestion('Cloud sync strategy?');
      project.state.deferQuestion(q.id);
      expect(project.state.listQuestions('deferred')).toHaveLength(1);
    });
  });

  describe('Project', () => {
    it('persists state across open/close', () => {
      project.state.addTask('Persistent task');
      project.state.addDecision('Test decision', {
        context: 'test',
        chosen: 'option A',
        rationale: 'because',
        decidedBy: 'claude',
      });

      // Reopen project from disk
      const reopened = Project.open(tmpDir);
      expect(reopened.state.listTasks()).toHaveLength(1);
      expect(reopened.state.listDecisions()).toHaveLength(1);
      expect(reopened.config.name).toBe('test-project');
    });

    it('throws when init on existing project', () => {
      expect(() => Project.init(tmpDir, 'duplicate')).toThrow('already exists');
    });

    it('throws when open non-existent project', () => {
      const fakePath = join(tmpDir, 'nonexistent');
      expect(() => Project.open(fakePath)).toThrow('No Hello World project found');
    });
  });
});
