/**
 * Cortex Learner tests.
 *
 * Tests the auto-learning system that maps words to tags from retrieval gaps:
 * - analyzeGaps: produces observations from gap words + memory matches
 * - learnFromObservations: builds and updates learned cortex entries
 * - mergeCortex: merges learned entries into default cortex
 * - getPromotionCandidates: filters high-confidence entries for promotion
 * - pruneStaleEntries: removes old unaccessed entries, keeps promoted ones
 */

import { describe, it, expect } from 'vitest';
import type { Memory } from '../../types.js';
import {
  analyzeGaps,
  learnFromObservations,
  mergeCortex,
  getPromotionCandidates,
  pruneStaleEntries,
} from '../cortex-learner.js';
import type { LearnedCortexEntry, CortexGapObservation } from '../cortex-learner.js';

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

function makeLearnedEntry(overrides: Partial<LearnedCortexEntry> & { word: string }): LearnedCortexEntry {
  return {
    tags: [],
    confidence: 0,
    observationCount: 1,
    firstSeen: '2026-02-01T00:00:00.000Z',
    lastSeen: '2026-02-01T00:00:00.000Z',
    promoted: false,
    ...overrides,
  };
}

// ── analyzeGaps ─────────────────────────────────────────────────

describe('analyzeGaps', () => {
  const memories: Memory[] = [
    makeMemory({
      id: 'mem_001',
      type: 'pain',
      title: 'Tauri IPC fails silently with large payloads',
      content: 'invoke() drops payloads over 1MB without error',
      rule: 'Chunk payloads or use event system for data over 500KB',
      tags: ['tauri', 'ipc', 'debugging'],
    }),
    makeMemory({
      id: 'mem_002',
      type: 'win',
      title: 'Tauri event system handles streaming data well',
      content: 'Using tauri events for large data transfers works reliably',
      rule: '',
      tags: ['tauri', 'events', 'performance'],
    }),
    makeMemory({
      id: 'mem_003',
      type: 'fact',
      title: 'PostgreSQL max connections default is 100',
      content: 'Default max_connections in postgresql.conf is 100',
      tags: ['database', 'configuration'],
    }),
    makeMemory({
      id: 'mem_004',
      type: 'pain',
      title: 'React useEffect cleanup prevents memory leaks',
      content: 'Always return cleanup functions in useEffect hooks',
      rule: 'Return cleanup in every useEffect that subscribes',
      tags: ['react', 'hooks', 'performance'],
    }),
  ];

  it('returns observations for gap words that match memories', () => {
    const observations = analyzeGaps(['tauri'], 'tauri ipc issue', memories);

    expect(observations).toHaveLength(1);
    expect(observations[0].word).toBe('tauri');
    expect(observations[0].matchedMemoryIds).toContain('mem_001');
    expect(observations[0].matchedMemoryIds).toContain('mem_002');
    expect(observations[0].matchedTags.length).toBeGreaterThan(0);
    expect(observations[0].timestamp).toBeDefined();
  });

  it('skips gap words with no fuzzy matches', () => {
    const observations = analyzeGaps(['kubernetes', 'docker'], 'kubernetes deployment', memories);

    expect(observations).toHaveLength(0);
  });

  it('extracts significant tags that appear in at least half of matched memories', () => {
    // "tauri" matches mem_001 and mem_002. Both have 'tauri' tag.
    // mem_001 has 'ipc','debugging', mem_002 has 'events','performance'.
    // 'tauri' appears in 2/2 (100%), others appear in 1/2 (50%).
    // minCount = max(1, floor(2/2)) = 1, so all tags with count >= 1 pass.
    const observations = analyzeGaps(['tauri'], 'tauri issue', memories);

    expect(observations).toHaveLength(1);
    // 'tauri' should be first (appears in both memories)
    expect(observations[0].matchedTags[0]).toBe('tauri');
    // Should be capped at 5 tags max
    expect(observations[0].matchedTags.length).toBeLessThanOrEqual(5);
  });

  it('returns empty array for empty gaps', () => {
    const observations = analyzeGaps([], 'some prompt', memories);
    expect(observations).toHaveLength(0);
  });

  it('lowercases the gap word for matching', () => {
    const observations = analyzeGaps(['TAURI'], 'TAURI test', memories);

    expect(observations).toHaveLength(1);
    expect(observations[0].word).toBe('tauri');
  });

  it('matches against title, rule, and content (for words > 4 chars)', () => {
    // "cleanup" is 7 chars, should match content of mem_004
    const observations = analyzeGaps(['cleanup'], 'cleanup hooks', memories);

    expect(observations).toHaveLength(1);
    expect(observations[0].matchedMemoryIds).toContain('mem_004');
  });

  it('does not match content for words with 4 or fewer characters', () => {
    // "ipc" is 3 chars -- only matches title/rule, not content
    // mem_001 title has "IPC" so it will match on title
    const observations = analyzeGaps(['ipc'], 'ipc problem', memories);

    expect(observations).toHaveLength(1);
    expect(observations[0].matchedMemoryIds).toContain('mem_001');
  });

  it('handles multiple gap words producing multiple observations', () => {
    const observations = analyzeGaps(['tauri', 'postgresql'], 'tauri and postgresql', memories);

    expect(observations).toHaveLength(2);
    const words = observations.map(o => o.word);
    expect(words).toContain('tauri');
    expect(words).toContain('postgresql');
  });
});

// ── learnFromObservations ───────────────────────────────────────

describe('learnFromObservations', () => {
  const now = '2026-02-20T12:00:00.000Z';

  it('creates a pending entry on first observation (below minObservations)', () => {
    const observations: CortexGapObservation[] = [
      { word: 'tauri', matchedMemoryIds: ['mem_001'], matchedTags: ['tauri', 'ipc'], timestamp: now },
    ];

    const result = learnFromObservations(observations, [], 2);

    // Should not count as "new" since observationCount=1 < minObservations=2
    expect(result.newEntries).toHaveLength(0);
    expect(result.updatedEntries).toHaveLength(0);
    expect(result.totalEntries).toBe(1);
  });

  it('creates a real entry after reaching minObservations', () => {
    // First observation created a pending entry
    const pending = makeLearnedEntry({
      word: 'tauri',
      tags: ['tauri', 'ipc'],
      confidence: 0,
      observationCount: 1,
      firstSeen: '2026-02-19T00:00:00.000Z',
      lastSeen: '2026-02-19T00:00:00.000Z',
    });

    const observations: CortexGapObservation[] = [
      { word: 'tauri', matchedMemoryIds: ['mem_002'], matchedTags: ['tauri', 'events'], timestamp: now },
    ];

    const result = learnFromObservations(observations, [pending], 2);

    // The pending entry is updated and now has observationCount=2 >= minObservations=2
    expect(result.updatedEntries).toHaveLength(1);
    expect(result.updatedEntries[0].word).toBe('tauri');
    expect(result.updatedEntries[0].observationCount).toBe(2);
    expect(result.updatedEntries[0].confidence).toBeGreaterThan(0);
    expect(result.updatedEntries[0].lastSeen).toBe(now);
  });

  it('updates existing entries and merges tags', () => {
    const existing = makeLearnedEntry({
      word: 'webpack',
      tags: ['bundler', 'build'],
      confidence: 0.5,
      observationCount: 3,
      firstSeen: '2026-02-10T00:00:00.000Z',
      lastSeen: '2026-02-15T00:00:00.000Z',
    });

    const observations: CortexGapObservation[] = [
      { word: 'webpack', matchedMemoryIds: ['mem_x'], matchedTags: ['bundler', 'performance', 'frontend'], timestamp: now },
    ];

    const result = learnFromObservations(observations, [existing], 2);

    expect(result.updatedEntries).toHaveLength(1);
    const updated = result.updatedEntries[0];
    expect(updated.observationCount).toBe(4);
    expect(updated.tags).toContain('bundler');
    expect(updated.tags).toContain('build');
    expect(updated.tags).toContain('performance');
    expect(updated.tags).toContain('frontend');
    // Tags capped at 6
    expect(updated.tags.length).toBeLessThanOrEqual(6);
  });

  it('increases confidence asymptotically with more observations', () => {
    const existing = makeLearnedEntry({
      word: 'vitest',
      tags: ['testing'],
      confidence: 0.5,
      observationCount: 3,
    });

    const observations: CortexGapObservation[] = [
      { word: 'vitest', matchedMemoryIds: ['mem_t'], matchedTags: ['testing'], timestamp: now },
    ];

    const result = learnFromObservations(observations, [existing], 2);
    const updated = result.updatedEntries[0];

    // confidence = min(0.95, 1 - 1/(4+1)) = min(0.95, 0.8) = 0.8
    expect(updated.confidence).toBeCloseTo(0.8, 5);
    expect(updated.confidence).toBeLessThanOrEqual(0.95);
  });

  it('caps confidence at 0.95', () => {
    const existing = makeLearnedEntry({
      word: 'react',
      tags: ['frontend'],
      confidence: 0.9,
      observationCount: 50,
    });

    const observations: CortexGapObservation[] = [
      { word: 'react', matchedMemoryIds: ['mem_r'], matchedTags: ['frontend'], timestamp: now },
    ];

    const result = learnFromObservations(observations, [existing], 2);
    const updated = result.updatedEntries[0];

    // 1 - 1/(51+1) = 1 - 1/52 ~= 0.9807, but capped at 0.95
    expect(updated.confidence).toBeLessThanOrEqual(0.95);
  });

  it('with minObservations=1, creates a real entry immediately', () => {
    const observations: CortexGapObservation[] = [
      { word: 'bun', matchedMemoryIds: ['mem_b'], matchedTags: ['runtime', 'javascript'], timestamp: now },
    ];

    const result = learnFromObservations(observations, [], 1);

    expect(result.newEntries).toHaveLength(1);
    expect(result.newEntries[0].word).toBe('bun');
    expect(result.newEntries[0].confidence).toBeGreaterThan(0);
  });

  it('handles multiple new observations in one batch', () => {
    const observations: CortexGapObservation[] = [
      { word: 'svelte', matchedMemoryIds: ['mem_s1'], matchedTags: ['frontend', 'framework'], timestamp: now },
      { word: 'deno', matchedMemoryIds: ['mem_d1'], matchedTags: ['runtime', 'typescript'], timestamp: now },
    ];

    const result = learnFromObservations(observations, [], 1);

    expect(result.newEntries).toHaveLength(2);
    expect(result.totalEntries).toBe(2);
  });
});

// ── mergeCortex ─────────────────────────────────────────────────

describe('mergeCortex', () => {
  const defaultCortex: Record<string, string[]> = {
    crash: ['error', 'bug', 'failure'],
    deploy: ['ci-cd', 'infrastructure', 'release'],
  };

  it('merges learned entries with the default cortex', () => {
    const learned: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'tauri', tags: ['desktop', 'ipc'], confidence: 0.8, observationCount: 5 }),
    ];

    const merged = mergeCortex(defaultCortex, learned);

    expect(merged.crash).toEqual(['error', 'bug', 'failure']);
    expect(merged.deploy).toEqual(['ci-cd', 'infrastructure', 'release']);
    expect(merged.tauri).toEqual(['desktop', 'ipc']);
  });

  it('respects the confidence threshold', () => {
    const learned: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'high', tags: ['tag-a'], confidence: 0.8, observationCount: 5 }),
      makeLearnedEntry({ word: 'low', tags: ['tag-b'], confidence: 0.3, observationCount: 2 }),
    ];

    const merged = mergeCortex(defaultCortex, learned, 0.5);

    expect(merged.high).toEqual(['tag-a']);
    expect(merged.low).toBeUndefined();
  });

  it('skips promoted entries (they are already in DEFAULT_CORTEX)', () => {
    const learned: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'crash', tags: ['panic', 'fatal'], confidence: 0.9, observationCount: 10, promoted: true }),
    ];

    const merged = mergeCortex(defaultCortex, learned);

    // 'crash' should remain unchanged -- promoted entry is skipped
    expect(merged.crash).toEqual(['error', 'bug', 'failure']);
  });

  it('merges tags when learned word already exists in default cortex', () => {
    const learned: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'crash', tags: ['panic', 'fatal'], confidence: 0.8, observationCount: 5 }),
    ];

    const merged = mergeCortex(defaultCortex, learned);

    // Should merge: default tags + learned tags, deduplicated
    expect(merged.crash).toContain('error');
    expect(merged.crash).toContain('bug');
    expect(merged.crash).toContain('failure');
    expect(merged.crash).toContain('panic');
    expect(merged.crash).toContain('fatal');
  });

  it('does not mutate the original default cortex', () => {
    const learned: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'newword', tags: ['newtag'], confidence: 0.8, observationCount: 5 }),
    ];

    const originalKeys = Object.keys(defaultCortex);
    mergeCortex(defaultCortex, learned);

    expect(Object.keys(defaultCortex)).toEqual(originalKeys);
    expect(defaultCortex.newword).toBeUndefined();
  });

  it('returns a copy of the default cortex when no learned entries qualify', () => {
    const merged = mergeCortex(defaultCortex, []);

    expect(merged).toEqual(defaultCortex);
    expect(merged).not.toBe(defaultCortex); // different reference
  });
});

// ── getPromotionCandidates ──────────────────────────────────────

describe('getPromotionCandidates', () => {
  const entries: LearnedCortexEntry[] = [
    makeLearnedEntry({ word: 'tauri', tags: ['desktop', 'ipc'], confidence: 0.9, observationCount: 10 }),
    makeLearnedEntry({ word: 'vitest', tags: ['testing'], confidence: 0.85, observationCount: 7 }),
    makeLearnedEntry({ word: 'bun', tags: ['runtime'], confidence: 0.6, observationCount: 3 }),
    makeLearnedEntry({ word: 'webpack', tags: ['bundler'], confidence: 0.9, observationCount: 12, promoted: true }),
    makeLearnedEntry({ word: 'deno', tags: ['runtime'], confidence: 0.82, observationCount: 6 }),
  ];

  it('filters by confidence and observations thresholds', () => {
    const candidates = getPromotionCandidates(entries, 0.8, 5);

    const words = candidates.map(c => c.word);
    expect(words).toContain('tauri');
    expect(words).toContain('vitest');
    expect(words).toContain('deno');
    expect(words).not.toContain('bun'); // confidence 0.6 < 0.8
  });

  it('excludes already-promoted entries', () => {
    const candidates = getPromotionCandidates(entries, 0.8, 5);

    const words = candidates.map(c => c.word);
    expect(words).not.toContain('webpack'); // promoted = true
  });

  it('sorts by observationCount descending', () => {
    const candidates = getPromotionCandidates(entries, 0.8, 5);

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].observationCount).toBeGreaterThanOrEqual(candidates[i].observationCount);
    }
  });

  it('returns empty array when no entries qualify', () => {
    const candidates = getPromotionCandidates(entries, 0.99, 50);
    expect(candidates).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const candidates = getPromotionCandidates([]);
    expect(candidates).toHaveLength(0);
  });

  it('uses default thresholds (0.8 confidence, 5 observations)', () => {
    const lowEntries: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'alpha', tags: ['a'], confidence: 0.79, observationCount: 10 }),
      makeLearnedEntry({ word: 'beta', tags: ['b'], confidence: 0.85, observationCount: 4 }),
      makeLearnedEntry({ word: 'gamma', tags: ['c'], confidence: 0.85, observationCount: 6 }),
    ];

    const candidates = getPromotionCandidates(lowEntries);

    const words = candidates.map(c => c.word);
    expect(words).not.toContain('alpha'); // confidence 0.79 < 0.8
    expect(words).not.toContain('beta');  // observations 4 < 5
    expect(words).toContain('gamma');     // both thresholds met
  });
});

// ── pruneStaleEntries ───────────────────────────────────────────

describe('pruneStaleEntries', () => {
  // Fixed "now" for deterministic tests: 2026-02-20
  const now = new Date('2026-02-20T00:00:00.000Z').getTime();

  it('removes entries older than maxAgeDays', () => {
    const entries: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'old', tags: ['a'], lastSeen: '2025-11-01T00:00:00.000Z' }), // ~112 days old
      makeLearnedEntry({ word: 'recent', tags: ['b'], lastSeen: '2026-02-10T00:00:00.000Z' }), // ~10 days old
    ];

    const result = pruneStaleEntries(entries, 60, now);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].word).toBe('recent');
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].word).toBe('old');
  });

  it('keeps promoted entries regardless of age', () => {
    const entries: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'ancient', tags: ['a'], lastSeen: '2025-06-01T00:00:00.000Z', promoted: true }), // very old but promoted
      makeLearnedEntry({ word: 'stale', tags: ['b'], lastSeen: '2025-06-01T00:00:00.000Z' }), // very old, not promoted
    ];

    const result = pruneStaleEntries(entries, 60, now);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].word).toBe('ancient');
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].word).toBe('stale');
  });

  it('keeps all entries when none are stale', () => {
    const entries: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'fresh1', tags: ['a'], lastSeen: '2026-02-18T00:00:00.000Z' }),
      makeLearnedEntry({ word: 'fresh2', tags: ['b'], lastSeen: '2026-02-15T00:00:00.000Z' }),
    ];

    const result = pruneStaleEntries(entries, 60, now);

    expect(result.kept).toHaveLength(2);
    expect(result.pruned).toHaveLength(0);
  });

  it('prunes all non-promoted entries when all are stale', () => {
    const entries: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'stale1', tags: ['a'], lastSeen: '2025-01-01T00:00:00.000Z' }),
      makeLearnedEntry({ word: 'stale2', tags: ['b'], lastSeen: '2025-02-01T00:00:00.000Z' }),
    ];

    const result = pruneStaleEntries(entries, 60, now);

    expect(result.kept).toHaveLength(0);
    expect(result.pruned).toHaveLength(2);
  });

  it('handles empty input', () => {
    const result = pruneStaleEntries([], 60, now);

    expect(result.kept).toHaveLength(0);
    expect(result.pruned).toHaveLength(0);
  });

  it('uses the entry lastSeen field, not firstSeen', () => {
    const entries: LearnedCortexEntry[] = [
      makeLearnedEntry({
        word: 'old-first-recent-last',
        tags: ['a'],
        firstSeen: '2025-01-01T00:00:00.000Z',
        lastSeen: '2026-02-18T00:00:00.000Z', // recent lastSeen
      }),
    ];

    const result = pruneStaleEntries(entries, 60, now);

    expect(result.kept).toHaveLength(1);
    expect(result.pruned).toHaveLength(0);
  });

  it('respects custom maxAgeDays parameter', () => {
    const entries: LearnedCortexEntry[] = [
      makeLearnedEntry({ word: 'borderline', tags: ['a'], lastSeen: '2026-02-10T00:00:00.000Z' }), // 10 days old
    ];

    // 5-day cutoff should prune it
    const result5 = pruneStaleEntries(entries, 5, now);
    expect(result5.pruned).toHaveLength(1);

    // 15-day cutoff should keep it
    const result15 = pruneStaleEntries(entries, 15, now);
    expect(result15.kept).toHaveLength(1);
  });
});
