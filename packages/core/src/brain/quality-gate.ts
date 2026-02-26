/**
 * Quality gate for memory storage.
 *
 * Prevents duplicates, scores quality, detects conflicts, and resolves them --
 * all without embeddings, LLM calls, or external dependencies.
 *
 * Pipeline: fingerprint -> dedup -> quality score -> conflict detection -> gate decision
 */

import type { Memory, MemoryType } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface DuplicateResult {
  isDuplicate: boolean;
  existingId?: string;
  similarity: number;
}

export interface ConflictInfo {
  existingMemory: Memory;
  confidence: number;
  reason: string;
}

export type ConflictStrategy = 'keep_new' | 'keep_old' | 'merge';

export interface ConflictResolution {
  action: 'supersede' | 'skip' | 'merge';
  mergedTitle?: string;
  mergedContent?: string;
  mergedRule?: string;
  supersededId?: string;
}

export interface QualityGateResult {
  action: 'accept' | 'reject' | 'merge';
  reason: string;
  qualityScore: number;
  fingerprint: string;
  conflicts?: ConflictInfo[];
  mergeTarget?: Memory;
  mergedTitle?: string;
  mergedContent?: string;
  mergedRule?: string;
}

export interface QualityGateOptions {
  /** Minimum quality score to accept. Default: 0.15 */
  minQuality?: number;
  /** Similarity threshold for duplicate detection. Default: 0.85 */
  dupThreshold?: number;
  /** Minimum tag overlap for conflict detection. Default: 2 */
  minTagOverlap?: number;
  /** Auto-resolve conflicts instead of just flagging them. Default: false */
  autoResolve?: boolean;
}

// ── Stop words (excluded from fingerprinting and similarity) ─────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
  'if', 'while', 'about', 'up', 'that', 'this', 'it', 'its', 'i', 'we',
  'they', 'them', 'he', 'she', 'you', 'me', 'my', 'your', 'our', 'their',
  'what', 'which', 'who', 'whom',
]);

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Simple djb2 string hash. Returns a 12-char hex string.
 * Deterministic, fast, no crypto dependency.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  // Convert to unsigned 32-bit, then to hex, pad to 8 chars
  const hex1 = (hash >>> 0).toString(16).padStart(8, '0');

  // Second pass with different seed for 12-char output
  let hash2 = 7919;
  for (let i = str.length - 1; i >= 0; i--) {
    hash2 = ((hash2 << 5) + hash2 + str.charCodeAt(i)) | 0;
  }
  const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0');

  return (hex1 + hex2).slice(0, 12);
}

/**
 * Extract meaningful keywords from text: lowercase, no stop words, no short words.
 */
function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)].sort();
}

/**
 * Normalize text for fingerprinting: extract keywords, sort, join.
 */
function normalizeForFingerprint(title: string, content: string): string {
  const titleKw = extractKeywords(title);
  const contentKw = extractKeywords(content);
  // Title keywords weighted: appear twice in the fingerprint input
  return [...titleKw, ...titleKw, ...contentKw].sort().join('|');
}

/**
 * Jaccard similarity between two string sets. Returns 0-1.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Weighted content similarity between two memories.
 * Combines title similarity (weight 0.5), content keyword similarity (0.3),
 * and tag overlap (0.2).
 */
function contentSimilarity(
  a: Pick<Memory, 'title' | 'content' | 'tags'>,
  b: Pick<Memory, 'title' | 'content' | 'tags'>,
): number {
  const titleSimA = new Set(extractKeywords(a.title));
  const titleSimB = new Set(extractKeywords(b.title));
  const titleSim = jaccardSimilarity(titleSimA, titleSimB);

  const contentSimA = new Set(extractKeywords(a.content));
  const contentSimB = new Set(extractKeywords(b.content));
  const contentSim = jaccardSimilarity(contentSimA, contentSimB);

  const tagSimA = new Set(a.tags);
  const tagSimB = new Set(b.tags);
  const tagSim = jaccardSimilarity(tagSimA, tagSimB);

  return titleSim * 0.5 + contentSim * 0.3 + tagSim * 0.2;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Generate a content fingerprint for dedup.
 * Hash of normalized title + content keywords.
 */
export function computeFingerprint(
  memory: Pick<Memory, 'title' | 'content'>,
): string {
  const normalized = normalizeForFingerprint(memory.title, memory.content);
  return djb2Hash(normalized);
}

/**
 * Check whether a new memory is a duplicate of any existing memory.
 * Uses fingerprint exact match first (fast path), then fuzzy content similarity.
 */
export function isDuplicate(
  newMemory: Pick<Memory, 'title' | 'content' | 'tags'>,
  existingMemories: Memory[],
  threshold = 0.85,
): DuplicateResult {
  const newFp = computeFingerprint(newMemory);

  // Fast path: exact fingerprint match
  for (const existing of existingMemories) {
    if (existing.fingerprint && existing.fingerprint === newFp) {
      return {
        isDuplicate: true,
        existingId: existing.id,
        similarity: 1.0,
      };
    }
  }

  // Slow path: fuzzy content similarity
  let bestSimilarity = 0;
  let bestId: string | undefined;

  for (const existing of existingMemories) {
    // Skip superseded memories -- they shouldn't block new entries
    if (existing.supersededBy) continue;

    const sim = contentSimilarity(newMemory, existing);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestId = existing.id;
    }
  }

  return {
    isDuplicate: bestSimilarity >= threshold,
    existingId: bestSimilarity >= threshold ? bestId : undefined,
    similarity: bestSimilarity,
  };
}

/**
 * Assess the quality of a memory. Returns a score from 0 to 1 based on:
 * - Specificity: does the title/content contain concrete details (not vague)?
 * - Actionability: does it have a rule or lesson?
 * - Completeness: does it have meaningful content beyond just a title?
 */
export function assessQuality(
  memory: Pick<Memory, 'type' | 'title' | 'content' | 'rule' | 'tags' | 'severity'>,
): number {
  let score = 0;

  // ── Specificity (0-0.35) ──────────────────────────────────────
  const titleWords = extractKeywords(memory.title);
  const contentWords = extractKeywords(memory.content);

  // Title length: 2-3 keywords = 0.15, 4+ = 0.25, 1 = 0.05
  if (titleWords.length >= 4) score += 0.25;
  else if (titleWords.length >= 2) score += 0.15;
  else if (titleWords.length === 1) score += 0.05;

  // Contains specific identifiers (file names, function names, versions)
  const specificPattern = /\b[\w-]+\.(ts|js|rs|json|toml|md)\b|v\d+\.\d+|[A-Z][a-z]+[A-Z]\w+/;
  if (specificPattern.test(memory.title) || specificPattern.test(memory.content)) {
    score += 0.10;
  }

  // ── Actionability (0-0.35) ────────────────────────────────────
  // Has a rule: strong signal
  if (memory.rule && memory.rule.trim().length > 10) {
    score += 0.25;
  } else if (memory.rule && memory.rule.trim().length > 0) {
    score += 0.10;
  }

  // Content contains actionable language
  const actionablePattern = /\b(always|never|must|should|avoid|use|prefer|ensure|check|verify|run|before|after|instead)\b/i;
  if (actionablePattern.test(memory.content) || actionablePattern.test(memory.rule)) {
    score += 0.10;
  }

  // ── Completeness (0-0.30) ─────────────────────────────────────
  // Has content beyond just a title
  if (contentWords.length >= 10) score += 0.15;
  else if (contentWords.length >= 4) score += 0.10;
  else if (contentWords.length >= 1) score += 0.05;

  // Has tags
  if (memory.tags.length >= 3) score += 0.10;
  else if (memory.tags.length >= 1) score += 0.05;

  // Has severity set to something meaningful (not default low for pain/decision)
  if (memory.type === 'pain' || memory.type === 'decision' || memory.type === 'architecture') {
    if (memory.severity === 'high') score += 0.05;
    else if (memory.severity === 'medium') score += 0.03;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Detect memories that potentially conflict with (contradict) the new memory.
 * Returns conflicts with a confidence score based on overlap strength.
 */
export function detectConflict(
  newMemory: Pick<Memory, 'type' | 'title' | 'content' | 'tags' | 'rule'>,
  existingMemories: Memory[],
  minTagOverlap = 2,
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const newKeywords = new Set(extractKeywords(`${newMemory.title} ${newMemory.content}`));

  for (const existing of existingMemories) {
    // Skip superseded memories
    if (existing.supersededBy) continue;

    // Must share enough tags to be considered a conflict
    const sharedTags = existing.tags.filter(t => newMemory.tags.includes(t));
    if (sharedTags.length < minTagOverlap) continue;

    // Same type = potential supersession or contradiction
    // Different type but same tags = potential resolution (pain -> win)
    const sameType = existing.type === newMemory.type;
    const existingKeywords = new Set(extractKeywords(`${existing.title} ${existing.content}`));
    const kwSimilarity = jaccardSimilarity(newKeywords, existingKeywords);

    // Detect contradiction signals
    let confidence = 0;
    let reason = '';

    if (sameType && kwSimilarity > 0.4) {
      // Same type, overlapping content: likely an update/correction
      confidence = 0.3 + kwSimilarity * 0.4 + (sharedTags.length / Math.max(existing.tags.length, newMemory.tags.length)) * 0.3;
      reason = `Same type (${existing.type}), ${sharedTags.length} shared tags, ${(kwSimilarity * 100).toFixed(0)}% keyword overlap`;
    } else if (isComplementaryConflict(newMemory.type, existing.type)) {
      // Pain vs win on same topic: not a contradiction, but a resolution
      confidence = 0.2 + (sharedTags.length / Math.max(existing.tags.length, newMemory.tags.length)) * 0.3;
      reason = `Complementary types (${newMemory.type} vs ${existing.type}), ${sharedTags.length} shared tags -- may resolve`;
    } else if (hasContradictoryRule(newMemory.rule, existing.rule)) {
      // Rules that directly oppose each other
      confidence = 0.7 + (sharedTags.length / Math.max(existing.tags.length, newMemory.tags.length)) * 0.3;
      reason = `Contradictory rules detected with ${sharedTags.length} shared tags`;
    }

    if (confidence > 0.25) {
      conflicts.push({
        existingMemory: existing,
        confidence: Math.min(1, confidence),
        reason,
      });
    }
  }

  // Sort by confidence descending
  return conflicts.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Check if two memory types form a complementary pair (not a contradiction).
 * E.g., a pain memory resolved by a win memory.
 */
function isComplementaryConflict(typeA: MemoryType | string, typeB: MemoryType | string): boolean {
  const pairs: Array<[string, string]> = [
    ['pain', 'win'],
    ['win', 'pain'],
  ];
  return pairs.some(([a, b]) => typeA === a && typeB === b);
}

/**
 * Detect if two rules contain contradictory directives.
 * Looks for opposing action words (always/never, use/avoid, etc).
 */
function hasContradictoryRule(ruleA: string | undefined, ruleB: string | undefined): boolean {
  if (!ruleA || !ruleB || ruleA.length < 5 || ruleB.length < 5) return false;

  const opposites: Array<[RegExp, RegExp]> = [
    [/\balways\b/i, /\bnever\b/i],
    [/\buse\b/i, /\bavoid\b/i],
    [/\bdo\b/i, /\bdon'?t\b/i],
    [/\bsafe\b/i, /\bunsafe\b|dangerous\b/i],
    [/\brequired\b/i, /\bunnecessary\b|optional\b/i],
  ];

  const aLower = ruleA.toLowerCase();
  const bLower = ruleB.toLowerCase();

  for (const [patternX, patternY] of opposites) {
    if (
      (patternX.test(aLower) && patternY.test(bLower)) ||
      (patternY.test(aLower) && patternX.test(bLower))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve a conflict between a new memory and an existing one.
 */
export function resolveConflict(
  newMemory: Pick<Memory, 'type' | 'title' | 'content' | 'rule' | 'tags' | 'severity'>,
  existingConflict: Memory,
  strategy: ConflictStrategy,
): ConflictResolution {
  switch (strategy) {
    case 'keep_new':
      // Supersede the old memory
      return {
        action: 'supersede',
        supersededId: existingConflict.id,
      };

    case 'keep_old':
      // Reject the new memory
      return {
        action: 'skip',
      };

    case 'merge': {
      // Combine insights from both memories
      const mergedTitle = newMemory.title.length > existingConflict.title.length
        ? newMemory.title
        : existingConflict.title;

      // Merge content: keep both, separated by context
      const existingContent = existingConflict.content.trim();
      const newContent = newMemory.content.trim();
      let mergedContent: string;

      if (existingContent && newContent && existingContent !== newContent) {
        mergedContent = `${existingContent}\n\n[Updated] ${newContent}`;
      } else {
        mergedContent = newContent || existingContent;
      }

      // Merge rules: prefer the more specific (longer) rule, or combine
      const existingRule = existingConflict.rule.trim();
      const newRule = (newMemory.rule ?? '').trim();
      let mergedRule: string;

      if (existingRule && newRule && existingRule !== newRule) {
        mergedRule = newRule.length > existingRule.length ? newRule : `${existingRule} (also: ${newRule})`;
      } else {
        mergedRule = newRule || existingRule;
      }

      return {
        action: 'merge',
        supersededId: existingConflict.id,
        mergedTitle,
        mergedContent,
        mergedRule,
      };
    }
  }
}

/**
 * Infer the best conflict resolution strategy based on context.
 * Used when autoResolve is enabled.
 */
function inferStrategy(
  newMemory: Pick<Memory, 'type' | 'title' | 'content' | 'rule' | 'severity'>,
  existing: Memory,
  conflict: ConflictInfo,
): ConflictStrategy | null {
  // Complementary types (pain + win) should ALWAYS coexist.
  // A pain is "what went wrong" and a win is "what went right" -- both are valuable.
  if (isComplementaryConflict(newMemory.type, existing.type)) {
    return null; // null = accept both, no resolution needed
  }

  // High-confidence conflict with same type: newer supersedes older
  if (conflict.confidence > 0.7 && newMemory.type === existing.type) {
    return 'keep_new';
  }

  // Moderate confidence with same type: merge to preserve both perspectives
  if (conflict.confidence > 0.5 && newMemory.type === existing.type) {
    return 'merge';
  }

  // Low confidence or different non-complementary types: keep both
  return null;
}

/**
 * The main quality gate. Evaluates a memory and decides whether to accept,
 * reject, or merge it with an existing memory.
 *
 * Pipeline:
 * 1. Compute fingerprint
 * 2. Check for duplicates (reject if similarity > threshold)
 * 3. Assess quality (reject if below minimum)
 * 4. Detect conflicts
 * 5. Optionally auto-resolve conflicts
 * 6. Return gate decision
 */
export function qualityGate(
  memory: Pick<Memory, 'type' | 'title' | 'content' | 'rule' | 'tags' | 'severity'>,
  existingMemories: Memory[],
  options: QualityGateOptions = {},
): QualityGateResult {
  const {
    minQuality = 0.15,
    dupThreshold = 0.85,
    minTagOverlap = 2,
    autoResolve = false,
  } = options;

  // 1. Fingerprint
  const fingerprint = computeFingerprint(memory);

  // 2. Quality assessment
  const qualityScore = assessQuality(memory);

  if (qualityScore < minQuality) {
    return {
      action: 'reject',
      reason: `Quality score ${qualityScore.toFixed(2)} below minimum ${minQuality}`,
      qualityScore,
      fingerprint,
    };
  }

  // 3. Duplicate check
  const dupResult = isDuplicate(memory, existingMemories, dupThreshold);

  if (dupResult.isDuplicate) {
    return {
      action: 'reject',
      reason: `Duplicate of ${dupResult.existingId} (similarity: ${dupResult.similarity.toFixed(2)})`,
      qualityScore,
      fingerprint,
    };
  }

  // 4. Conflict detection
  const conflicts = detectConflict(memory, existingMemories, minTagOverlap);

  // 5. Auto-resolve if enabled and conflicts found
  if (autoResolve && conflicts.length > 0) {
    const topConflict = conflicts[0];
    const strategy = inferStrategy(memory, topConflict.existingMemory, topConflict);

    // null strategy means "accept both, no resolution needed" (e.g. complementary types)
    if (strategy !== null) {
      const resolution = resolveConflict(memory, topConflict.existingMemory, strategy);

      if (resolution.action === 'merge') {
        return {
          action: 'merge',
          reason: `Merging with ${topConflict.existingMemory.id}: ${topConflict.reason}`,
          qualityScore,
          fingerprint,
          conflicts,
          mergeTarget: topConflict.existingMemory,
          mergedTitle: resolution.mergedTitle,
          mergedContent: resolution.mergedContent,
          mergedRule: resolution.mergedRule,
        };
      }

      if (resolution.action === 'skip') {
        return {
          action: 'reject',
          reason: `Existing memory ${topConflict.existingMemory.id} is preferred: ${topConflict.reason}`,
          qualityScore,
          fingerprint,
          conflicts,
        };
      }

      // 'supersede' falls through to accept with conflicts attached
    }
  }

  // 6. Accept (with optional conflict info for the caller to handle)
  return {
    action: 'accept',
    reason: conflicts.length > 0
      ? `Accepted with ${conflicts.length} potential conflict(s)`
      : 'Passed all quality checks',
    qualityScore,
    fingerprint,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };
}
