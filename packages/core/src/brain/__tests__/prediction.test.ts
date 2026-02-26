/**
 * Prediction tests for Brain Magnum Opus.
 *
 * Tests the prediction-error auto-capture system:
 * - estimateExpectedness for frequency-based prediction scoring
 * - shouldAutoCapture trigger logic (surprise threshold)
 * - createSurpriseMemory for automatic pain/win/fact generation
 * - updateExpectations for learning from repeated events
 */

import { describe, it, expect } from 'vitest';
import type { PredictionEvent, ExpectationModel } from '../prediction-types.js';
import {
  createEventSignature,
  createExpectationModel,
  estimateExpectedness,
  shouldAutoCapture,
  createSurpriseMemory,
  updateExpectations,
  computeAdaptiveThreshold,
  pruneExpectationModel,
  decayExpectationModel,
} from '../prediction.js';

// ── Test Helpers ────────────────────────────────────────────────

function makeEvent(overrides: Partial<PredictionEvent> = {}): PredictionEvent {
  return {
    category: 'tool_result',
    description: 'Tool call completed',
    ...overrides,
  };
}

function makeModel(overrides: Partial<ExpectationModel> = {}): ExpectationModel {
  return {
    frequencies: {},
    totalEvents: 0,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

const recentContext = { recentMemoryCount: 3, sessionMessageCount: 10 };

// ── createEventSignature ────────────────────────────────────────

describe('createEventSignature', () => {
  it('creates consistent signatures for same event type', () => {
    const event1 = makeEvent({ category: 'error', errorClass: 'TypeError' });
    const event2 = makeEvent({ category: 'error', errorClass: 'TypeError' });

    expect(createEventSignature(event1)).toBe(createEventSignature(event2));
  });

  it('creates different signatures for different event types', () => {
    const error = makeEvent({ category: 'error', errorClass: 'TypeError' });
    const toolResult = makeEvent({ category: 'tool_result', toolName: 'npm_install', outcomeClass: 'success' });

    expect(createEventSignature(error)).not.toBe(createEventSignature(toolResult));
  });

  it('includes subcategory when present', () => {
    const withSub = makeEvent({ category: 'tool_result', subcategory: 'build' });
    const withoutSub = makeEvent({ category: 'tool_result' });

    expect(createEventSignature(withSub)).not.toBe(createEventSignature(withoutSub));
  });
});

// ── estimateExpectedness ────────────────────────────────────────

describe('estimateExpectedness', () => {
  it('returns 0 for never-seen events', () => {
    const event = makeEvent({ category: 'error', errorClass: 'TypeError' });
    const model = makeModel();

    const score = estimateExpectedness(event, model, recentContext);
    expect(score).toBe(0);
  });

  it('returns higher score for frequently seen events', () => {
    const event = makeEvent({ category: 'error', errorClass: 'TypeError' });
    const sig = createEventSignature(event);
    const now = new Date().toISOString();

    const lowFreqModel = makeModel({
      frequencies: {
        [sig]: { count: 2, lastSeen: now, firstSeen: now },
      },
      totalEvents: 10,
    });

    const highFreqModel = makeModel({
      frequencies: {
        [sig]: { count: 20, lastSeen: now, firstSeen: now },
      },
      totalEvents: 50,
    });

    const lowScore = estimateExpectedness(event, lowFreqModel, recentContext);
    const highScore = estimateExpectedness(event, highFreqModel, recentContext);

    expect(highScore).toBeGreaterThan(lowScore);
  });

  it('returns higher score for recently seen events', () => {
    const event = makeEvent({ category: 'tool_result', toolName: 'build' });
    const sig = createEventSignature(event);
    const now = new Date().toISOString();
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const recentModel = makeModel({
      frequencies: {
        [sig]: { count: 5, lastSeen: now, firstSeen: monthAgo },
      },
      totalEvents: 20,
    });

    const staleModel = makeModel({
      frequencies: {
        [sig]: { count: 5, lastSeen: monthAgo, firstSeen: monthAgo },
      },
      totalEvents: 20,
    });

    const recentScore = estimateExpectedness(event, recentModel, recentContext);
    const staleScore = estimateExpectedness(event, staleModel, recentContext);

    expect(recentScore).toBeGreaterThan(staleScore);
  });

  it('returns a value between 0 and 1', () => {
    const event = makeEvent();
    const model = makeModel();

    const score = estimateExpectedness(event, model, recentContext);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ── shouldAutoCapture ───────────────────────────────────────────

describe('shouldAutoCapture', () => {
  it('captures surprising events (low expectedness)', () => {
    const event = makeEvent({
      category: 'error',
      errorClass: 'ECONNREFUSED',
      description: 'Database connection refused unexpectedly',
      valence: 'negative',
    });

    const result = shouldAutoCapture(event, 0.1, []);

    expect(result.capture).toBe(true);
    expect(result.expectedness).toBe(0.1);
    expect(result.reason).toContain('Surprising');
  });

  it('skips routine events (high expectedness)', () => {
    const event = makeEvent({
      category: 'tool_result',
      toolName: 'build',
      outcomeClass: 'success',
      description: 'Build succeeded normally',
    });

    const result = shouldAutoCapture(event, 0.9, []);

    expect(result.capture).toBe(false);
    expect(result.reason).toContain('Expected');
  });

  it('always captures high-severity events regardless of expectedness', () => {
    const event = makeEvent({
      category: 'error',
      description: 'Production data loss',
      severity: 'high',
    });

    const result = shouldAutoCapture(event, 0.3, []);

    expect(result.capture).toBe(true);
    expect(result.reason).toContain('severity');
    expect(result.encodingStrength).toBeGreaterThan(1);
  });

  it('adjusts threshold based on recent memory density', () => {
    const event = makeEvent({ category: 'error', description: 'Some error' });

    // Many recent memories = higher threshold (more selective)
    const recentMemories = Array.from({ length: 12 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 60_000).toISOString(), // Last 12 minutes
    }));

    const highDensityResult = shouldAutoCapture(event, 0.45, recentMemories);

    // Few recent memories = lower threshold (more receptive)
    const lowDensityResult = shouldAutoCapture(event, 0.45, []);

    // With the same expectedness, high density might not capture while low density does
    expect(lowDensityResult.threshold).toBeLessThanOrEqual(highDensityResult.threshold);
  });

  it('assigns stronger encoding for more surprising events', () => {
    const event = makeEvent({ category: 'error', description: 'Unusual error' });

    const verySuprising = shouldAutoCapture(event, 0.05, []);
    const mildlySurprising = shouldAutoCapture(event, 0.4, []);

    if (verySuprising.capture && mildlySurprising.capture) {
      expect(verySuprising.encodingStrength).toBeGreaterThanOrEqual(mildlySurprising.encodingStrength);
    }
  });
});

// ── createSurpriseMemory ────────────────────────────────────────

describe('createSurpriseMemory', () => {
  it('generates pain memory for negative surprises', () => {
    const event = makeEvent({
      category: 'error',
      description: 'Build failed with module not found error',
      valence: 'negative',
      tags: ['build', 'errors'],
    });

    const memory = createSurpriseMemory(event, 0.1, 1.3, {});

    expect(memory.type).toBe('pain');
    expect(memory.title).toContain('Unexpected failure');
    expect(memory.content).toContain('Build failed');
    expect(memory.tags).toContain('auto-surprise');
    expect(memory.tags).toContain('build');
    expect(memory.predictionError).toBeCloseTo(0.9, 1);
  });

  it('generates win memory for positive surprises', () => {
    const event = makeEvent({
      category: 'tool_result',
      toolName: 'deploy',
      outcomeClass: 'unexpected_success',
      description: 'Complex migration completed without issues',
      valence: 'positive',
      tags: ['deployment', 'migration'],
    });

    const memory = createSurpriseMemory(event, 0.15, 1.2, {});

    expect(memory.type).toBe('win');
    expect(memory.tags).toContain('auto-surprise');
    expect(memory.tags).toContain('deployment');
  });

  it('generates fact memory for neutral surprises', () => {
    const event = makeEvent({
      category: 'system',
      description: 'Unexpected system configuration detected',
      valence: 'neutral',
      tags: ['system', 'configuration'],
    });

    const memory = createSurpriseMemory(event, 0.05, 1.3, {});

    expect(memory.type).toBe('fact');
    expect(memory.tags).toContain('auto-surprise');
  });

  it('includes auto-surprise tag in the memory', () => {
    const event = makeEvent({
      category: 'error',
      description: 'Unexpected error occurred',
      tags: ['testing'],
    });

    const memory = createSurpriseMemory(event, 0.1, 1.0, {});
    expect(memory.tags).toContain('auto-surprise');
  });

  it('sets severity based on expectedness for errors', () => {
    const event = makeEvent({
      category: 'error',
      description: 'Very unexpected production crash',
      valence: 'negative',
    });

    // Very surprising (expectedness near 0) = high severity
    const verySurprising = createSurpriseMemory(event, 0.05, 1.5, {});
    expect(verySurprising.severity).toBe('high');

    // Moderately surprising
    const moderate = createSurpriseMemory(event, 0.25, 1.1, {});
    expect(moderate.severity).toBe('medium');
  });

  it('includes task context when available', () => {
    const event = makeEvent({
      category: 'error',
      description: 'Compilation error',
      valence: 'negative',
      tags: ['build'],
    });

    const memory = createSurpriseMemory(event, 0.1, 1.3, {
      activeTaskId: 't_abc123',
      activeTaskTitle: 'Build authentication module',
    });

    expect(memory.content).toContain('Build authentication module');
    expect(memory.relatedTaskId).toBe('t_abc123');
  });

  it('uses explicit title from event when provided', () => {
    const event = makeEvent({
      category: 'error',
      title: 'TypeORM migration crashed on column rename',
      description: 'Full details of the migration crash',
      valence: 'negative',
    });

    const memory = createSurpriseMemory(event, 0.1, 1.3, {});
    expect(memory.title).toBe('TypeORM migration crashed on column rename');
  });

  it('includes lesson in rule field when provided', () => {
    const event = makeEvent({
      category: 'error',
      description: 'Some error',
      lesson: 'Always check database connection before running migrations',
      valence: 'negative',
    });

    const memory = createSurpriseMemory(event, 0.1, 1.3, {});
    expect(memory.rule).toContain('Always check database connection');
  });
});

// ── updateExpectations ──────────────────────────────────────────

describe('updateExpectations', () => {
  it('increments count for previously seen event', () => {
    const event = makeEvent({ category: 'error', errorClass: 'TypeError' });
    const sig = createEventSignature(event);
    const now = new Date().toISOString();

    const model = makeModel({
      frequencies: {
        [sig]: { count: 3, lastSeen: now, firstSeen: now },
      },
      totalEvents: 10,
    });

    const updated = updateExpectations(event, model);

    expect(updated.frequencies[sig].count).toBe(4);
    expect(updated.totalEvents).toBe(11);
  });

  it('creates new entry for never-seen event', () => {
    const event = makeEvent({ category: 'error', errorClass: 'RangeError' });
    const sig = createEventSignature(event);
    const model = makeModel();

    const updated = updateExpectations(event, model);

    expect(updated.frequencies[sig]).toBeDefined();
    expect(updated.frequencies[sig].count).toBe(1);
    expect(updated.totalEvents).toBe(1);
  });

  it('updates lastSeen timestamp', () => {
    const event = makeEvent({ category: 'tool_result', toolName: 'build' });
    const sig = createEventSignature(event);
    const oldTime = '2026-01-01T00:00:00Z';

    const model = makeModel({
      frequencies: {
        [sig]: { count: 5, lastSeen: oldTime, firstSeen: oldTime },
      },
      totalEvents: 20,
    });

    const updated = updateExpectations(event, model);

    expect(new Date(updated.frequencies[sig].lastSeen).getTime())
      .toBeGreaterThan(new Date(oldTime).getTime());
    // firstSeen should remain unchanged
    expect(updated.frequencies[sig].firstSeen).toBe(oldTime);
  });

  it('preserves other frequency entries', () => {
    const event = makeEvent({ category: 'error', errorClass: 'TypeError' });
    const otherSig = 'tool_result::build';
    const now = new Date().toISOString();

    const model = makeModel({
      frequencies: {
        [otherSig]: { count: 10, lastSeen: now, firstSeen: now },
      },
      totalEvents: 10,
    });

    const updated = updateExpectations(event, model);

    // Other entries should still be there
    expect(updated.frequencies[otherSig]).toBeDefined();
    expect(updated.frequencies[otherSig].count).toBe(10);
  });
});

// ── computeAdaptiveThreshold ────────────────────────────────────

describe('computeAdaptiveThreshold', () => {
  it('lowers threshold when few recent memories', () => {
    const threshold = computeAdaptiveThreshold([]);
    expect(threshold).toBeLessThan(0.6);
  });

  it('raises threshold when many recent memories', () => {
    // Create 12 memories within the last hour
    const recentMemories = Array.from({ length: 12 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    }));

    const threshold = computeAdaptiveThreshold(recentMemories);
    expect(threshold).toBeGreaterThanOrEqual(0.6);
  });

  it('returns base threshold for moderate density', () => {
    // 4 recent memories -- moderate density
    const memories = Array.from({ length: 4 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    }));

    const threshold = computeAdaptiveThreshold(memories);
    expect(threshold).toBeCloseTo(0.6, 1);
  });
});

// ── pruneExpectationModel ───────────────────────────────────────

describe('pruneExpectationModel', () => {
  it('removes lowest-scored entries', () => {
    const now = new Date().toISOString();
    const oldDate = new Date(Date.now() - 90 * 86_400_000).toISOString(); // 90 days ago

    const frequencies: ExpectationModel['frequencies'] = {};
    // Add a recent, frequent entry
    frequencies['recent_frequent'] = { count: 50, lastSeen: now, firstSeen: now };
    // Add an old, infrequent entry
    frequencies['old_infrequent'] = { count: 1, lastSeen: oldDate, firstSeen: oldDate };
    // Add a bunch of moderately old entries
    for (let i = 0; i < 20; i++) {
      frequencies[`entry_${i}`] = {
        count: 3,
        lastSeen: new Date(Date.now() - i * 86_400_000).toISOString(),
        firstSeen: oldDate,
      };
    }

    const model = makeModel({ frequencies, totalEvents: 100 });
    const pruned = pruneExpectationModel(model);

    // Should keep the recent frequent entry
    expect(pruned.frequencies['recent_frequent']).toBeDefined();
    // Total entries should be reduced
    expect(Object.keys(pruned.frequencies).length).toBeLessThan(Object.keys(frequencies).length);
  });
});

// ── decayExpectationModel ───────────────────────────────────────

describe('decayExpectationModel', () => {
  it('removes entries that have decayed below threshold', () => {
    const veryOld = new Date(Date.now() - 365 * 86_400_000).toISOString(); // 1 year ago
    const now = new Date().toISOString();

    const model = makeModel({
      frequencies: {
        'recent': { count: 10, lastSeen: now, firstSeen: now },
        'ancient': { count: 1, lastSeen: veryOld, firstSeen: veryOld },
      },
      totalEvents: 50,
    });

    const decayed = decayExpectationModel(model);

    // Recent entry should survive
    expect(decayed.frequencies['recent']).toBeDefined();
    // Ancient entry with count=1 should be removed after decay
    expect(decayed.frequencies['ancient']).toBeUndefined();
  });

  it('reduces counts for stale entries', () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const now = new Date().toISOString();

    const model = makeModel({
      frequencies: {
        'stale': { count: 10, lastSeen: weekAgo, firstSeen: weekAgo },
        'fresh': { count: 10, lastSeen: now, firstSeen: now },
      },
      totalEvents: 50,
    });

    const decayed = decayExpectationModel(model);

    // Stale entry count should be reduced
    if (decayed.frequencies['stale']) {
      expect(decayed.frequencies['stale'].count).toBeLessThan(10);
    }
    // Fresh entry count should be close to original
    expect(decayed.frequencies['fresh'].count).toBeCloseTo(10, 0);
  });
});
