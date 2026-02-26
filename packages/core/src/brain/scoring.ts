/**
 * Memory scoring and staleness management.
 * Exponential decay by type + access boost + failure penalty.
 * No vector DB needed -- works with JSON storage and keyword search.
 */

import type { Memory, MemoryType } from '../types.js';

// Half-life in days: fact=17, pain=28, win=46, decision=87, architecture=173, reflection=35
const DECAY_RATE: Record<MemoryType, number> = {
  fact: 0.04,
  pain: 0.025,
  win: 0.015,
  decision: 0.008,
  architecture: 0.004,
  reflection: 0.02,
};

const SEVERITY_MULT: Record<string, number> = {
  high: 1.4,
  medium: 1.0,
  low: 0.7,
};

export type MemoryHealth = 'active' | 'aging' | 'stale' | 'harmful' | 'superseded';

export interface MemoryScoreExtras {
  failureCorrelations?: number;
  supersededBy?: string;
}

export function scoreMemory(m: Memory & MemoryScoreExtras, now = Date.now()): number {
  const ageDays = (now - new Date(m.createdAt).getTime()) / 86_400_000;

  // 1. Exponential time decay (type-specific rate)
  const decay = Math.exp(-DECAY_RATE[m.type] * ageDays);

  // 2. Recency of last access
  let accessBoost = 0;
  if (m.lastAccessed) {
    const daysSince = (now - new Date(m.lastAccessed).getTime()) / 86_400_000;
    accessBoost = Math.exp(-0.05 * daysSince) * 0.3;
  }

  // 3. Frequency bonus (log scale, capped)
  const freqBonus = Math.min(0.2, Math.log2((m.accessCount ?? 0) + 1) * 0.05);

  // 4. Failure penalty (0.15 per correlated failure)
  const failPenalty = (m.failureCorrelations ?? 0) * 0.15;

  // 5. Superseded = hard penalty
  const supersededPenalty = m.supersededBy ? 0.6 : 0;

  // 6. Severity weight
  const sevMult = SEVERITY_MULT[m.severity ?? 'medium'];

  const raw = (decay + accessBoost + freqBonus - failPenalty - supersededPenalty) * sevMult;
  return Math.max(0, Math.min(1, raw));
}

export function classifyHealth(m: Memory & MemoryScoreExtras, score: number): MemoryHealth {
  if (m.supersededBy) return 'superseded';
  if ((m.failureCorrelations ?? 0) >= 2) return 'harmful';
  if (score >= 0.5) return 'active';
  if (score >= 0.25) return 'aging';
  return 'stale';
}

/** Filter and rank retrieval results, excluding dead memories */
export function rankMemories(
  matches: Array<Memory & MemoryScoreExtras>,
  minScore = 0.15,
): Array<Memory & MemoryScoreExtras & { relevanceScore: number }> {
  const now = Date.now();
  return matches
    .map((m) => ({ ...m, relevanceScore: scoreMemory(m, now) }))
    .filter((m) => m.relevanceScore >= minScore && !m.supersededBy)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/** Surface memories needing human review */
export function getReviewQueue(
  all: Array<Memory & MemoryScoreExtras>,
): Array<Memory & { reason: string; relevanceScore: number }> {
  const now = Date.now();
  const queue: Array<Memory & { reason: string; relevanceScore: number }> = [];

  for (const m of all) {
    const score = scoreMemory(m, now);
    const health = classifyHealth(m, score);

    if (health === 'harmful') {
      queue.push({ ...m, reason: `Correlated with ${m.failureCorrelations} failures`, relevanceScore: score });
    } else if (health === 'stale') {
      queue.push({ ...m, reason: `Score ${score.toFixed(2)} -- below threshold`, relevanceScore: score });
    } else if (health === 'superseded') {
      queue.push({ ...m, reason: `Superseded by ${m.supersededBy}`, relevanceScore: score });
    }
  }
  return queue;
}

/** Detect potential contradictions when adding a new memory */
export function findContradictions(
  newMemory: Pick<Memory, 'type' | 'tags'>,
  existing: Memory[],
  minTagOverlap = 2,
): Memory[] {
  return existing.filter((m) => {
    if (m.type !== newMemory.type) return false;
    const overlap = m.tags.filter((t) => newMemory.tags.includes(t));
    return overlap.length >= minTagOverlap;
  });
}
