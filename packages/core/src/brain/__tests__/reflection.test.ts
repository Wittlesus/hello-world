/**
 * Reflection tests for Brain Magnum Opus.
 *
 * Tests the reflection subsystem:
 * - createReflection produces valid Memory-shaped objects with type='reflection'
 * - shouldReflect trigger logic (interval, significant events, phase gating)
 * - generateMetaObservations pattern detection from similar memories
 * - detectSurprise scoring (prediction vs outcome mismatch)
 */

import { describe, it, expect } from 'vitest';
import type { Memory, BrainState } from '../../types.js';
import {
  createReflection,
  shouldReflect,
  generateMetaObservations,
  detectSurprise,
  generatePrediction,
  DEFAULT_REFLECTION_CONFIG,
} from '../reflection.js';
import type {
  ReflectionContent,
  PredictionContent,
  SurpriseContent,
  MetaObservationContent,
  ReflectionConfig,
} from '../reflection.js';

// ── Test Helpers ────────────────────────────────────────────────

function makeMemory(overrides: Partial<Memory> & { id: string; type: Memory['type']; title: string }): Memory {
  return {
    projectId: 'test',
    content: '',
    rule: '',
    tags: [],
    severity: 'low',
    synapticStrength: 1.0,
    accessCount: 0,
    links: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBrainState(overrides: Partial<BrainState> = {}): BrainState {
  return {
    sessionStart: new Date().toISOString(),
    messageCount: 0,
    contextPhase: 'early',
    synapticActivity: {},
    memoryTraces: {},
    firingFrequency: {},
    activeTraces: [],
    significantEventsSinceCheckpoint: 0,
    ...overrides,
  };
}

// ── createReflection ────────────────────────────────────────────

describe('createReflection', () => {
  it('produces a Memory-shaped object with type=reflection', () => {
    const content: MetaObservationContent = {
      kind: 'meta-observation',
      summary: 'Deployment memories prevented a regression',
      detail: 'Surfaced deployment pain before CI setup. CI was configured correctly.',
      confidence: 0.8,
      linkedMemoryIds: ['mem_1', 'mem_2'],
      patternType: 'recurring-failure',
      affectedTags: ['deployment', 'testing'],
    };

    const reflection = createReflection(content);

    expect(reflection.type).toBe('reflection');
    expect(reflection.title).toContain('meta-observation');
    expect(reflection.title).toContain('Deployment memories');
    expect(reflection.content).toContain('Surfaced deployment');
    expect(reflection.tags).toContain('reflection');
    expect(reflection.tags).toContain('meta-observation');
    // createdAt, id, projectId are omitted from return type -- caller assigns them
    expect(reflection.links).toHaveLength(2);
    expect(reflection.surfacedMemoryIds).toEqual(['mem_1', 'mem_2']);
  });

  it('builds links from linkedMemoryIds', () => {
    const content: ReflectionContent = {
      kind: 'prediction',
      summary: 'Predicting success',
      detail: 'Based on past wins',
      confidence: 0.7,
      linkedMemoryIds: ['mem_100', 'mem_200', 'mem_300'],
    };

    const reflection = createReflection(content);

    expect(reflection.links).toHaveLength(3);
    const linkedIds = reflection.links.map(l => l.targetId);
    expect(linkedIds).toContain('mem_100');
    expect(linkedIds).toContain('mem_200');
    expect(linkedIds).toContain('mem_300');
    // All links should be 'related' type
    for (const link of reflection.links) {
      expect(link.relationship).toBe('related');
    }
  });

  it('sets the rule field from surprise lesson', () => {
    const surprise: SurpriseContent = {
      kind: 'surprise',
      summary: 'Unexpected failure in deployment',
      detail: 'Prediction said success but outcome was failure',
      confidence: 0.8,
      linkedMemoryIds: ['mem_1'],
      predictionId: 'mem_pred_1',
      surpriseScore: 0.9,
      predictedOutcome: 'success',
      actualOutcome: 'failure',
      lesson: 'Production config diverged from staging. Always verify env vars.',
    };

    const reflection = createReflection(surprise);
    expect(reflection.rule).toContain('env vars');
  });

  it('includes qualityScore and fingerprint', () => {
    const content: MetaObservationContent = {
      kind: 'meta-observation',
      summary: 'Pattern detected in authentication domain',
      detail: 'Recurring issues with token validation',
      confidence: 0.75,
      linkedMemoryIds: ['mem_1'],
      patternType: 'recurring-failure',
      affectedTags: ['authentication'],
    };

    const reflection = createReflection(content);
    expect(reflection.qualityScore).toBeDefined();
    expect(reflection.qualityScore).toBeGreaterThan(0);
    expect(reflection.fingerprint).toBeDefined();
  });
});

// ── shouldReflect ───────────────────────────────────────────────

describe('shouldReflect', () => {
  it('does not trigger too early in the session', () => {
    const state = makeBrainState({
      messageCount: 2,
      significantEventsSinceCheckpoint: 5,
      activeTraces: ['mem_1', 'mem_2'],
    });

    const result = shouldReflect(state);
    expect(result.reflect).toBe(false);
    expect(result.reason).toContain('Too early');
  });

  it('triggers at interval with sufficient significant events', () => {
    const interval = DEFAULT_REFLECTION_CONFIG.reflectionInterval;
    const minEvents = DEFAULT_REFLECTION_CONFIG.minSignificantEvents;
    const state = makeBrainState({
      messageCount: interval,
      contextPhase: 'mid',
      significantEventsSinceCheckpoint: minEvents,
      activeTraces: ['mem_1', 'mem_2'],
    });

    const result = shouldReflect(state);
    expect(result.reflect).toBe(true);
  });

  it('does not trigger when significant events are below threshold', () => {
    const state = makeBrainState({
      messageCount: 5,
      contextPhase: 'early',
      significantEventsSinceCheckpoint: 0,
      activeTraces: [],
    });

    const result = shouldReflect(state);
    expect(result.reflect).toBe(false);
  });

  it('triggers on high event count regardless of interval', () => {
    const minEvents = DEFAULT_REFLECTION_CONFIG.minSignificantEvents;
    const state = makeBrainState({
      messageCount: 7, // Not an interval hit
      contextPhase: 'mid',
      significantEventsSinceCheckpoint: minEvents * 2, // Double the threshold
      activeTraces: ['mem_1', 'mem_2', 'mem_3', 'mem_4'],
    });

    const result = shouldReflect(state);
    expect(result.reflect).toBe(true);
  });

  it('respects phase gating -- less reflection in late phase', () => {
    const interval = DEFAULT_REFLECTION_CONFIG.reflectionInterval;
    const state = makeBrainState({
      messageCount: interval,
      contextPhase: 'late',
      significantEventsSinceCheckpoint: 1, // Below threshold
      activeTraces: ['mem_1'],
    });

    // Late phase with low significant events -- should not trigger
    const result = shouldReflect(state);
    expect(result.reflect).toBe(false);
  });
});

// ── generateMetaObservations ────────────────────────────────────

describe('generateMetaObservations', () => {
  it('detects recurring failure patterns', () => {
    const memories: Memory[] = [
      makeMemory({ id: 'p1', type: 'pain', title: 'Deploy failed with wrong config', tags: ['deployment', 'configuration'] }),
      makeMemory({ id: 'p2', type: 'pain', title: 'Deploy broke due to env mismatch', tags: ['deployment', 'configuration'] }),
      makeMemory({ id: 'p3', type: 'pain', title: 'Deploy timeout on production', tags: ['deployment', 'production'] }),
      makeMemory({ id: 'p4', type: 'pain', title: 'Deploy rollback required after crash', tags: ['deployment'] }),
      makeMemory({ id: 'w1', type: 'win', title: 'CI pipeline working great', tags: ['ci-cd', 'testing'] }),
    ];

    const observations = generateMetaObservations(memories);

    // Should detect deployment as a recurring failure tag
    const deployObs = observations.find(o =>
      o.patternType === 'recurring-failure' &&
      o.affectedTags.includes('deployment'),
    );
    expect(deployObs).toBeDefined();
    expect(deployObs!.confidence).toBeGreaterThan(0.5);
  });

  it('returns empty when insufficient memories', () => {
    const memories: Memory[] = [
      makeMemory({ id: 'p1', type: 'pain', title: 'Single issue', tags: ['random'] }),
    ];

    const observations = generateMetaObservations(memories);
    expect(observations).toHaveLength(0);
  });

  it('detects contradictions (pain + win with same tags)', () => {
    const memories: Memory[] = [
      makeMemory({ id: 'p1', type: 'pain', title: 'Auth token leaked', tags: ['authentication', 'security'] }),
      makeMemory({ id: 'p2', type: 'pain', title: 'Auth bypass found', tags: ['authentication', 'security'] }),
      makeMemory({ id: 'w1', type: 'win', title: 'Auth system hardened', tags: ['authentication', 'security'] }),
      makeMemory({ id: 'w2', type: 'win', title: 'Auth audit passed', tags: ['authentication', 'security'] }),
      makeMemory({ id: 'p3', type: 'pain', title: 'Misc issue', tags: ['other'] }),
    ];

    const observations = generateMetaObservations(memories);

    const contradiction = observations.find(o =>
      o.patternType === 'contradiction' &&
      o.affectedTags.includes('authentication'),
    );
    expect(contradiction).toBeDefined();
  });

  it('detects knowledge gaps (pains with no wins)', () => {
    const memories: Memory[] = [
      makeMemory({ id: 'p1', type: 'pain', title: 'Docker build OOM', tags: ['docker', 'infrastructure'] }),
      makeMemory({ id: 'p2', type: 'pain', title: 'Docker layer cache miss', tags: ['docker', 'performance'] }),
      makeMemory({ id: 'p3', type: 'pain', title: 'Docker networking flaky', tags: ['docker', 'networking'] }),
      makeMemory({ id: 'w1', type: 'win', title: 'React bundle optimized', tags: ['react', 'performance'] }),
      makeMemory({ id: 'p4', type: 'pain', title: 'Docker volume mount failed on Windows', tags: ['docker', 'windows'] }),
    ];

    const observations = generateMetaObservations(memories);

    const gap = observations.find(o =>
      o.patternType === 'knowledge-gap' &&
      o.affectedTags.includes('docker'),
    );
    expect(gap).toBeDefined();
  });

  it('detects strengths (wins with no pains)', () => {
    const memories: Memory[] = [
      makeMemory({ id: 'w1', type: 'win', title: 'Testing framework solid', tags: ['testing'] }),
      makeMemory({ id: 'w2', type: 'win', title: 'Test coverage improved', tags: ['testing'] }),
      makeMemory({ id: 'w3', type: 'win', title: 'Integration tests passing', tags: ['testing'] }),
      makeMemory({ id: 'p1', type: 'pain', title: 'Unrelated issue', tags: ['other'] }),
      makeMemory({ id: 'w4', type: 'win', title: 'E2E tests reliable', tags: ['testing', 'e2e'] }),
    ];

    const observations = generateMetaObservations(memories);

    const strength = observations.find(o =>
      o.patternType === 'strength' &&
      o.affectedTags.includes('testing'),
    );
    expect(strength).toBeDefined();
  });

  it('returns observations sorted by confidence', () => {
    const memories: Memory[] = [];
    // Create enough memories for multiple observation types
    for (let i = 0; i < 5; i++) {
      memories.push(makeMemory({
        id: `p${i}`, type: 'pain', title: `Deploy failure ${i}`,
        tags: ['deployment'],
      }));
    }
    for (let i = 0; i < 3; i++) {
      memories.push(makeMemory({
        id: `w${i}`, type: 'win', title: `Auth win ${i}`,
        tags: ['auth'],
      }));
    }

    const observations = generateMetaObservations(memories);
    for (let i = 1; i < observations.length; i++) {
      expect(observations[i - 1].confidence).toBeGreaterThanOrEqual(observations[i].confidence);
    }
  });
});

// ── detectSurprise ──────────────────────────────────────────────

describe('detectSurprise', () => {
  function makePrediction(overrides: Partial<PredictionContent> = {}): PredictionContent {
    return {
      kind: 'prediction',
      summary: 'Predicting task outcome',
      detail: 'Based on memory analysis',
      confidence: 0.7,
      linkedMemoryIds: ['mem_1'],
      predictedOutcome: 'success',
      basis: 'High win ratio in this domain',
      ...overrides,
    };
  }

  it('returns high surprise score for mismatched prediction and outcome', () => {
    const prediction = makePrediction({ predictedOutcome: 'success', confidence: 0.8 });
    const result = detectSurprise(prediction, 'failure');

    expect(result.kind).toBe('surprise');
    expect(result.surpriseScore).toBeGreaterThan(0.5);
    expect(result.predictedOutcome).toBe('success');
    expect(result.actualOutcome).toBe('failure');
    expect(result.lesson).toBeDefined();
  });

  it('returns low surprise score for matching prediction and outcome', () => {
    const prediction = makePrediction({ predictedOutcome: 'success', confidence: 0.8 });
    const result = detectSurprise(prediction, 'success');

    expect(result.surpriseScore).toBeLessThan(0.3);
  });

  it('returns medium surprise score for partial matches', () => {
    const prediction = makePrediction({ predictedOutcome: 'success', confidence: 0.7 });
    const result = detectSurprise(prediction, 'partial');

    expect(result.surpriseScore).toBeGreaterThan(0.1);
    expect(result.surpriseScore).toBeLessThan(0.8);
  });

  it('returns high surprise when failure was predicted but succeeded', () => {
    const prediction = makePrediction({ predictedOutcome: 'failure', confidence: 0.8 });
    const result = detectSurprise(prediction, 'success');

    // Positive surprise is still surprise
    expect(result.surpriseScore).toBeGreaterThan(0.5);
  });

  it('scales surprise by prediction confidence', () => {
    const lowConfidence = makePrediction({ predictedOutcome: 'success', confidence: 0.3 });
    const highConfidence = makePrediction({ predictedOutcome: 'success', confidence: 0.9 });

    const lowResult = detectSurprise(lowConfidence, 'failure');
    const highResult = detectSurprise(highConfidence, 'failure');

    // High-confidence wrong prediction should be more surprising
    expect(highResult.surpriseScore).toBeGreaterThan(lowResult.surpriseScore);
  });

  it('returns a SurpriseContent with all required fields', () => {
    const prediction = makePrediction();
    const result = detectSurprise(prediction, 'failure');

    expect(result.kind).toBe('surprise');
    expect(result.summary).toBeDefined();
    expect(result.detail).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.linkedMemoryIds).toBeDefined();
    expect(result.surpriseScore).toBeGreaterThanOrEqual(0);
    expect(result.surpriseScore).toBeLessThanOrEqual(1);
    expect(result.lesson).toBeDefined();
  });
});
