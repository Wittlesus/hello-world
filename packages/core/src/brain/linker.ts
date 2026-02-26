/**
 * Memory Linker -- graph-based memory linking for the brain engine.
 *
 * Analyzes new memories against existing ones to discover relationships,
 * builds an adjacency graph for fast traversal, and provides the link
 * traversal logic used by engine.ts stage 5.5.
 *
 * All functions are pure -- no side effects, no file I/O.
 */

import type { Memory } from '../types.js';
import { STOP_WORDS } from './stop-words.js';

// ── Link Types and Weights ─────────────────────────────────────

export type LinkRelationship = 'resolves' | 'extends' | 'related' | 'contradicts' | 'supersedes';

/** Default weight for each link relationship type. Used as the base
 *  multiplier when propagating scores through the link graph. */
export const LINK_WEIGHTS: Record<LinkRelationship, number> = {
  resolves: 0.8,
  extends: 0.6,
  related: 0.4,
  contradicts: 0.7,
  supersedes: 0.9,
};

/** A candidate link returned by findLinks before being committed to a memory. */
export interface CandidateLink {
  targetId: string;
  relationship: LinkRelationship;
  weight: number;
  reason: string;
}

/** A memory link as stored on the Memory object. */
export interface MemoryLink {
  targetId: string;
  relationship: LinkRelationship;
  createdAt: string;
}

/** An entry in the link adjacency graph. */
export interface LinkGraphEntry {
  memoryId: string;
  outgoing: Array<{ targetId: string; relationship: LinkRelationship; weight: number }>;
  incoming: Array<{ sourceId: string; relationship: LinkRelationship; weight: number }>;
}

/** The full link adjacency map, keyed by memory ID. */
export type LinkGraph = Map<string, LinkGraphEntry>;

/** A memory discovered via link traversal, with the traversal path info. */
export interface TraversedMemory {
  memory: Memory;
  depth: number;
  pathWeight: number;
  via: Array<{ memoryId: string; relationship: LinkRelationship }>;
}

// ── Text Utilities (no external deps) ──────────────────────────

/** Extract meaningful keywords from text. Strips noise words and
 *  returns lowercased tokens of 3+ characters. */
function extractKeywords(text: string): Set<string> {
  const matches = text.toLowerCase().match(/\b[\w][\w.-]*\b/g);
  if (!matches) return new Set();

  const keywords = new Set<string>();
  for (const word of matches) {
    if (word.length >= 3 && !STOP_WORDS.has(word)) {
      keywords.add(word);
    }
  }
  return keywords;
}

/** Get the full searchable text from a memory. */
function memoryText(m: Memory): string {
  return `${m.title} ${m.content} ${m.rule}`;
}

// ── Similarity ─────────────────────────────────────────────────

/** Compute similarity between two memories using tag overlap + content
 *  keyword matching. Returns a score from 0.0 to 1.0.
 *
 *  - Tag overlap: Jaccard index over tag arrays (weighted 0.6).
 *  - Keyword overlap: Jaccard index over extracted content keywords (weighted 0.4).
 */
export function computeSimilarity(memA: Memory, memB: Memory): number {
  // Tag similarity (Jaccard)
  const tagsA = new Set(memA.tags);
  const tagsB = new Set(memB.tags);
  const tagIntersection = [...tagsA].filter(t => tagsB.has(t)).length;
  const tagUnion = new Set([...tagsA, ...tagsB]).size;
  const tagSimilarity = tagUnion > 0 ? tagIntersection / tagUnion : 0;

  // Keyword similarity (Jaccard)
  const kwA = extractKeywords(memoryText(memA));
  const kwB = extractKeywords(memoryText(memB));
  const kwIntersection = [...kwA].filter(k => kwB.has(k)).length;
  const kwUnion = new Set([...kwA, ...kwB]).size;
  const kwSimilarity = kwUnion > 0 ? kwIntersection / kwUnion : 0;

  return tagSimilarity * 0.6 + kwSimilarity * 0.4;
}

// ── Contradiction Detection ────────────────────────────────────

/** Directional negation pairs. If one memory's rule/content uses one
 *  word and the other uses its counterpart in the same domain, that
 *  signals a contradiction. */
const NEGATION_PAIRS: Array<[string, string]> = [
  ['always', 'never'],
  ['must', 'must not'],
  ['do', 'do not'],
  ['should', 'should not'],
  ['safe', 'unsafe'],
  ['safe', 'dangerous'],
  ['works', 'broken'],
  ['works', 'fails'],
  ['correct', 'incorrect'],
  ['correct', 'wrong'],
  ['enable', 'disable'],
  ['allow', 'block'],
  ['allow', 'deny'],
  ['success', 'failure'],
  ['add', 'remove'],
  ['include', 'exclude'],
];

/** Check if two memories contradict each other.
 *
 *  A contradiction is detected when:
 *  1. The memories share 2+ tags (same domain), AND
 *  2. One of:
 *     a. One is pain and the other is win with 3+ shared tags (opposite outcome).
 *     b. Their rule/content text contains negation pairs (rule conflict).
 *     c. They have the same type and title prefix but opposing rule language.
 *
 *  Returns a score 0.0 to 1.0 where 0 = no contradiction, 1 = strong contradiction.
 */
export function detectContradiction(memA: Memory, memB: Memory): number {
  const sharedTags = memA.tags.filter(t => memB.tags.includes(t));
  if (sharedTags.length < 2) return 0;

  let score = 0;

  // Opposite outcome: pain vs win in the same domain
  if (
    (memA.type === 'pain' && memB.type === 'win') ||
    (memA.type === 'win' && memB.type === 'pain')
  ) {
    if (sharedTags.length >= 3) {
      score = Math.max(score, 0.7);
    } else {
      score = Math.max(score, 0.4);
    }
  }

  // Rule/content negation pairs
  const textA = `${memA.rule} ${memA.content}`.toLowerCase();
  const textB = `${memB.rule} ${memB.content}`.toLowerCase();

  for (const [pos, neg] of NEGATION_PAIRS) {
    const aHasPos = textA.includes(pos);
    const aHasNeg = textA.includes(neg);
    const bHasPos = textB.includes(pos);
    const bHasNeg = textB.includes(neg);

    if ((aHasPos && bHasNeg) || (aHasNeg && bHasPos)) {
      // Scale by domain overlap
      const overlapFactor = Math.min(1.0, sharedTags.length / 4);
      score = Math.max(score, 0.5 + overlapFactor * 0.3);
      break; // One strong signal is enough
    }
  }

  // Same title prefix with different rules
  const titleA = memA.title.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const titleB = memB.title.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  if (
    titleA.length > 10 &&
    titleB.length > 10 &&
    titleA.slice(0, 30) === titleB.slice(0, 30) &&
    memA.rule && memB.rule &&
    memA.rule !== memB.rule
  ) {
    score = Math.max(score, 0.6);
  }

  return Math.min(1.0, score);
}

// ── Supersession Detection ─────────────────────────────────────

/** Check if a new memory supersedes an old one.
 *
 *  Supersession is detected when:
 *  1. Same type, AND
 *  2. High title similarity (prefix match or normalized match), AND
 *  3. The new memory is newer, AND
 *  4. Significant tag overlap (3+ shared tags OR 60%+ Jaccard).
 *
 *  Returns a score 0.0 to 1.0 where 0 = no supersession, 1 = clear supersession.
 */
export function detectSupersession(newMem: Memory, oldMem: Memory): number {
  // Must be same type
  if (newMem.type !== oldMem.type) return 0;

  // New must be newer
  if (new Date(newMem.createdAt).getTime() <= new Date(oldMem.createdAt).getTime()) return 0;

  let score = 0;

  // Title similarity
  const newTitle = newMem.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const oldTitle = oldMem.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  if (newTitle === oldTitle) {
    // Exact title match = strong supersession signal
    score += 0.6;
  } else if (
    newTitle.length > 10 &&
    oldTitle.length > 10 &&
    newTitle.slice(0, 40) === oldTitle.slice(0, 40)
  ) {
    // Title prefix match
    score += 0.4;
  } else {
    // No title similarity -- unlikely supersession
    return 0;
  }

  // Tag overlap
  const sharedTags = newMem.tags.filter(t => oldMem.tags.includes(t));
  const tagUnion = new Set([...newMem.tags, ...oldMem.tags]).size;
  const tagJaccard = tagUnion > 0 ? sharedTags.length / tagUnion : 0;

  if (sharedTags.length >= 3 || tagJaccard >= 0.6) {
    score += 0.3;
  } else if (sharedTags.length >= 2) {
    score += 0.15;
  } else {
    // Almost no shared tags -- not supersession
    return 0;
  }

  // Content similarity boost: if the new memory's content covers the old one's keywords
  const oldKw = extractKeywords(memoryText(oldMem));
  const newKw = extractKeywords(memoryText(newMem));
  if (oldKw.size > 0) {
    const covered = [...oldKw].filter(k => newKw.has(k)).length;
    const coverage = covered / oldKw.size;
    if (coverage >= 0.5) {
      score += 0.1;
    }
  }

  return Math.min(1.0, score);
}

// ── Find Links ─────────────────────────────────────────────────

/** Analyze a new memory against all existing memories and return
 *  candidate links sorted by weight (highest first).
 *
 *  Checks for: resolves, supersedes, contradicts, extends, related.
 *  Returns at most 10 candidate links to avoid over-linking. */
export function findLinks(
  newMemory: Memory,
  existingMemories: Memory[],
): CandidateLink[] {
  const candidates: CandidateLink[] = [];

  for (const existing of existingMemories) {
    // Skip self-links
    if (existing.id === newMemory.id) continue;

    // Check supersession (new supersedes old)
    const superScore = detectSupersession(newMemory, existing);
    if (superScore >= 0.5) {
      candidates.push({
        targetId: existing.id,
        relationship: 'supersedes',
        weight: LINK_WEIGHTS.supersedes * superScore,
        reason: `New memory supersedes #${existing.id} (score: ${superScore.toFixed(2)}, same topic with newer info)`,
      });
      continue; // Supersession is exclusive -- don't also mark as extends/related
    }

    // Check contradiction
    const contradictionScore = detectContradiction(newMemory, existing);
    if (contradictionScore >= 0.5) {
      candidates.push({
        targetId: existing.id,
        relationship: 'contradicts',
        weight: LINK_WEIGHTS.contradicts * contradictionScore,
        reason: `Contradicts #${existing.id} (score: ${contradictionScore.toFixed(2)})`,
      });
      // Contradiction can coexist with other link types in theory,
      // but we skip to avoid noise
      continue;
    }

    // Check resolves: a win that shares 3+ tags with a pain
    if (
      newMemory.type === 'win' && existing.type === 'pain' &&
      newMemory.tags.filter(t => existing.tags.includes(t)).length >= 3
    ) {
      const similarity = computeSimilarity(newMemory, existing);
      if (similarity >= 0.25) {
        candidates.push({
          targetId: existing.id,
          relationship: 'resolves',
          weight: LINK_WEIGHTS.resolves * similarity,
          reason: `Win resolves pain #${existing.id} (similarity: ${similarity.toFixed(2)})`,
        });
        continue;
      }
    }

    // Check resolves: a pain that shares tags with a win (reverse direction)
    if (
      newMemory.type === 'pain' && existing.type === 'win' &&
      newMemory.tags.filter(t => existing.tags.includes(t)).length >= 3
    ) {
      const similarity = computeSimilarity(newMemory, existing);
      if (similarity >= 0.25) {
        candidates.push({
          targetId: existing.id,
          relationship: 'resolves',
          weight: LINK_WEIGHTS.resolves * similarity,
          reason: `Win #${existing.id} may resolve this pain (similarity: ${similarity.toFixed(2)})`,
        });
        continue;
      }
    }

    // Check extends: same type, moderate similarity
    const similarity = computeSimilarity(newMemory, existing);
    if (similarity >= 0.4 && newMemory.type === existing.type) {
      candidates.push({
        targetId: existing.id,
        relationship: 'extends',
        weight: LINK_WEIGHTS.extends * similarity,
        reason: `Extends #${existing.id} (similarity: ${similarity.toFixed(2)}, same type: ${existing.type})`,
      });
      continue;
    }

    // Check related: lower similarity threshold, any type combination
    if (similarity >= 0.25) {
      candidates.push({
        targetId: existing.id,
        relationship: 'related',
        weight: LINK_WEIGHTS.related * similarity,
        reason: `Related to #${existing.id} (similarity: ${similarity.toFixed(2)})`,
      });
    }
  }

  // Sort by weight descending, cap at 10
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates.slice(0, 10);
}

// ── Apply Links ────────────────────────────────────────────────

/** Return a new memory object with the candidate links added to its
 *  links[] array. Does not mutate the input memory. */
export function applyLinks(
  memory: Memory,
  links: CandidateLink[],
  timestamp?: string,
): Memory {
  const ts = timestamp ?? new Date().toISOString();
  const newLinks: MemoryLink[] = links.map(link => ({
    targetId: link.targetId,
    relationship: link.relationship,
    createdAt: ts,
  }));

  // Merge with existing links, deduplicating by targetId+relationship
  const existingKey = new Set(
    (memory.links ?? []).map(l => `${l.targetId}:${l.relationship}`),
  );

  const merged = [...(memory.links ?? [])];
  for (const nl of newLinks) {
    const key = `${nl.targetId}:${nl.relationship}`;
    if (!existingKey.has(key)) {
      merged.push(nl);
      existingKey.add(key);
    }
  }

  return { ...memory, links: merged };
}

// ── Link Graph ─────────────────────────────────────────────────

/** Build an adjacency map of all memory links for fast traversal.
 *  Indexes both outgoing (from a memory's links[]) and incoming
 *  (links that point to this memory). */
export function buildLinkGraph(memories: Memory[]): LinkGraph {
  const graph: LinkGraph = new Map();

  // Initialize entries for all memories
  for (const mem of memories) {
    graph.set(mem.id, {
      memoryId: mem.id,
      outgoing: [],
      incoming: [],
    });
  }

  // Populate edges
  for (const mem of memories) {
    if (!mem.links?.length) continue;

    const sourceEntry = graph.get(mem.id);
    if (!sourceEntry) continue;

    for (const link of mem.links) {
      const weight = LINK_WEIGHTS[link.relationship as LinkRelationship] ?? 0.4;

      sourceEntry.outgoing.push({
        targetId: link.targetId,
        relationship: link.relationship as LinkRelationship,
        weight,
      });

      // Register incoming edge on the target
      const targetEntry = graph.get(link.targetId);
      if (targetEntry) {
        targetEntry.incoming.push({
          sourceId: mem.id,
          relationship: link.relationship as LinkRelationship,
          weight,
        });
      }
    }
  }

  return graph;
}

// ── Traverse Links ─────────────────────────────────────────────

/** Given a memory ID, follow its links to find related memories up to
 *  the specified depth. Uses BFS with weight decay at each hop.
 *
 *  - Each hop multiplies the path weight by the link weight, so distant
 *    connections naturally score lower.
 *  - Deduplicates: a memory only appears once (highest-weight path wins).
 *  - Returns results sorted by pathWeight descending. */
export function traverseLinks(
  memoryId: string,
  allMemories: Memory[],
  depth: number = 2,
): TraversedMemory[] {
  if (depth < 1) return [];

  const memMap = new Map(allMemories.map(m => [m.id, m]));
  const graph = buildLinkGraph(allMemories);

  // BFS state: track best path weight per memory
  const bestWeight = new Map<string, number>();
  const results = new Map<string, TraversedMemory>();

  interface QueueItem {
    id: string;
    currentDepth: number;
    pathWeight: number;
    path: Array<{ memoryId: string; relationship: LinkRelationship }>;
  }

  const queue: QueueItem[] = [];

  // Seed with direct outgoing links from the source
  const sourceEntry = graph.get(memoryId);
  if (!sourceEntry) return [];

  for (const edge of sourceEntry.outgoing) {
    queue.push({
      id: edge.targetId,
      currentDepth: 1,
      pathWeight: edge.weight,
      path: [{ memoryId, relationship: edge.relationship }],
    });
  }

  // Also consider incoming links (bidirectional traversal)
  for (const edge of sourceEntry.incoming) {
    queue.push({
      id: edge.sourceId,
      currentDepth: 1,
      pathWeight: edge.weight * 0.7, // Incoming traversal gets a discount
      path: [{ memoryId, relationship: edge.relationship }],
    });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;

    // Skip the source memory itself
    if (item.id === memoryId) continue;

    // Only keep the highest-weight path to each memory
    const existing = bestWeight.get(item.id) ?? 0;
    if (item.pathWeight <= existing) continue;
    bestWeight.set(item.id, item.pathWeight);

    const targetMem = memMap.get(item.id);
    if (!targetMem) continue;

    results.set(item.id, {
      memory: targetMem,
      depth: item.currentDepth,
      pathWeight: item.pathWeight,
      via: item.path,
    });

    // Continue traversal if we haven't reached max depth
    if (item.currentDepth < depth) {
      const entry = graph.get(item.id);
      if (entry) {
        for (const edge of entry.outgoing) {
          // Don't loop back to source or already-visited with better weight
          if (edge.targetId === memoryId) continue;
          const nextWeight = item.pathWeight * edge.weight;
          const nextBest = bestWeight.get(edge.targetId) ?? 0;
          if (nextWeight > nextBest) {
            queue.push({
              id: edge.targetId,
              currentDepth: item.currentDepth + 1,
              pathWeight: nextWeight,
              path: [...item.path, { memoryId: item.id, relationship: edge.relationship }],
            });
          }
        }
      }
    }
  }

  // Sort by pathWeight descending
  return [...results.values()].sort((a, b) => b.pathWeight - a.pathWeight);
}

/** Lightweight traversal for the engine pipeline (stage 5.5).
 *  Given a set of scored memory IDs, follows their links one hop deep
 *  and returns additional memory IDs with weighted scores.
 *
 *  This is the optimized version extracted from engine.ts -- it avoids
 *  building a full LinkGraph when only a single-hop traversal is needed
 *  during retrieval. */
export function traverseLinksForRetrieval(
  scoredIds: Map<string, number>,
  viableMemories: Map<string, Memory>,
): { additionalScores: Map<string, number>; traversalCount: number } {
  const additionalScores = new Map<string, number>();
  let traversalCount = 0;

  for (const [id, baseScore] of scoredIds) {
    if (baseScore === 0) continue;
    const mem = viableMemories.get(id);
    if (!mem?.links?.length) continue;

    for (const link of mem.links) {
      // Skip contradicts/supersedes for positive scoring -- they are
      // informational links, not retrieval boosters
      if (link.relationship === 'contradicts' || link.relationship === 'supersedes') continue;

      const target = viableMemories.get(link.targetId);
      if (!target) continue;

      const linkWeight = LINK_WEIGHTS[link.relationship as LinkRelationship] ?? 0.4;
      const propagatedScore = baseScore * linkWeight;

      const existing = additionalScores.get(link.targetId) ?? scoredIds.get(link.targetId) ?? 0;
      if (propagatedScore > existing) {
        additionalScores.set(link.targetId, propagatedScore);
        traversalCount++;
      }
    }
  }

  return { additionalScores, traversalCount };
}
