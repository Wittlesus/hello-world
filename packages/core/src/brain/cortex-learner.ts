/**
 * Cortex Learner -- auto-learns word->tag mappings from retrieval gaps.
 *
 * When the engine falls back to fuzzy matching because a word has no cortex entry,
 * it records a "cortex gap." This module analyzes those gaps and learns new mappings
 * by observing which tags the fuzzy-matched memories belong to.
 *
 * Learned entries are stored in cortex-learned.json and merged with DEFAULT_CORTEX
 * at retrieval time. They can be promoted to DEFAULT_CORTEX in code during maintenance.
 */

import type { Memory } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface CortexGapObservation {
  word: string;
  matchedMemoryIds: string[];
  matchedTags: string[];
  timestamp: string;
}

export interface LearnedCortexEntry {
  word: string;
  tags: string[];
  confidence: number; // 0-1, based on how many times this gap was observed
  observationCount: number;
  firstSeen: string;
  lastSeen: string;
  promoted: boolean; // true = already added to DEFAULT_CORTEX in code
}

export interface CortexLearnedStore {
  entries: LearnedCortexEntry[];
  totalGapsProcessed: number;
  lastUpdated: string;
}

export interface LearnResult {
  newEntries: LearnedCortexEntry[];
  updatedEntries: LearnedCortexEntry[];
  totalEntries: number;
}

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Analyze cortex gaps from a retrieval and produce observations.
 * For each gap word, find which memories it matched via fuzzy and extract their tags.
 */
export function analyzeGaps(
  gaps: string[],
  prompt: string,
  memories: Memory[],
): CortexGapObservation[] {
  if (gaps.length === 0) return [];

  const observations: CortexGapObservation[] = [];
  const now = new Date().toISOString();

  for (const word of gaps) {
    const lower = word.toLowerCase();
    // Find memories this word matched via fuzzy
    const matched = memories.filter(m =>
      m.title.toLowerCase().includes(lower) ||
      m.rule.toLowerCase().includes(lower) ||
      (lower.length > 4 && m.content.toLowerCase().includes(lower)),
    );

    if (matched.length === 0) continue;

    // Collect tags from matched memories, count frequency
    const tagCounts = new Map<string, number>();
    for (const mem of matched) {
      for (const tag of mem.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    // Only keep tags that appear in at least half the matched memories
    const minCount = Math.max(1, Math.floor(matched.length / 2));
    const significantTags = [...tagCounts.entries()]
      .filter(([, count]) => count >= minCount)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
      .slice(0, 5); // Cap at 5 tags per word

    if (significantTags.length > 0) {
      observations.push({
        word: lower,
        matchedMemoryIds: matched.map(m => m.id),
        matchedTags: significantTags,
        timestamp: now,
      });
    }
  }

  return observations;
}

/**
 * Learn from gap observations. Updates existing entries or creates new ones.
 * Requires at least 2 observations of the same word before creating an entry.
 */
export function learnFromObservations(
  observations: CortexGapObservation[],
  existing: LearnedCortexEntry[],
  minObservations = 2,
): LearnResult {
  const entryMap = new Map(existing.map(e => [e.word, { ...e }]));
  const newEntries: LearnedCortexEntry[] = [];
  const updatedEntries: LearnedCortexEntry[] = [];

  for (const obs of observations) {
    const entry = entryMap.get(obs.word);

    if (entry) {
      // Update existing entry
      entry.observationCount += 1;
      entry.lastSeen = obs.timestamp;

      // Merge tags: keep existing, add new high-frequency ones
      const tagSet = new Set(entry.tags);
      for (const tag of obs.matchedTags) {
        tagSet.add(tag);
      }
      entry.tags = [...tagSet].slice(0, 6);

      // Confidence increases with observations (asymptotic to 1.0)
      entry.confidence = Math.min(0.95, 1 - 1 / (entry.observationCount + 1));

      entryMap.set(obs.word, entry);
      updatedEntries.push(entry);
    } else {
      // Create pending entry (not yet confident enough)
      const pending: LearnedCortexEntry = {
        word: obs.word,
        tags: obs.matchedTags,
        confidence: 0,
        observationCount: 1,
        firstSeen: obs.timestamp,
        lastSeen: obs.timestamp,
        promoted: false,
      };
      entryMap.set(obs.word, pending);

      // Only count as "new" if we've now hit the threshold
      if (pending.observationCount >= minObservations) {
        pending.confidence = 1 - 1 / (pending.observationCount + 1);
        newEntries.push(pending);
      }
    }
  }

  // Check if any existing entries now cross the threshold
  for (const entry of entryMap.values()) {
    if (
      entry.confidence === 0 &&
      entry.observationCount >= minObservations &&
      !newEntries.includes(entry)
    ) {
      entry.confidence = 1 - 1 / (entry.observationCount + 1);
      newEntries.push(entry);
    }
  }

  return {
    newEntries,
    updatedEntries,
    totalEntries: entryMap.size,
  };
}

/**
 * Merge learned cortex entries with the default cortex for use in retrieval.
 * Only includes entries with confidence >= threshold.
 */
export function mergeCortex(
  defaultCortex: Record<string, string[]>,
  learned: LearnedCortexEntry[],
  confidenceThreshold = 0.5,
): Record<string, string[]> {
  const merged = { ...defaultCortex };

  for (const entry of learned) {
    if (entry.confidence < confidenceThreshold) continue;
    if (entry.promoted) continue; // Already in DEFAULT_CORTEX

    if (merged[entry.word]) {
      // Merge tags with existing entry
      const tagSet = new Set([...merged[entry.word], ...entry.tags]);
      merged[entry.word] = [...tagSet];
    } else {
      merged[entry.word] = [...entry.tags];
    }
  }

  return merged;
}

/**
 * Get entries ready for promotion to DEFAULT_CORTEX.
 * Criteria: high confidence, many observations, not already promoted.
 */
export function getPromotionCandidates(
  entries: LearnedCortexEntry[],
  minConfidence = 0.8,
  minObservations = 5,
): LearnedCortexEntry[] {
  return entries
    .filter(e =>
      !e.promoted &&
      e.confidence >= minConfidence &&
      e.observationCount >= minObservations,
    )
    .sort((a, b) => b.observationCount - a.observationCount);
}

/**
 * Prune stale learned entries that haven't been observed recently.
 */
export function pruneStaleEntries(
  entries: LearnedCortexEntry[],
  maxAgeDays = 60,
  now = Date.now(),
): { kept: LearnedCortexEntry[]; pruned: LearnedCortexEntry[] } {
  const cutoff = now - maxAgeDays * 86_400_000;
  const kept: LearnedCortexEntry[] = [];
  const pruned: LearnedCortexEntry[] = [];

  for (const entry of entries) {
    const lastSeen = new Date(entry.lastSeen).getTime();
    if (lastSeen < cutoff && !entry.promoted) {
      pruned.push(entry);
    } else {
      kept.push(entry);
    }
  }

  return { kept, pruned };
}

/**
 * Create an empty cortex learned store.
 */
export function createEmptyCortexStore(): CortexLearnedStore {
  return {
    entries: [],
    totalGapsProcessed: 0,
    lastUpdated: new Date().toISOString(),
  };
}
