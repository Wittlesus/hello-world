/**
 * Dogfood test: Hello World manages its own development.
 *
 * This test initializes the Hello World project directory as a
 * Hello World project, records real architecture decisions from
 * the build process, and verifies the system works on itself.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../brain/store.js';
import { SessionManager } from '../orchestration/session.js';
import { Project } from '../project.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../..');

describe('Dogfood: Hello World manages itself', () => {
  it('project is initialized', () => {
    expect(existsSync(resolve(PROJECT_ROOT, '.hello-world'))).toBe(true);
  });

  it('can open itself as a project', () => {
    const project = Project.open(PROJECT_ROOT);
    expect(project.config.name).toBe('Hello World');
  });

  it('records architecture decisions from the build', () => {
    const project = Project.open(PROJECT_ROOT);

    // Record the real decisions we made
    if (project.state.listDecisions().length === 0) {
      project.state.addDecision('Use Tauri over Electron', {
        context: 'Electron subprocess hangs after 6+ attempts. Need reliable process spawning.',
        chosen: 'Tauri (Rust backend + webview)',
        rationale:
          'Smaller bundle, Rust process spawning is reliable, existing React code ports directly',
        decidedBy: 'both',
        alternatives: [
          { option: 'Electron', tradeoff: 'Subprocess hangs, 150MB+ bundle' },
          { option: 'VS Code extension', tradeoff: 'Limited UX control, plugin not product' },
        ],
      });

      project.state.addDecision('Hybrid stack: Rust I/O + TypeScript domain logic', {
        context: 'Need fast I/O (process spawning, file ops) but rapid iteration on domain logic',
        chosen: 'Rust for I/O, TypeScript for brain/state/agents',
        rationale:
          'Best of both worlds — reliability where it matters, iteration speed where it matters',
        decidedBy: 'claude',
      });

      project.state.addDecision('Port Synaptica brain engine as memory layer', {
        context: 'Need cross-session project memory. Synaptica already has hippocampal retrieval.',
        chosen: 'Port 9-stage pipeline from Synaptica, adapt to project-scoped memory',
        rationale:
          'Proven architecture, pain/win/fact types, plasticity/decay already battle-tested',
        decidedBy: 'both',
      });

      project.state.addDecision('JSON file storage, swappable to SQLite', {
        context: 'MSVC build tools not available at scaffold time for better-sqlite3',
        chosen: 'JsonStore with same interface, migrate to SQLite when ready',
        rationale: 'Unblocks development immediately, storage is an implementation detail',
        decidedBy: 'claude',
      });
    }

    expect(project.state.listDecisions().length).toBeGreaterThanOrEqual(4);
  });

  it('records memories from the build process', () => {
    const memoryStore = new MemoryStore(PROJECT_ROOT, 'Hello World');

    if (memoryStore.getAllMemories().length === 0) {
      memoryStore.storeMemory({
        type: 'pain',
        title: 'Electron subprocess hangs with claude -p',
        content:
          '6+ attempts to spawn Claude as subprocess in Electron. Shell:true, named pipes, direct spawn — all fail.',
        rule: 'Do not attempt shell spawning in Electron for Claude. Use API directly or Tauri.',
        tags: ['electron', 'subprocess', 'architecture'],
        severity: 'high',
      });

      memoryStore.storeMemory({
        type: 'pain',
        title: 'better-sqlite3 requires MSVC build tools',
        content: 'Node native modules need Visual Studio C++ Build Tools on Windows. 6GB install.',
        rule: 'Use JSON storage first, add native deps when toolchain is ready.',
        tags: ['dependencies', 'windows', 'build'],
        severity: 'medium',
      });

      memoryStore.storeMemory({
        type: 'win',
        title: 'Brain engine ported in one session — 20 tests passing',
        content:
          'Ported Synaptica 9-stage hippocampal pipeline to Hello World. All stages working.',
        tags: ['brain', 'architecture', 'testing'],
      });

      memoryStore.storeMemory({
        type: 'win',
        title: 'Cross-session memory verified — moat works',
        content: 'Session 2 context contains full state from Session 1 without re-prompting.',
        tags: ['brain', 'cross-session', 'moat'],
      });

      memoryStore.storeMemory({
        type: 'win',
        title: 'CLI working end-to-end in first attempt',
        content: 'init, status, tasks, start — all working on first build.',
        tags: ['cli', 'testing'],
      });
    }

    const memories = memoryStore.getAllMemories();
    expect(memories.length).toBeGreaterThanOrEqual(5);

    const pains = memories.filter((m) => m.type === 'pain');
    const wins = memories.filter((m) => m.type === 'win');
    expect(pains.length).toBeGreaterThanOrEqual(2);
    expect(wins.length).toBeGreaterThanOrEqual(3);
  });

  it('status command shows real project state', () => {
    const project = Project.open(PROJECT_ROOT);
    const sessions = new SessionManager(PROJECT_ROOT);
    const memoryStore = new MemoryStore(PROJECT_ROOT, 'Hello World');

    // Start a session and compile context
    sessions.start();
    const context = sessions.compileContext(project.config.name, project.state, memoryStore, 5.0);

    // The context should contain our real decisions
    expect(context.compiledText).toContain('Hello World');
    expect(context.recentDecisions.length).toBeGreaterThan(0);

    // Memories exist in the store (injection depends on task context matching tags)
    const memories = memoryStore.getAllMemories();
    expect(memories.length).toBeGreaterThan(0);
  });
});
