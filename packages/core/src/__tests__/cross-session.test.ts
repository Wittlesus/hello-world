import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../brain/store.js';
import { SessionManager } from '../orchestration/session.js';
import { Project } from '../project.js';
import { StateManager } from '../state.js';

describe('Cross-Session Memory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hw-cross-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('session 2 context contains session 1 state without re-prompting', () => {
    // === SESSION 1 ===
    const project = Project.init(tmpDir, 'cross-session-test', 'Testing memory persistence');
    const sessions1 = new SessionManager(tmpDir);
    const memory1 = new MemoryStore(tmpDir, 'cross-session-test');

    // Start session 1
    sessions1.start();

    // Simulate work: create tasks, make decisions, store memories
    const taskA = project.state.addTask('Build authentication module', {
      tags: ['auth', 'security'],
    });
    const taskB = project.state.addTask('Write auth tests', { dependsOn: [taskA.id] });
    project.state.updateTask(taskA.id, { status: 'done' });

    project.state.addDecision('Use JWT over sessions', {
      context: 'Need stateless auth for API',
      chosen: 'JWT with refresh tokens',
      rationale: 'Stateless, scalable, works with microservices',
      decidedBy: 'both',
      alternatives: [
        { option: 'Session cookies', tradeoff: 'Stateful, simpler but harder to scale' },
      ],
    });

    project.state.addQuestion('Should we use Redis for token blacklist?');

    // Store memories from session 1
    memory1.storeMemory({
      type: 'pain',
      title: 'bcrypt timing attack possible with early return',
      content: 'Using == instead of constant-time comparison for password hashes',
      rule: 'Always use crypto.timingSafeEqual for hash comparison',
      tags: ['security', 'authentication'],
      severity: 'high',
    });

    memory1.storeMemory({
      type: 'win',
      title: 'JWT refresh token rotation working',
      content: 'Implemented refresh token rotation with family tracking',
      tags: ['authentication', 'security'],
    });

    memory1.storeMemory({
      type: 'decision',
      title: 'Chose RS256 over HS256 for JWT signing',
      content: 'Asymmetric signing allows public key verification without sharing secret',
      tags: ['authentication', 'architecture'],
    });

    // End session 1
    sessions1.end('Built auth module, JWT working, tests pending', 0.45, 15000);

    // === SESSION 2 === (fresh instances, just like a new Claude session)
    const project2 = Project.open(tmpDir);
    const sessions2 = new SessionManager(tmpDir);
    const memory2 = new MemoryStore(tmpDir, 'cross-session-test');

    // Start session 2
    sessions2.start();

    // Compile context — this is what Claude would see
    const context = sessions2.compileContext(project2.config.name, project2.state, memory2, 5.0);

    // === ASSERTIONS: Session 2 knows everything from Session 1 ===

    // 1. It knows the previous session happened
    expect(context.previousSession).not.toBeNull();
    expect(context.previousSession!.summary).toContain('auth');

    // 2. It knows task A is done and task B is ready
    const taskTitles = context.activeTasks.map((t) => t.title);
    expect(taskTitles).toContain('Write auth tests');

    // 3. It knows the JWT decision
    expect(context.recentDecisions.length).toBeGreaterThan(0);
    const jwtDecision = context.recentDecisions.find((d) => d.chosen.includes('JWT'));
    expect(jwtDecision).toBeDefined();

    // 4. It knows the open question
    expect(context.openQuestions.length).toBeGreaterThan(0);
    expect(context.openQuestions[0].question).toContain('Redis');

    // 5. Memory injection contains the pain memory (security-relevant)
    expect(context.memoryInjection).toContain('PAIN MEMORY');
    expect(context.memoryInjection).toContain('bcrypt');

    // 6. Memory injection contains the win memory
    expect(context.memoryInjection).toContain('WIN MEMORY');
    expect(context.memoryInjection).toContain('JWT refresh token');

    // 7. Cost is tracked
    expect(context.costSummary.lifetimeUsd).toBeCloseTo(0.45, 1);

    // 8. The compiled text is a complete briefing
    expect(context.compiledText).toContain('cross-session-test');
    expect(context.compiledText).toContain('Write auth tests');
    expect(context.compiledText).toContain('JWT');
    expect(context.compiledText).toContain('Redis');
    expect(context.compiledText).toContain('PAIN MEMORY');

    // 9. Session number is correct
    expect(context.sessionNumber).toBe(2);
  });

  it('brain state persists across sessions (plasticity/decay)', () => {
    Project.init(tmpDir, 'brain-persist-test');
    const memory = new MemoryStore(tmpDir, 'brain-persist-test');
    const sessions = new SessionManager(tmpDir);

    // Session 1: store memories, start session, trigger retrieval
    memory.storeMemory({
      type: 'pain',
      title: 'Deploy without tests',
      tags: ['deployment', 'testing'],
      severity: 'high',
    });

    sessions.start();
    const ctx1 = sessions.compileContext('brain-persist-test', new StateManager(tmpDir), memory, 5);
    sessions.end('session 1 done', 0.1, 5000);

    // Session 2: brain should have decayed strengths and preserved traces
    const sessions2 = new SessionManager(tmpDir);
    const memory2 = new MemoryStore(tmpDir, 'brain-persist-test');
    sessions2.start();

    const brainState = memory2.getBrainState();
    expect(brainState).not.toBeNull();
    // Session start applies decay — strengths should have moved toward 1.0
    expect(brainState!.sessionStart).toBeDefined();
    // Session-local counters reset
    expect(brainState!.messageCount).toBe(0);
    expect(brainState!.activeTraces).toHaveLength(0);
  });

  it('multiple sessions accumulate decisions and memories', () => {
    Project.init(tmpDir, 'accumulate-test');

    // Run 3 "sessions" adding state each time
    for (let i = 1; i <= 3; i++) {
      const project = Project.open(tmpDir);
      const sessions = new SessionManager(tmpDir);
      const memory = new MemoryStore(tmpDir, 'accumulate-test');

      sessions.start();
      project.state.addTask(`Task from session ${i}`);
      project.state.addDecision(`Decision ${i}`, {
        context: `Context for session ${i}`,
        chosen: `Option ${i}A`,
        rationale: 'Best option',
        decidedBy: 'claude',
      });
      memory.storeMemory({
        type: i % 2 === 0 ? 'win' : 'pain',
        title: `Memory from session ${i}`,
        tags: ['session-test'],
      });
      sessions.end(`Session ${i} complete`, 0.1 * i, 1000 * i);
    }

    // Session 4: verify everything accumulated
    const project = Project.open(tmpDir);
    const sessions = new SessionManager(tmpDir);
    const memory = new MemoryStore(tmpDir, 'accumulate-test');

    sessions.start();
    const context = sessions.compileContext('accumulate-test', project.state, memory, 5);

    expect(context.sessionNumber).toBe(4);
    expect(context.activeTasks.length).toBe(3);
    expect(context.recentDecisions.length).toBe(3);
    expect(context.previousSession!.summary).toContain('Session 3');
    expect(context.costSummary.lifetimeUsd).toBeCloseTo(0.6, 1); // 0.1 + 0.2 + 0.3
  });
});
