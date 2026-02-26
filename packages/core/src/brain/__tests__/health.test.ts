import { describe, it, expect } from 'vitest';
import type { Memory, BrainState } from '../../types.js';
import { generateHealthReport, formatHealthReport } from '../health.js';
import type { LearnedCortexEntry } from '../cortex-learner.js';
import type { LearnedRule } from '../rules.js';

function makeMemory(overrides: Partial<Memory> & { id: string }): Memory {
  return {
    projectId: 'test',
    type: 'pain',
    title: 'Test memory',
    content: 'Test content',
    rule: '',
    tags: ['test'],
    severity: 'medium',
    synapticStrength: 1.0,
    accessCount: 1,
    createdAt: new Date().toISOString(),
    links: [],
    ...overrides,
  };
}

function makeBrainState(overrides: Partial<BrainState> = {}): BrainState {
  return {
    sessionStart: new Date().toISOString(),
    messageCount: 5,
    contextPhase: 'mid',
    synapticActivity: { test: { count: 3, lastHit: new Date().toISOString() } },
    memoryTraces: {},
    firingFrequency: { test: 3 },
    activeTraces: ['mem_1', 'mem_2'],
    significantEventsSinceCheckpoint: 2,
    ...overrides,
  };
}

function makeLearnedCortex(overrides: Partial<LearnedCortexEntry> = {}): LearnedCortexEntry {
  return {
    word: 'testword',
    tags: ['test'],
    confidence: 0.7,
    observationCount: 3,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    promoted: false,
    ...overrides,
  };
}

function makeLearnedRule(overrides: Partial<LearnedRule> = {}): LearnedRule {
  return {
    id: 'rule_test',
    rule: 'Always test before deploying',
    tags: ['testing', 'deployment'],
    sourceMemoryIds: ['mem_1'],
    confidence: 0.85,
    observationCount: 4,
    type: 'pain-pattern',
    promotedToClaudeMd: false,
    createdAt: new Date().toISOString(),
    lastReinforced: new Date().toISOString(),
    ...overrides,
  };
}

describe('generateHealthReport', () => {
  it('generates report with correct memory counts', () => {
    const memories = [
      makeMemory({ id: 'mem_1', type: 'pain' }),
      makeMemory({ id: 'mem_2', type: 'win' }),
      makeMemory({ id: 'mem_3', type: 'fact' }),
    ];

    const report = generateHealthReport(memories, makeBrainState(), [], [], 150, 0);

    expect(report.memories.total).toBe(3);
    expect(report.memories.byType.pain).toBe(1);
    expect(report.memories.byType.win).toBe(1);
    expect(report.memories.byType.fact).toBe(1);
  });

  it('classifies memory health correctly', () => {
    const memories = [
      makeMemory({ id: 'mem_1', type: 'pain', createdAt: new Date().toISOString() }),
      makeMemory({ id: 'mem_2', type: 'win', supersededBy: 'mem_3' }),
    ];

    const report = generateHealthReport(memories, makeBrainState(), [], [], 150, 0);

    expect(report.memories.byHealth.superseded).toBe(1);
    expect(report.memories.byHealth.active).toBeGreaterThanOrEqual(1);
  });

  it('counts linked and fingerprinted memories', () => {
    const memories = [
      makeMemory({
        id: 'mem_1',
        links: [{ targetId: 'mem_2', relationship: 'resolves', createdAt: new Date().toISOString() }],
        fingerprint: 'abc123def456',
        qualityScore: 0.75,
      }),
      makeMemory({ id: 'mem_2' }),
    ];

    const report = generateHealthReport(memories, makeBrainState(), [], [], 150, 0);

    expect(report.memories.withLinks).toBe(1);
    expect(report.memories.withFingerprint).toBe(1);
    expect(report.memories.withQualityScore).toBe(1);
    expect(report.memories.averageQuality).toBe(0.75);
  });

  it('includes cortex stats', () => {
    const learned = [
      makeLearnedCortex({ word: 'foo', confidence: 0.9, observationCount: 10 }),
      makeLearnedCortex({ word: 'bar', confidence: 0.5 }),
    ];

    const report = generateHealthReport([], makeBrainState(), learned, [], 150, 42);

    expect(report.cortex.defaultEntries).toBe(150);
    expect(report.cortex.learnedEntries).toBe(2);
    expect(report.cortex.totalGapsProcessed).toBe(42);
    expect(report.cortex.promotionCandidates).toBe(1); // only 'foo' qualifies
  });

  it('includes rules stats', () => {
    const rules = [
      makeLearnedRule({ id: 'r1', type: 'pain-pattern', confidence: 0.9, observationCount: 5 }),
      makeLearnedRule({ id: 'r2', type: 'win-pattern', confidence: 0.6, observationCount: 2 }),
    ];

    const report = generateHealthReport([], makeBrainState(), [], rules, 150, 0);

    expect(report.rules.total).toBe(2);
    expect(report.rules.byType['pain-pattern']).toBe(1);
    expect(report.rules.byType['win-pattern']).toBe(1);
    expect(report.rules.claudeMdCandidates).toBe(1); // only r1 qualifies
    expect(report.rules.averageConfidence).toBe(0.75);
  });

  it('includes brain state stats', () => {
    const state = makeBrainState({
      messageCount: 15,
      contextPhase: 'late',
      activeTraces: ['a', 'b', 'c'],
      significantEventsSinceCheckpoint: 7,
    });

    const report = generateHealthReport([], state, [], [], 150, 0);

    expect(report.brainState.messageCount).toBe(15);
    expect(report.brainState.contextPhase).toBe('late');
    expect(report.brainState.activeTraces).toBe(3);
    expect(report.brainState.significantEvents).toBe(7);
  });

  it('assigns grades based on health', () => {
    // Healthy brain: recent memories, no issues
    const memories = Array.from({ length: 60 }, (_, i) =>
      makeMemory({
        id: `mem_${i}`,
        type: i % 3 === 0 ? 'pain' : i % 3 === 1 ? 'win' : 'fact',
        qualityScore: 0.6,
        fingerprint: `fp_${i}`,
      }),
    );

    const report = generateHealthReport(memories, makeBrainState(), [], [], 150, 0);

    expect(['A', 'B']).toContain(report.grade);
    expect(report.issues.length).toBeLessThanOrEqual(2);
  });

  it('detects no memories as F grade', () => {
    const report = generateHealthReport([], null, [], [], 150, 0);

    expect(['D', 'F']).toContain(report.grade);
    expect(report.issues).toContain('No memories stored');
    expect(report.issues).toContain('No brain state found');
  });

  it('handles null brain state gracefully', () => {
    const report = generateHealthReport([], null, [], [], 150, 0);

    expect(report.brainState.messageCount).toBe(0);
    expect(report.brainState.contextPhase).toBe('early');
    expect(report.brainState.activeTraces).toBe(0);
  });
});

describe('formatHealthReport', () => {
  it('produces readable text output', () => {
    const memories = [
      makeMemory({ id: 'mem_1', type: 'pain', qualityScore: 0.7 }),
      makeMemory({ id: 'mem_2', type: 'win' }),
    ];

    const report = generateHealthReport(memories, makeBrainState(), [], [], 150, 5);
    const formatted = formatHealthReport(report);

    expect(formatted).toContain('Brain Health:');
    expect(formatted).toContain('Memories: 2 total');
    expect(formatted).toContain('Cortex: 150 default');
    expect(formatted).toContain('Gaps processed: 5');
    expect(formatted).toContain('Session: msg 5');
  });

  it('includes issues and recommendations when present', () => {
    const report = generateHealthReport([], null, [], [], 150, 0);
    const formatted = formatHealthReport(report);

    expect(formatted).toContain('Issues:');
    expect(formatted).toContain('Recommendations:');
  });
});
