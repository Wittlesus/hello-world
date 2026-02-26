/**
 * Learned Rules -- extracts behavioral rules from repeated memory patterns.
 *
 * When the same tags appear across multiple pain or win memories with rules,
 * this module identifies the common patterns and promotes them to "learned rules."
 * High-confidence rules become candidates for CLAUDE.md promotion.
 *
 * All functions are pure -- no side effects, no file I/O.
 */

import type { Memory } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface LearnedRule {
  id: string;
  rule: string;
  tags: string[];
  sourceMemoryIds: string[];
  confidence: number; // 0-1
  observationCount: number;
  type: 'pain-pattern' | 'win-pattern' | 'contradiction-resolution';
  promotedToClaudeMd: boolean;
  createdAt: string;
  lastReinforced: string;
}

export interface LearnedRulesStore {
  rules: LearnedRule[];
  lastUpdated: string;
}

export interface RuleCandidate {
  rule: string;
  tags: string[];
  sourceMemoryIds: string[];
  confidence: number;
  type: LearnedRule['type'];
}

export interface ClaudeMdCandidate {
  rule: LearnedRule;
  section: string; // Suggested CLAUDE.md section
  formattedRule: string; // Ready to paste into CLAUDE.md
}

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Extract rule candidates from a set of memories.
 * Groups memories by overlapping tags and finds common rule patterns.
 */
export function extractRuleCandidates(
  memories: Memory[],
  minGroupSize = 3,
  minTagOverlap = 2,
): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];

  // Group memories by type (pain rules vs win rules)
  const painMems = memories.filter(m => m.type === 'pain' && m.rule.length > 10);
  const winMems = memories.filter(m => m.type === 'win' && m.rule.length > 10);

  // Extract pain patterns
  const painGroups = groupByTagOverlap(painMems, minTagOverlap);
  for (const group of painGroups) {
    if (group.length < minGroupSize) continue;
    const extracted = extractCommonRule(group, 'pain-pattern');
    if (extracted) candidates.push(extracted);
  }

  // Extract win patterns
  const winGroups = groupByTagOverlap(winMems, minTagOverlap);
  for (const group of winGroups) {
    if (group.length < minGroupSize) continue;
    const extracted = extractCommonRule(group, 'win-pattern');
    if (extracted) candidates.push(extracted);
  }

  // Extract contradiction resolutions (pain + win on same tags)
  const contradictions = findContradictionPairs(painMems, winMems, minTagOverlap);
  for (const pair of contradictions) {
    const extracted = extractContradictionRule(pair.pains, pair.wins, pair.sharedTags);
    if (extracted) candidates.push(extracted);
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Learn from candidates: merge with existing rules or create new ones.
 */
export function learnRules(
  candidates: RuleCandidate[],
  existing: LearnedRule[],
): { newRules: LearnedRule[]; reinforced: LearnedRule[] } {
  const ruleMap = new Map(existing.map(r => [r.id, { ...r }]));
  const newRules: LearnedRule[] = [];
  const reinforced: LearnedRule[] = [];
  const now = new Date().toISOString();

  for (const candidate of candidates) {
    // Check if this matches an existing rule (same tags + similar rule text)
    const match = findMatchingRule(candidate, existing);

    if (match) {
      const updated = ruleMap.get(match.id);
      if (!updated) continue;

      // Reinforce existing rule
      updated.observationCount += 1;
      updated.confidence = Math.min(0.95, updated.confidence + 0.1);
      updated.lastReinforced = now;

      // Add new source memory IDs
      const idSet = new Set(updated.sourceMemoryIds);
      for (const id of candidate.sourceMemoryIds) idSet.add(id);
      updated.sourceMemoryIds = [...idSet];

      // If candidate rule is longer/better, update
      if (candidate.rule.length > updated.rule.length) {
        updated.rule = candidate.rule;
      }

      ruleMap.set(match.id, updated);
      reinforced.push(updated);
    } else if (candidate.confidence >= 0.4) {
      // Create new learned rule
      const rule: LearnedRule = {
        id: `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        rule: candidate.rule,
        tags: candidate.tags,
        sourceMemoryIds: candidate.sourceMemoryIds,
        confidence: candidate.confidence,
        observationCount: 1,
        type: candidate.type,
        promotedToClaudeMd: false,
        createdAt: now,
        lastReinforced: now,
      };
      newRules.push(rule);
    }
  }

  return { newRules, reinforced };
}

/**
 * Get rules ready for CLAUDE.md promotion.
 * Must be high confidence, reinforced multiple times, not already promoted.
 */
export function getClaudeMdCandidates(
  rules: LearnedRule[],
  minConfidence = 0.8,
  minObservations = 3,
): ClaudeMdCandidate[] {
  return rules
    .filter(r =>
      !r.promotedToClaudeMd &&
      r.confidence >= minConfidence &&
      r.observationCount >= minObservations,
    )
    .map(r => ({
      rule: r,
      section: inferClaudeMdSection(r),
      formattedRule: formatForClaudeMd(r),
    }))
    .sort((a, b) => b.rule.confidence - a.rule.confidence);
}

/**
 * Create an empty rules store.
 */
export function createEmptyRulesStore(): LearnedRulesStore {
  return {
    rules: [],
    lastUpdated: new Date().toISOString(),
  };
}

// ── Internal Helpers ───────────────────────────────────────────────

/**
 * Group memories by tag overlap. Greedy clustering.
 */
function groupByTagOverlap(memories: Memory[], minOverlap: number): Memory[][] {
  const used = new Set<string>();
  const groups: Memory[][] = [];

  // Sort by tag count descending for better clustering
  const sorted = [...memories].sort((a, b) => b.tags.length - a.tags.length);

  for (const seed of sorted) {
    if (used.has(seed.id)) continue;

    const group: Memory[] = [seed];
    used.add(seed.id);

    for (const other of sorted) {
      if (used.has(other.id)) continue;
      const overlap = seed.tags.filter(t => other.tags.includes(t));
      if (overlap.length >= minOverlap) {
        group.push(other);
        used.add(other.id);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Extract a common rule from a group of same-type memories.
 */
function extractCommonRule(
  group: Memory[],
  type: 'pain-pattern' | 'win-pattern',
): RuleCandidate | null {
  if (group.length === 0) return null;

  // Find common tags across the group
  const tagCounts = new Map<string, number>();
  for (const mem of group) {
    for (const tag of mem.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const commonTags = [...tagCounts.entries()]
    .filter(([, count]) => count >= Math.ceil(group.length / 2))
    .map(([tag]) => tag);

  if (commonTags.length === 0) return null;

  // Pick the best rule: longest rule that's also specific
  const rules = group.map(m => m.rule).filter(r => r.length > 10);
  if (rules.length === 0) return null;

  // Score rules by length and actionability
  const scoredRules = rules.map(r => ({
    rule: r,
    score: r.length * (hasActionableLanguage(r) ? 2 : 1),
  }));
  scoredRules.sort((a, b) => b.score - a.score);

  const bestRule = scoredRules[0].rule;

  // Confidence based on group size
  const confidence = Math.min(0.9, 0.3 + group.length * 0.15);

  return {
    rule: bestRule,
    tags: commonTags,
    sourceMemoryIds: group.map(m => m.id),
    confidence,
    type,
  };
}

/**
 * Find pain/win pairs on the same tags (contradiction = resolved problem).
 */
function findContradictionPairs(
  pains: Memory[],
  wins: Memory[],
  minOverlap: number,
): Array<{ pains: Memory[]; wins: Memory[]; sharedTags: string[] }> {
  const pairs: Array<{ pains: Memory[]; wins: Memory[]; sharedTags: string[] }> = [];
  const usedPains = new Set<string>();
  const usedWins = new Set<string>();

  for (const pain of pains) {
    const matchingWins = wins.filter(w => {
      if (usedWins.has(w.id)) return false;
      const overlap = pain.tags.filter(t => w.tags.includes(t));
      return overlap.length >= minOverlap;
    });

    if (matchingWins.length > 0) {
      const sharedTags = pain.tags.filter(t =>
        matchingWins.some(w => w.tags.includes(t)),
      );
      pairs.push({
        pains: [pain],
        wins: matchingWins,
        sharedTags,
      });
      usedPains.add(pain.id);
      for (const w of matchingWins) usedWins.add(w.id);
    }
  }

  return pairs;
}

/**
 * Extract a rule from a contradiction (pain resolved by win).
 */
function extractContradictionRule(
  pains: Memory[],
  wins: Memory[],
  sharedTags: string[],
): RuleCandidate | null {
  // The win's rule is the resolution
  const winRules = wins.map(w => w.rule).filter(r => r.length > 10);
  const painRules = pains.map(p => p.rule).filter(r => r.length > 10);

  if (winRules.length === 0 && painRules.length === 0) return null;

  // Prefer win rule (solution) over pain rule (problem)
  const bestRule = winRules.length > 0
    ? winRules.sort((a, b) => b.length - a.length)[0]
    : `Avoid: ${painRules.sort((a, b) => b.length - a.length)[0]}`;

  const confidence = Math.min(0.85, 0.4 + (pains.length + wins.length) * 0.1);

  return {
    rule: bestRule,
    tags: sharedTags,
    sourceMemoryIds: [...pains.map(p => p.id), ...wins.map(w => w.id)],
    confidence,
    type: 'contradiction-resolution',
  };
}

/**
 * Find an existing rule that matches a candidate.
 */
function findMatchingRule(
  candidate: RuleCandidate,
  existing: LearnedRule[],
): LearnedRule | undefined {
  return existing.find(r => {
    // Same type
    if (r.type !== candidate.type) return false;
    // Significant tag overlap
    const overlap = r.tags.filter(t => candidate.tags.includes(t));
    if (overlap.length < 2) return false;
    // Similar rule text (keyword overlap)
    const rWords = new Set(extractKeywords(r.rule));
    const cWords = new Set(extractKeywords(candidate.rule));
    let common = 0;
    for (const w of rWords) if (cWords.has(w)) common++;
    const jaccard = common / (rWords.size + cWords.size - common);
    return jaccard > 0.3;
  });
}

function extractKeywords(text: string): string[] {
  return text.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [];
}

function hasActionableLanguage(text: string): boolean {
  return /\b(always|never|must|should|avoid|use|prefer|ensure|check|verify|run|before|after|instead)\b/i.test(text);
}

/**
 * Infer which CLAUDE.md section a rule belongs in.
 */
function inferClaudeMdSection(rule: LearnedRule): string {
  const tags = new Set(rule.tags);

  if (tags.has('git') || tags.has('deployment')) return 'Coding Rules';
  if (tags.has('strategy') || tags.has('validation')) return "Pat's Preferences";
  if (tags.has('memory') || tags.has('brain')) return 'Architecture';
  if (tags.has('testing') || tags.has('debugging')) return 'Coding Rules';
  if (tags.has('social') || tags.has('writing')) return 'Direction Capture';
  return 'Coding Rules';
}

/**
 * Format a rule for CLAUDE.md inclusion.
 */
function formatForClaudeMd(rule: LearnedRule): string {
  const prefix = rule.type === 'pain-pattern'
    ? '- **Learned (pain):**'
    : rule.type === 'win-pattern'
    ? '- **Learned (win):**'
    : '- **Learned (resolution):**';

  return `${prefix} ${rule.rule} (confidence: ${(rule.confidence * 100).toFixed(0)}%, ${rule.observationCount} observations)`;
}
