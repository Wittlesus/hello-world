/**
 * Pruner tests for Brain memory management.
 *
 * Tests the archive/prune system:
 * - pruneMemories: superseded, stale, low-quality archival + minMemoryCount guard
 * - previewPrune: dry-run preview without mutation
 * - restoreFromArchive: clears supersededBy, refreshes lastAccessed
 * - archiveStats: counts by reason, oldest/newest dates
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Memory } from '../../types.js';
import {
  pruneMemories,
  previewPrune,
  restoreFromArchive,
  archiveStats,
  type ArchivedMemory,
  type PruneOptions,
} from '../pruner.js';

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

/** Create an ISO date string N days in the past from now. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Generate N filler memories so the total count exceeds minMemoryCount. */
function makeFiller(count: number, startIndex = 100): Memory[] {
  return Array.from({ length: count }, (_, i) =>
    makeMemory({
      id: `mem_filler_${startIndex + i}`,
      type: 'fact',
      title: `Filler memory ${startIndex + i}`,
      content: `Some useful content for filler ${startIndex + i}`,
      tags: ['filler'],
      severity: 'medium',
      synapticStrength: 1.0,
      accessCount: 5,
      lastAccessed: daysAgo(2),
      createdAt: daysAgo(10),
    }),
  );
}

// ── pruneMemories ───────────────────────────────────────────────

describe('pruneMemories', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('archives superseded memories', () => {
    const superseded = makeMemory({
      id: 'mem_sup_1',
      type: 'fact',
      title: 'Database uses PostgreSQL 15',
      content: 'Production database is PG 15',
      tags: ['database'],
      supersededBy: 'mem_new_1',
      createdAt: daysAgo(30),
    });

    const healthy = makeMemory({
      id: 'mem_healthy_1',
      type: 'fact',
      title: 'API uses REST endpoints',
      content: 'All data is fetched via REST with pagination',
      tags: ['api'],
      synapticStrength: 1.0,
      accessCount: 3,
      lastAccessed: daysAgo(1),
      createdAt: daysAgo(5),
    });

    const memories = [superseded, healthy, ...makeFiller(50)];
    const result = pruneMemories(memories);

    expect(result.stats.supersededCount).toBe(1);
    expect(result.archived).toHaveLength(1);
    expect(result.archived[0].memory.id).toBe('mem_sup_1');
    expect(result.archived[0].reason).toContain('Superseded by mem_new_1');
    expect(result.kept.find(m => m.id === 'mem_sup_1')).toBeUndefined();
    expect(result.kept.find(m => m.id === 'mem_healthy_1')).toBeDefined();
  });

  it('archives stale memories (old, low score, no recent access)', () => {
    const stale = makeMemory({
      id: 'mem_stale_1',
      type: 'fact',
      title: 'Old config detail nobody uses',
      content: 'Some obsolete config fact',
      tags: ['configuration'],
      severity: 'low',
      synapticStrength: 0.1,
      accessCount: 0,
      createdAt: daysAgo(120),
      // No lastAccessed -- falls back to createdAt, which is 120 days ago
    });

    const memories = [stale, ...makeFiller(51)];
    const result = pruneMemories(memories, { maxStaleDays: 90 });

    expect(result.stats.staleCount).toBe(1);
    const archivedStale = result.archived.find(a => a.memory.id === 'mem_stale_1');
    expect(archivedStale).toBeDefined();
    expect(archivedStale!.reason).toContain('Stale');
    expect(result.kept.find(m => m.id === 'mem_stale_1')).toBeUndefined();
  });

  it('archives low quality memories (qualityScore below threshold)', () => {
    const lowQuality = makeMemory({
      id: 'mem_lq_1',
      type: 'pain',
      title: 'Something went wrong with the build',
      content: 'Build failed',
      tags: ['build'],
      severity: 'medium',
      qualityScore: 0.05,
      synapticStrength: 1.0,
      accessCount: 2,
      lastAccessed: daysAgo(1),
      createdAt: daysAgo(5),
    });

    const memories = [lowQuality, ...makeFiller(51)];
    const result = pruneMemories(memories, { minQuality: 0.10 });

    expect(result.stats.lowQualityCount).toBe(1);
    const archivedLq = result.archived.find(a => a.memory.id === 'mem_lq_1');
    expect(archivedLq).toBeDefined();
    expect(archivedLq!.reason).toContain('Low quality');
    expect(archivedLq!.reason).toContain('0.05');
  });

  it('keeps healthy memories that pass all checks', () => {
    const healthy1 = makeMemory({
      id: 'mem_h1',
      type: 'pain',
      title: 'Tauri IPC silently drops large payloads',
      content: 'Payloads over 1MB in invoke() are silently dropped. Debugged for 2 hours.',
      rule: 'Chunk large payloads or use event system for data > 500KB',
      tags: ['tauri', 'ipc'],
      severity: 'high',
      synapticStrength: 1.0,
      accessCount: 4,
      lastAccessed: daysAgo(2),
      createdAt: daysAgo(10),
    });

    const healthy2 = makeMemory({
      id: 'mem_h2',
      type: 'win',
      title: 'File watcher with debounce works reliably',
      content: 'chokidar with 100ms debounce handles rapid writes correctly',
      tags: ['file-watcher'],
      severity: 'medium',
      synapticStrength: 0.8,
      accessCount: 2,
      lastAccessed: daysAgo(5),
      createdAt: daysAgo(20),
    });

    const memories = [healthy1, healthy2, ...makeFiller(50)];
    const result = pruneMemories(memories);

    expect(result.kept.find(m => m.id === 'mem_h1')).toBeDefined();
    expect(result.kept.find(m => m.id === 'mem_h2')).toBeDefined();
    expect(result.stats.supersededCount).toBe(0);
    expect(result.stats.staleCount).toBe(0);
    expect(result.stats.lowQualityCount).toBe(0);
  });

  it('skips pruning when total memories below minMemoryCount', () => {
    const stale = makeMemory({
      id: 'mem_stale_skip',
      type: 'fact',
      title: 'Old fact that would normally be pruned',
      content: 'Stale detail',
      tags: ['old'],
      severity: 'low',
      synapticStrength: 0.1,
      accessCount: 0,
      createdAt: daysAgo(200),
    });

    const superseded = makeMemory({
      id: 'mem_sup_skip',
      type: 'fact',
      title: 'Superseded fact',
      content: 'Outdated',
      tags: ['old'],
      supersededBy: 'mem_new',
      createdAt: daysAgo(30),
    });

    // Only 2 memories, well below default minMemoryCount of 50
    const memories = [stale, superseded];
    const result = pruneMemories(memories);

    expect(result.kept).toHaveLength(2);
    expect(result.archived).toHaveLength(0);
    expect(result.stats.totalBefore).toBe(2);
    expect(result.stats.totalAfter).toBe(2);
    expect(result.stats.supersededCount).toBe(0);
    expect(result.stats.staleCount).toBe(0);
    expect(result.stats.lowQualityCount).toBe(0);
  });

  it('skips pruning with custom minMemoryCount', () => {
    const memories = makeFiller(10);
    // Add a superseded one that would be archived if pruning ran
    memories.push(
      makeMemory({
        id: 'mem_sup_custom',
        type: 'fact',
        title: 'Superseded fact',
        content: 'Outdated info',
        supersededBy: 'mem_new',
        createdAt: daysAgo(5),
      }),
    );

    const result = pruneMemories(memories, { minMemoryCount: 20 });

    expect(result.kept).toHaveLength(11);
    expect(result.archived).toHaveLength(0);
  });

  it('returns correct stats with mixed archive reasons', () => {
    const superseded = makeMemory({
      id: 'mem_s1',
      type: 'fact',
      title: 'Old DB version fact',
      content: 'PG 14',
      supersededBy: 'mem_new_db',
      createdAt: daysAgo(30),
    });

    const stale = makeMemory({
      id: 'mem_st1',
      type: 'fact',
      title: 'Ancient config nobody remembers',
      content: 'Old setting',
      severity: 'low',
      synapticStrength: 0.05,
      accessCount: 0,
      createdAt: daysAgo(150),
    });

    const lowQuality = makeMemory({
      id: 'mem_lq1',
      type: 'pain',
      title: 'A minor issue',
      content: 'It broke',
      qualityScore: 0.02,
      synapticStrength: 1.0,
      accessCount: 1,
      lastAccessed: daysAgo(1),
      createdAt: daysAgo(3),
    });

    const healthy = makeMemory({
      id: 'mem_ok1',
      type: 'win',
      title: 'Debounce pattern works great',
      content: 'Debounce with 100ms handles rapid file writes',
      tags: ['patterns'],
      severity: 'medium',
      synapticStrength: 1.0,
      accessCount: 5,
      lastAccessed: daysAgo(1),
      createdAt: daysAgo(7),
    });

    const memories = [superseded, stale, lowQuality, healthy, ...makeFiller(50)];
    const result = pruneMemories(memories);

    expect(result.stats.totalBefore).toBe(54);
    expect(result.stats.supersededCount).toBe(1);
    expect(result.stats.staleCount).toBe(1);
    expect(result.stats.lowQualityCount).toBe(1);
    expect(result.stats.totalAfter).toBe(54 - 3);
    expect(result.archived).toHaveLength(3);
    expect(result.kept).toHaveLength(51);
  });

  it('does not mutate the original memory array', () => {
    const memories = [
      makeMemory({
        id: 'mem_sup_mut',
        type: 'fact',
        title: 'Will be superseded',
        supersededBy: 'mem_other',
        createdAt: daysAgo(5),
      }),
      ...makeFiller(51),
    ];

    const originalLength = memories.length;
    pruneMemories(memories);

    expect(memories).toHaveLength(originalLength);
  });

  it('sets archivedAt and scoreAtArchive on archived memories', () => {
    const superseded = makeMemory({
      id: 'mem_meta',
      type: 'fact',
      title: 'Superseded with metadata',
      content: 'Will be archived',
      supersededBy: 'mem_replacement',
      createdAt: daysAgo(10),
    });

    const memories = [superseded, ...makeFiller(51)];
    const result = pruneMemories(memories);

    expect(result.archived).toHaveLength(1);
    expect(result.archived[0].archivedAt).toBeDefined();
    expect(typeof result.archived[0].scoreAtArchive).toBe('number');
    expect(result.archived[0].scoreAtArchive).toBeGreaterThanOrEqual(0);
    expect(result.archived[0].scoreAtArchive).toBeLessThanOrEqual(1);
  });
});

// ── previewPrune ────────────────────────────────────────────────

describe('previewPrune', () => {
  it('returns preview without mutating memories', () => {
    const superseded = makeMemory({
      id: 'mem_prev_1',
      type: 'fact',
      title: 'Old database version',
      content: 'PG 14',
      supersededBy: 'mem_new_db',
      createdAt: daysAgo(20),
    });

    const healthy = makeMemory({
      id: 'mem_prev_2',
      type: 'win',
      title: 'Hot reload working',
      content: 'Vite HMR is stable',
      tags: ['dev'],
      severity: 'medium',
      synapticStrength: 1.0,
      accessCount: 3,
      lastAccessed: daysAgo(1),
      createdAt: daysAgo(5),
    });

    const memories = [superseded, healthy, ...makeFiller(50)];
    const originalLength = memories.length;

    const preview = previewPrune(memories);

    // Original not mutated
    expect(memories).toHaveLength(originalLength);

    // Preview reflects what would happen
    expect(preview.wouldArchive.length).toBeGreaterThan(0);
    expect(preview.wouldArchive.find(a => a.memory.id === 'mem_prev_1')).toBeDefined();
    expect(preview.wouldKeep).toBe(memories.length - preview.wouldArchive.length);
  });

  it('matches pruneMemories results', () => {
    const stale = makeMemory({
      id: 'mem_match_1',
      type: 'fact',
      title: 'Forgotten config',
      content: 'Old setting from months ago',
      severity: 'low',
      synapticStrength: 0.05,
      accessCount: 0,
      createdAt: daysAgo(130),
    });

    const superseded = makeMemory({
      id: 'mem_match_2',
      type: 'fact',
      title: 'Replaced fact',
      content: 'Outdated',
      supersededBy: 'mem_replacement',
      createdAt: daysAgo(15),
    });

    const options: PruneOptions = { maxStaleDays: 90, minMemoryCount: 10 };
    const memories = [stale, superseded, ...makeFiller(20)];

    const pruneResult = pruneMemories(memories, options);
    const preview = previewPrune(memories, options);

    expect(preview.wouldArchive).toHaveLength(pruneResult.archived.length);
    expect(preview.wouldKeep).toBe(pruneResult.kept.length);

    // Same memory IDs in the archive list
    const pruneIds = pruneResult.archived.map(a => a.memory.id).sort();
    const previewIds = preview.wouldArchive.map(a => a.memory.id).sort();
    expect(previewIds).toEqual(pruneIds);
  });

  it('preview has reason strings but no archivedAt or scoreAtArchive', () => {
    const memories = [
      makeMemory({
        id: 'mem_shape',
        type: 'fact',
        title: 'Will be archived',
        supersededBy: 'mem_other',
        createdAt: daysAgo(5),
      }),
      ...makeFiller(51),
    ];

    const preview = previewPrune(memories);

    for (const entry of preview.wouldArchive) {
      expect(entry.reason).toBeDefined();
      expect(typeof entry.reason).toBe('string');
      // Preview entries only have memory + reason, no archivedAt
      expect((entry as Record<string, unknown>)['archivedAt']).toBeUndefined();
      expect((entry as Record<string, unknown>)['scoreAtArchive']).toBeUndefined();
    }
  });
});

// ── restoreFromArchive ──────────────────────────────────────────

describe('restoreFromArchive', () => {
  it('clears supersededBy from the restored memory', () => {
    const archived: ArchivedMemory = {
      memory: makeMemory({
        id: 'mem_restore_1',
        type: 'fact',
        title: 'Database uses PostgreSQL 15',
        content: 'PG 15 in production',
        tags: ['database'],
        supersededBy: 'mem_new_db',
        createdAt: daysAgo(30),
      }),
      reason: 'Superseded by mem_new_db',
      archivedAt: daysAgo(5),
      scoreAtArchive: 0.12,
    };

    const restored = restoreFromArchive(archived);

    expect(restored.supersededBy).toBeUndefined();
    expect(restored.id).toBe('mem_restore_1');
    expect(restored.title).toBe('Database uses PostgreSQL 15');
  });

  it('sets a fresh lastAccessed timestamp', () => {
    const before = Date.now();

    const archived: ArchivedMemory = {
      memory: makeMemory({
        id: 'mem_restore_2',
        type: 'pain',
        title: 'Build failure on ARM',
        content: 'Cross-compilation fails for ARM64',
        tags: ['build', 'arm'],
        lastAccessed: daysAgo(60),
        createdAt: daysAgo(90),
      }),
      reason: 'Stale: score 0.04, last accessed 60d ago',
      archivedAt: daysAgo(3),
      scoreAtArchive: 0.04,
    };

    const restored = restoreFromArchive(archived);
    const after = Date.now();

    expect(restored.lastAccessed).toBeDefined();
    const restoredTime = new Date(restored.lastAccessed!).getTime();
    expect(restoredTime).toBeGreaterThanOrEqual(before);
    expect(restoredTime).toBeLessThanOrEqual(after);
  });

  it('preserves all other memory fields', () => {
    const original = makeMemory({
      id: 'mem_restore_3',
      type: 'architecture',
      title: 'Monorepo layout with Turborepo',
      content: 'packages/core, packages/cli, packages/app',
      rule: 'Keep shared types in core',
      tags: ['architecture', 'monorepo'],
      severity: 'high',
      synapticStrength: 0.9,
      accessCount: 12,
      qualityScore: 0.85,
      fingerprint: 'abc123def456',
      createdAt: daysAgo(45),
      links: [{ targetId: 'mem_other', relationship: 'related' as const, createdAt: daysAgo(40) }],
    });

    const archived: ArchivedMemory = {
      memory: original,
      reason: 'Manual archive for testing',
      archivedAt: daysAgo(1),
      scoreAtArchive: 0.55,
    };

    const restored = restoreFromArchive(archived);

    expect(restored.id).toBe('mem_restore_3');
    expect(restored.type).toBe('architecture');
    expect(restored.title).toBe('Monorepo layout with Turborepo');
    expect(restored.content).toBe('packages/core, packages/cli, packages/app');
    expect(restored.rule).toBe('Keep shared types in core');
    expect(restored.tags).toEqual(['architecture', 'monorepo']);
    expect(restored.severity).toBe('high');
    expect(restored.synapticStrength).toBe(0.9);
    expect(restored.accessCount).toBe(12);
    expect(restored.qualityScore).toBe(0.85);
    expect(restored.fingerprint).toBe('abc123def456');
    expect(restored.links).toHaveLength(1);
    expect(restored.links[0].targetId).toBe('mem_other');
  });

  it('does not mutate the original archived memory object', () => {
    const archived: ArchivedMemory = {
      memory: makeMemory({
        id: 'mem_nomut',
        type: 'fact',
        title: 'Immutable test',
        supersededBy: 'mem_x',
        createdAt: daysAgo(10),
      }),
      reason: 'Superseded by mem_x',
      archivedAt: daysAgo(1),
      scoreAtArchive: 0.08,
    };

    restoreFromArchive(archived);

    // Original archived memory should still have supersededBy
    expect(archived.memory.supersededBy).toBe('mem_x');
  });
});

// ── archiveStats ────────────────────────────────────────────────

describe('archiveStats', () => {
  it('counts by reason category', () => {
    const archived: ArchivedMemory[] = [
      {
        memory: makeMemory({ id: 'a1', type: 'fact', title: 'Sup 1', supersededBy: 'x' }),
        reason: 'Superseded by x',
        archivedAt: '2026-02-20T10:00:00Z',
        scoreAtArchive: 0.05,
      },
      {
        memory: makeMemory({ id: 'a2', type: 'fact', title: 'Sup 2', supersededBy: 'y' }),
        reason: 'Superseded by y',
        archivedAt: '2026-02-21T10:00:00Z',
        scoreAtArchive: 0.08,
      },
      {
        memory: makeMemory({ id: 'a3', type: 'fact', title: 'Stale 1' }),
        reason: 'Stale: score 0.03, last accessed 120d ago',
        archivedAt: '2026-02-22T10:00:00Z',
        scoreAtArchive: 0.03,
      },
      {
        memory: makeMemory({ id: 'a4', type: 'pain', title: 'LQ 1', qualityScore: 0.02 }),
        reason: 'Low quality: 0.02',
        archivedAt: '2026-02-23T10:00:00Z',
        scoreAtArchive: 0.15,
      },
    ];

    const stats = archiveStats(archived);

    expect(stats.total).toBe(4);
    expect(stats.byReason['Superseded by x']).toBe(1);
    expect(stats.byReason['Superseded by y']).toBe(1);
    expect(stats.byReason['Stale']).toBe(1);
    expect(stats.byReason['Low quality']).toBe(1);
  });

  it('finds oldest and newest archived dates', () => {
    const archived: ArchivedMemory[] = [
      {
        memory: makeMemory({ id: 'b1', type: 'fact', title: 'Early' }),
        reason: 'Stale: old',
        archivedAt: '2026-01-15T08:00:00Z',
        scoreAtArchive: 0.02,
      },
      {
        memory: makeMemory({ id: 'b2', type: 'fact', title: 'Mid' }),
        reason: 'Superseded by z',
        archivedAt: '2026-02-10T12:00:00Z',
        scoreAtArchive: 0.06,
      },
      {
        memory: makeMemory({ id: 'b3', type: 'pain', title: 'Late' }),
        reason: 'Low quality: 0.04',
        archivedAt: '2026-02-25T18:30:00Z',
        scoreAtArchive: 0.10,
      },
    ];

    const stats = archiveStats(archived);

    expect(stats.oldestDate).toBe('2026-01-15T08:00:00Z');
    expect(stats.newestDate).toBe('2026-02-25T18:30:00Z');
  });

  it('returns null dates for empty archive', () => {
    const stats = archiveStats([]);

    expect(stats.total).toBe(0);
    expect(stats.byReason).toEqual({});
    expect(stats.oldestDate).toBeNull();
    expect(stats.newestDate).toBeNull();
  });

  it('handles single entry correctly', () => {
    const archived: ArchivedMemory[] = [
      {
        memory: makeMemory({ id: 'c1', type: 'win', title: 'Solo' }),
        reason: 'Stale: score 0.01, last accessed 200d ago',
        archivedAt: '2026-02-20T15:00:00Z',
        scoreAtArchive: 0.01,
      },
    ];

    const stats = archiveStats(archived);

    expect(stats.total).toBe(1);
    expect(stats.byReason['Stale']).toBe(1);
    expect(stats.oldestDate).toBe('2026-02-20T15:00:00Z');
    expect(stats.newestDate).toBe('2026-02-20T15:00:00Z');
  });
});
