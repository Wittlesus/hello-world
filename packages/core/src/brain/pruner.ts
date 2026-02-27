/**
 * Memory Pruner -- archives superseded and stale memories.
 *
 * Moves dead memories out of the active pool into memories-archive.json.
 * This keeps the active memory file lean and retrieval fast.
 *
 * All functions are pure -- no side effects, no file I/O.
 */

import type { Memory } from '../types.js';
import { scoreMemory } from './scoring.js';
import type { MemoryScoreExtras } from './scoring.js';

// ── Types ──────────────────────────────────────────────────────────

export interface PruneResult {
  kept: Memory[];
  archived: ArchivedMemory[];
  stats: PruneStats;
}

export interface ArchivedMemory {
  memory: Memory;
  reason: string;
  archivedAt: string;
  scoreAtArchive: number;
}

export interface PruneStats {
  totalBefore: number;
  totalAfter: number;
  supersededCount: number;
  staleCount: number;
  lowQualityCount: number;
}

export interface MemoryArchiveStore {
  archived: ArchivedMemory[];
  totalArchived: number;
  lastPruned: string;
}

export interface PruneOptions {
  /** Minimum score to keep. Default: 0.10 */
  minScore?: number;
  /** Max age in days for unaccessed memories. Default: 90 */
  maxStaleDays?: number;
  /** Minimum quality score to keep. Default: 0.10 */
  minQuality?: number;
  /** Don't prune if total memories below this count. Default: 50 */
  minMemoryCount?: number;
}

// ── Capacity ──────────────────────────────────────────────────────

/** Max memories before pruning is recommended. */
export const MEMORY_CAPACITY = 1000;

/** Warning threshold (percentage of capacity). */
export const CAPACITY_WARNING_PCT = 0.80;

export interface CapacityStatus {
  total: number;
  capacity: number;
  pct: number;
  level: 'ok' | 'warning' | 'critical';
  shouldPrune: boolean;
}

/**
 * Check memory count against capacity threshold.
 * Returns status and whether pruning should be triggered.
 */
export function checkCapacity(memoryCount: number): CapacityStatus {
  const pct = memoryCount / MEMORY_CAPACITY;
  const level = pct >= 1.0 ? 'critical' : pct >= CAPACITY_WARNING_PCT ? 'warning' : 'ok';
  return {
    total: memoryCount,
    capacity: MEMORY_CAPACITY,
    pct,
    level,
    shouldPrune: pct >= 1.0,
  };
}

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Analyze memories and separate into kept and archive candidates.
 * Does NOT mutate -- returns new arrays.
 */
export function pruneMemories(
  memories: Memory[],
  options: PruneOptions = {},
): PruneResult {
  const {
    minScore = 0.10,
    maxStaleDays = 90,
    minQuality = 0.10,
    minMemoryCount = 50,
  } = options;

  const now = Date.now();
  const nowIso = new Date().toISOString();
  const staleCutoff = now - maxStaleDays * 86_400_000;

  // Don't prune if we have too few memories
  if (memories.length < minMemoryCount) {
    return {
      kept: memories,
      archived: [],
      stats: {
        totalBefore: memories.length,
        totalAfter: memories.length,
        supersededCount: 0,
        staleCount: 0,
        lowQualityCount: 0,
      },
    };
  }

  const kept: Memory[] = [];
  const archived: ArchivedMemory[] = [];
  let supersededCount = 0;
  let staleCount = 0;
  let lowQualityCount = 0;

  for (const mem of memories) {
    if (mem.decayExempt) {
      kept.push(mem);
      continue;
    }

    const extras: MemoryScoreExtras = {
      supersededBy: mem.supersededBy,
    };
    const score = scoreMemory({ ...mem, ...extras }, now);

    // 1. Superseded memories -- archive immediately
    if (mem.supersededBy) {
      archived.push({
        memory: mem,
        reason: `Superseded by ${mem.supersededBy}`,
        archivedAt: nowIso,
        scoreAtArchive: score,
      });
      supersededCount++;
      continue;
    }

    // 2. Score below threshold
    if (score < minScore) {
      // Check if it's just stale (no access) vs genuinely low quality
      const lastAccessTime = mem.lastAccessed
        ? new Date(mem.lastAccessed).getTime()
        : new Date(mem.createdAt).getTime();

      if (lastAccessTime < staleCutoff) {
        archived.push({
          memory: mem,
          reason: `Stale: score ${score.toFixed(2)}, last accessed ${Math.floor((now - lastAccessTime) / 86_400_000)}d ago`,
          archivedAt: nowIso,
          scoreAtArchive: score,
        });
        staleCount++;
        continue;
      }
    }

    // 3. Low quality score (if set by quality gate)
    if (mem.qualityScore !== undefined && mem.qualityScore < minQuality) {
      archived.push({
        memory: mem,
        reason: `Low quality: ${mem.qualityScore.toFixed(2)}`,
        archivedAt: nowIso,
        scoreAtArchive: score,
      });
      lowQualityCount++;
      continue;
    }

    kept.push(mem);
  }

  return {
    kept,
    archived,
    stats: {
      totalBefore: memories.length,
      totalAfter: kept.length,
      supersededCount,
      staleCount,
      lowQualityCount,
    },
  };
}

/**
 * Get archive-worthy memories without actually pruning.
 * Useful for preview/dry-run.
 */
export function previewPrune(
  memories: Memory[],
  options: PruneOptions = {},
): { wouldArchive: Array<{ memory: Memory; reason: string }>; wouldKeep: number } {
  const result = pruneMemories(memories, options);
  return {
    wouldArchive: result.archived.map(a => ({ memory: a.memory, reason: a.reason })),
    wouldKeep: result.kept.length,
  };
}

/**
 * Restore a memory from the archive.
 * Returns the memory with supersededBy cleared and a fresh timestamp.
 */
export function restoreFromArchive(
  archived: ArchivedMemory,
): Memory {
  return {
    ...archived.memory,
    supersededBy: undefined,
    lastAccessed: new Date().toISOString(),
  };
}

/**
 * Get archive statistics.
 */
export function archiveStats(
  archived: ArchivedMemory[],
): { total: number; byReason: Record<string, number>; oldestDate: string | null; newestDate: string | null } {
  const byReason: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const a of archived) {
    const key = a.reason.split(':')[0].trim();
    byReason[key] = (byReason[key] ?? 0) + 1;

    if (!oldest || a.archivedAt < oldest) oldest = a.archivedAt;
    if (!newest || a.archivedAt > newest) newest = a.archivedAt;
  }

  return { total: archived.length, byReason, oldestDate: oldest, newestDate: newest };
}

/**
 * Create an empty archive store.
 */
export function createEmptyArchiveStore(): MemoryArchiveStore {
  return {
    archived: [],
    totalArchived: 0,
    lastPruned: new Date().toISOString(),
  };
}
