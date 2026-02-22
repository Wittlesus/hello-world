import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../brain/store.js';
import { retrieveMemories } from '../brain/engine.js';
import {
  initBrainState,
  tickMessageCount,
  recordSynapticActivity,
  recordMemoryTraces,
  applySynapticPlasticity,
  applyDecay,
  shouldCheckpoint,
} from '../brain/state.js';
import type { BrainState, Memory } from '../types.js';

describe('MemoryStore', () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hw-brain-'));
    // Create .hello-world dir
    const { mkdirSync } = require('node:fs');
    mkdirSync(join(tmpDir, '.hello-world'), { recursive: true });
    store = new MemoryStore(tmpDir, 'test-project');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves memories', () => {
    const pain = store.storeMemory({
      type: 'pain',
      title: 'Never use git push --force on main',
      content: 'Force pushed and lost 3 hours of work',
      rule: 'Always use --force-with-lease instead',
      tags: ['git', 'deployment'],
      severity: 'high',
    });

    expect(pain.id).toMatch(/^mem_/);
    expect(pain.severity).toBe('high');
    expect(store.getMemory(pain.id)).toBeDefined();
    expect(store.getAllMemories()).toHaveLength(1);
  });

  it('filters by type and tags', () => {
    store.storeMemory({ type: 'pain', title: 'DB crash', tags: ['database'] });
    store.storeMemory({ type: 'win', title: 'Fixed auth', tags: ['authentication'] });
    store.storeMemory({ type: 'fact', title: 'API rate limit', tags: ['api'] });

    expect(store.getMemoriesByType('pain')).toHaveLength(1);
    expect(store.getMemoriesByType('win')).toHaveLength(1);
    expect(store.getMemoriesByTags(['database', 'api'])).toHaveLength(2);
  });

  it('increments access counts', () => {
    const mem = store.storeMemory({ type: 'pain', title: 'Bug', tags: ['debugging'] });
    store.incrementAccess([mem.id]);
    store.incrementAccess([mem.id]);

    const updated = store.getMemory(mem.id)!;
    expect(updated.accessCount).toBe(2);
    expect(updated.lastAccessed).toBeDefined();
  });

  it('deletes memories', () => {
    const mem = store.storeMemory({ type: 'fact', title: 'Temp', tags: [] });
    store.deleteMemory(mem.id);
    expect(store.getMemory(mem.id)).toBeUndefined();
  });
});

describe('Hippocampal Retrieval Engine', () => {
  function makeMemory(overrides: Partial<Memory> & { id: string; type: Memory['type']; title: string }): Memory {
    return {
      projectId: 'test',
      content: '',
      rule: '',
      tags: [],
      severity: 'low',
      synapticStrength: 1.0,
      accessCount: 0,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  const testMemories: Memory[] = [
    makeMemory({ id: 'p1', type: 'pain', title: 'Deploy broke production', content: 'Deployed without testing', rule: 'Always run tests before deploy', tags: ['deployment', 'testing'], severity: 'high' }),
    makeMemory({ id: 'p2', type: 'pain', title: 'SQL injection in login', content: 'Used raw SQL queries', rule: 'Use parameterized queries', tags: ['security', 'database', 'authentication'], severity: 'high' }),
    makeMemory({ id: 'p3', type: 'pain', title: 'CSS overflow bug', content: 'Flex items not scrolling', rule: 'Check min-w-0 on flex parents', tags: ['styling', 'frontend'] }),
    makeMemory({ id: 'p4', type: 'pain', title: 'API rate limited', content: 'Hit rate limit on external API', tags: ['api', 'performance'] }),
    makeMemory({ id: 'w1', type: 'win', title: 'Auth system working', content: 'JWT tokens validated correctly', tags: ['authentication', 'security'] }),
    makeMemory({ id: 'w2', type: 'win', title: 'Deployment pipeline automated', content: 'CI/CD runs tests and deploys', tags: ['deployment', 'ci-cd'] }),
    makeMemory({ id: 'f1', type: 'fact', title: 'Database uses PostgreSQL', tags: ['database'] }),
  ];

  it('retrieves pain memories for deployment prompt', () => {
    const result = retrieveMemories('I need to deploy the app to production', testMemories, null);

    expect(result.painMemories.length).toBeGreaterThan(0);
    const ids = result.painMemories.map(s => s.memory.id);
    expect(ids).toContain('p1'); // deploy broke production
  });

  it('retrieves wins alongside pains (dopamine injection)', () => {
    const result = retrieveMemories('Working on authentication security', testMemories, null);

    expect(result.painMemories.length).toBeGreaterThan(0);
    expect(result.winMemories.length).toBeGreaterThan(0);

    const winIds = result.winMemories.map(s => s.memory.id);
    expect(winIds).toContain('w1'); // auth system working
  });

  it('applies severity weighting (high severity scores higher)', () => {
    const result = retrieveMemories('Deploying to production now', testMemories, null);

    const p1Score = result.painMemories.find(s => s.memory.id === 'p1')?.score;
    expect(p1Score).toBeDefined();
    // High severity memory should have amplified score
    expect(p1Score!).toBeGreaterThan(1.0);
  });

  it('fires attention filter for security prompt', () => {
    const result = retrieveMemories('Need to fix the security vulnerability in the login', testMemories, null);
    expect(result.attentionFilter).not.toBeNull();
    expect(result.attentionFilter!.type).toBe('security');
  });

  it('detects hot tags after repeated firing', () => {
    const state: BrainState = {
      sessionStart: new Date().toISOString(),
      messageCount: 5,
      contextPhase: 'early',
      synapticActivity: {},
      memoryTraces: {},
      firingFrequency: { deployment: 3, testing: 3 }, // already fired 3 times
      activeTraces: [],
    };

    const result = retrieveMemories('Deploy the new feature', testMemories, state);
    expect(result.hotTags).toContain('deployment');
  });

  it('returns empty for very short prompts', () => {
    const result = retrieveMemories('ok', testMemories, null);
    expect(result.painMemories).toHaveLength(0);
    expect(result.winMemories).toHaveLength(0);
  });

  it('uses fuzzy matching when no exact tag matches', () => {
    const result = retrieveMemories('I have a flex overflow scrolling problem', testMemories, null);
    // Should fuzzy match p3 (CSS overflow bug) via substring
    expect(result.painMemories.length).toBeGreaterThan(0);
  });

  it('generates injection text', () => {
    const result = retrieveMemories('Deploy to production', testMemories, null);
    expect(result.injectionText).toContain('PAIN MEMORY');
    expect(result.injectionText.length).toBeGreaterThan(0);
  });
});

describe('Brain State', () => {
  it('initializes fresh brain state', () => {
    const state = initBrainState(null);
    expect(state.messageCount).toBe(0);
    expect(state.contextPhase).toBe('early');
    expect(state.activeTraces).toHaveLength(0);
  });

  it('progresses through context phases', () => {
    let state = initBrainState(null);
    for (let i = 0; i < 20; i++) state = tickMessageCount(state);
    expect(state.contextPhase).toBe('mid');

    for (let i = 0; i < 20; i++) state = tickMessageCount(state);
    expect(state.contextPhase).toBe('late');
  });

  it('records synaptic activity', () => {
    let state = initBrainState(null);
    state = recordSynapticActivity(state, ['git', 'deployment']);
    state = recordSynapticActivity(state, ['git']);

    expect(state.synapticActivity['git'].count).toBe(2);
    expect(state.firingFrequency['git']).toBe(2);
    expect(state.firingFrequency['deployment']).toBe(1);
  });

  it('records memory traces', () => {
    let state = initBrainState(null);
    state = recordMemoryTraces(state, ['mem_1', 'mem_2']);
    state = recordMemoryTraces(state, ['mem_1']);

    expect(state.memoryTraces['mem_1'].count).toBe(2);
    expect(state.memoryTraces['mem_2'].count).toBe(1);
    expect(state.activeTraces).toContain('mem_1');
    expect(state.activeTraces).toContain('mem_2');
  });

  it('applies synaptic plasticity', () => {
    let state = initBrainState(null);
    state = recordMemoryTraces(state, ['mem_1']);

    const { state: boosted, boosted: ids } = applySynapticPlasticity(state);
    expect(ids).toContain('mem_1');
    expect(boosted.memoryTraces['mem_1'].synapticStrength).toBe(1.1);
  });

  it('decays toward neutral', () => {
    let state = initBrainState(null);
    state = recordMemoryTraces(state, ['mem_1']);

    // Boost it up
    const { state: boosted } = applySynapticPlasticity(state, 0.5);
    expect(boosted.memoryTraces['mem_1'].synapticStrength).toBe(1.5);

    // Decay moves 10% toward 1.0
    const decayed = applyDecay(boosted);
    expect(decayed.memoryTraces['mem_1'].synapticStrength).toBe(1.45);
  });

  it('resets session-local state on init', () => {
    let state = initBrainState(null);
    state = recordSynapticActivity(state, ['git']);
    state = recordMemoryTraces(state, ['mem_1']);
    state = tickMessageCount(state);

    // Re-init (new session)
    const newState = initBrainState(state);
    expect(newState.messageCount).toBe(0);
    expect(newState.firingFrequency).toEqual({});
    expect(newState.activeTraces).toHaveLength(0);
    // Cross-session data preserved
    expect(newState.synapticActivity['git'].count).toBe(1);
    expect(newState.memoryTraces['mem_1']).toBeDefined();
  });

  it('triggers checkpoints at interval', () => {
    let state = initBrainState(null);
    // Default interval is 12 for early phase
    for (let i = 0; i < 11; i++) state = tickMessageCount(state);
    expect(shouldCheckpoint(state)).toBe(false); // 11 messages
    state = tickMessageCount(state);
    expect(shouldCheckpoint(state)).toBe(true); // 12 % 12 === 0

    // Next checkpoint in early phase at 24
    for (let i = 0; i < 7; i++) state = tickMessageCount(state);
    expect(state.messageCount).toBe(19);
    expect(shouldCheckpoint(state)).toBe(false);

    // At 20, phase becomes 'mid', interval becomes 9
    // 27 % 9 === 0 is the next hit
    for (let i = 0; i < 8; i++) state = tickMessageCount(state);
    expect(state.messageCount).toBe(27);
    expect(state.contextPhase).toBe('mid');
    expect(shouldCheckpoint(state)).toBe(true); // 27 % 9 === 0
  });
});
