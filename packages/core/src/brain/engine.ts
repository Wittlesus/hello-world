/**
 * Hippocampal Retrieval Engine — ported from Synaptica
 *
 * 9-stage pipeline (mirrors biological memory retrieval):
 * 1. Tokenize prompt
 * 2. Attention filter — keyword patterns trigger hard warnings
 * 3. Pattern recognition — keyword→tag→memoryId scoring via sensory cortex
 * 4. Associative chaining — matched memories' tags pull in neighbors (0.5x weight)
 * 5. Amygdala weighting — severity multiplies scores
 * 6. Synaptic strength — historical effectiveness multiplied in
 * 7. Context awareness — late-session reduces retrieval volume
 * 8. Dopamine injection — win memories surfaced alongside pain
 * 9. Session pattern detection — hot tag warnings
 */

import type {
  Memory,
  BrainState,
  TagIndex,
  ScoredMemory,
  AttentionFilterResult,
  RetrievalResult,
  RetrievalTelemetry,
  EngineConfig,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { scoreMemory } from './scoring.js';
import { traverseLinksForRetrieval } from './linker.js';

// ── Severity keywords ───────────────────────────────────────────

const HIGH_SEVERITY = new Set([
  'critical', 'never', 'always', 'hours', 'broke', 'lost', 'destroyed',
  'catastrophe', 'disaster', 'data loss', 'irreversible', 'production',
  'security', 'credential', 'password', 'secret',
]);

const MEDIUM_SEVERITY = new Set([
  'important', 'careful', 'warning', 'gotcha', 'tricky', 'subtle',
  'mistake', 'bug', 'wrong', 'broke',
]);

// ── Stage 1: Tokenize ───────────────────────────────────────────

export function tokenize(text: string): Set<string> {
  const matches = text.toLowerCase().match(/\b[\w][\w.-]*\b/g);
  return new Set(matches ?? []);
}

// ── Stage 2: Attention Filter ───────────────────────────────────

export function runAttentionFilter(
  prompt: string,
  patterns: Record<string, string>,
): AttentionFilterResult | null {
  const lower = prompt.toLowerCase();
  for (const [keyword, message] of Object.entries(patterns)) {
    if (lower.includes(keyword)) {
      return { type: keyword, message };
    }
  }
  return null;
}

// ── Stage 3: Pattern Recognition ────────────────────────────────

export function buildTagIndex(memories: Memory[]): TagIndex {
  const index: TagIndex = {};
  for (const mem of memories) {
    for (const tag of mem.tags) {
      if (!index[tag]) index[tag] = [];
      if (!index[tag].includes(mem.id)) index[tag].push(mem.id);
    }
  }
  return index;
}

function patternRecognition(
  tokens: Set<string>,
  tagIndex: TagIndex,
  cortex: Record<string, string[]>,
): { scores: Record<string, number>; matchedTags: Set<string> } {
  const scores: Record<string, number> = {};
  const matchedTags = new Set<string>();

  for (const word of tokens) {
    const mapped = [...(cortex[word] ?? [])];
    if (word in tagIndex && !mapped.includes(word)) mapped.push(word);

    for (const tag of mapped) {
      if (tag in tagIndex) {
        matchedTags.add(tag);
        for (const id of tagIndex[tag]) {
          scores[id] = (scores[id] ?? 0) + 1;
        }
      }
    }
  }

  return { scores, matchedTags };
}

// ── Stage 4: Associative Chaining ───────────────────────────────

function associativeChaining(
  directScores: Record<string, number>,
  matchedTags: Set<string>,
  tagIndex: TagIndex,
  memMap: Map<string, Memory>,
): { scores: Record<string, number>; matchedTags: Set<string> } {
  const scores = { ...directScores };
  const allTags = new Set(matchedTags);
  const directIds = new Set(Object.keys(directScores));

  const neighborTags = new Set<string>();
  let checked = 0;
  for (const id of directIds) {
    if (checked >= 6) break;
    const mem = memMap.get(id);
    if (mem) for (const tag of mem.tags) neighborTags.add(tag);
    checked++;
  }

  for (const tag of neighborTags) {
    if (matchedTags.has(tag) || !(tag in tagIndex)) continue;
    for (const id of tagIndex[tag]) {
      if (!directIds.has(id)) {
        scores[id] = (scores[id] ?? 0) + 0.5;
        allTags.add(tag);
      }
    }
  }

  return { scores, matchedTags: allTags };
}

// ── Stage 5: Amygdala Weighting ─────────────────────────────────

function amygdalaWeight(memory: Memory): number {
  if (memory.severity === 'high') return 2.0;
  if (memory.severity === 'medium') return 1.5;

  const text = `${memory.title} ${memory.content} ${memory.rule}`.toLowerCase();
  for (const word of HIGH_SEVERITY) if (text.includes(word)) return 2.0;
  for (const word of MEDIUM_SEVERITY) if (text.includes(word)) return 1.5;
  if (text.length > 500) return 1.3;
  return 1.0;
}

// ── Fuzzy Fallback ──────────────────────────────────────────────

function fuzzyMatch(
  prompt: string,
  memories: Memory[],
): { scores: Record<string, number>; tags: Set<string> } {
  const scores: Record<string, number> = {};
  const tags = new Set<string>();
  const words = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  for (const mem of memories) {
    const title = mem.title.toLowerCase();
    const rule = mem.rule.toLowerCase();
    const content = mem.content.toLowerCase();

    const titleMatch = words.some(w => title.includes(w));
    const ruleMatch = words.some(w => rule.includes(w));
    const contentMatch = words.some(w => w.length > 4 && content.includes(w));

    if (titleMatch || ruleMatch || contentMatch) {
      scores[mem.id] = titleMatch ? 1.0 : ruleMatch ? 0.8 : 0.5;
      for (const t of mem.tags) tags.add(t);
    }
  }

  return { scores, tags };
}

// ── Format Injection Text ───────────────────────────────────────

function formatInjection(result: Omit<RetrievalResult, 'injectionText' | 'telemetry'>): string {
  const parts: string[] = [];

  if (result.attentionFilter) {
    parts.push(`WARNING: ${result.attentionFilter.message}`);
  }

  if (result.painMemories.length > 0) {
    parts.push('PAIN MEMORY RETRIEVED (auto-cue from your prompt):');
    for (const sm of result.painMemories) {
      let line = `- #${sm.memory.id}: ${sm.memory.title}`;
      if (sm.memory.rule) line += `\n  -> ${sm.memory.rule.slice(0, 200)}`;
      parts.push(line);
    }
  }

  if (result.winMemories.length > 0) {
    parts.push('\nWIN MEMORY (you\'ve handled this domain before):');
    for (const sm of result.winMemories) {
      let line = `- #${sm.memory.id}: ${sm.memory.title}`;
      if (sm.memory.rule) line += `\n  -> ${sm.memory.rule.slice(0, 200)}`;
      parts.push(line);
    }
  }

  if (result.hotTags.length > 0) {
    const tagList = result.hotTags.map(t => `\`${t}\``).join(', ');
    parts.push(`\nPATTERN DETECTED: Tags ${tagList} have fired repeatedly. Consider addressing the root cause.`);
  }

  return parts.join('\n');
}

// ── Main Retrieval Pipeline ─────────────────────────────────────

export function retrieveMemories(
  prompt: string,
  memories: Memory[],
  state: BrainState | null,
  config: Partial<EngineConfig> = {},
): RetrievalResult {
  const startTime = performance.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const phase = getContextPhase(state?.messageCount ?? 0, cfg);

  const empty: RetrievalResult = {
    painMemories: [],
    winMemories: [],
    matchedTags: [],
    attentionFilter: null,
    contextPhase: phase,
    hotTags: [],
    injectionText: '',
  };

  if (prompt.trim().length < cfg.minPromptLength) return empty;

  const tokens = tokenize(prompt);
  const memMap = new Map(memories.map(m => [m.id, m]));

  // Stage 2: Attention filter
  const attentionFilter = runAttentionFilter(prompt, cfg.attentionPatterns);

  // Pre-filter: binary gate -- remove truly stale memories before pattern recognition
  // scoreMemory is NOT also used as post-multiply (removed to avoid compound penalty)
  const viable = memories.filter(m =>
    scoreMemory({ ...m, failureCorrelations: (m as Record<string, unknown>).failureCorrelations as number ?? 0 }) >= 0.15,
  );
  const viableMap = new Map(viable.map(m => [m.id, m]));

  // Split by type (from viable pool only)
  const painMems = viable.filter(m => m.type === 'pain' || m.type === 'fact');
  const winMems = viable.filter(m => m.type === 'win');

  // Stage 3: Pattern recognition
  const painIndex = buildTagIndex(painMems);
  const { scores: rawScores, matchedTags } = patternRecognition(tokens, painIndex, cfg.cortex);

  // Track direct match count before fuzzy
  const directMatchCount = Object.keys(rawScores).length;

  // Fuzzy fallback -- track which tokens matched via fuzzy but not cortex
  let fuzzyFallback = false;
  const cortexGaps: string[] = [];
  if (Object.keys(rawScores).length === 0) {
    fuzzyFallback = true;
    const fuzzy = fuzzyMatch(prompt, painMems);
    Object.assign(rawScores, fuzzy.scores);
    for (const t of fuzzy.tags) matchedTags.add(t);

    // Identify cortex gaps: prompt tokens that found fuzzy matches
    // but had no cortex entry
    for (const word of tokens) {
      if (!(word in cfg.cortex) && word.length > 3) {
        const lower = word.toLowerCase();
        const hitFuzzy = painMems.some(m =>
          m.title.toLowerCase().includes(lower) ||
          m.rule.toLowerCase().includes(lower) ||
          (lower.length > 4 && m.content.toLowerCase().includes(lower)),
        );
        if (hitFuzzy) cortexGaps.push(word);
      }
    }
  }

  if (Object.keys(rawScores).length === 0 && !attentionFilter) {
    return { ...empty, attentionFilter };
  }

  // Stage 4: Associative chaining
  const chained = associativeChaining(rawScores, matchedTags, painIndex, memMap);
  const associativeMatchCount = Object.keys(chained.scores).length - directMatchCount;

  // Stage 5-6: Amygdala + synaptic strength + quality score
  const maxPain = phase === 'late' ? cfg.lateMaxPain : cfg.maxPain;
  const maxWins = phase === 'late' ? cfg.lateMaxWins : cfg.maxWins;

  const weighted: Record<string, number> = {};
  for (const [id, score] of Object.entries(chained.scores)) {
    const mem = memMap.get(id);
    if (!mem) continue;
    const severity = amygdalaWeight(mem);
    const synaptic = state?.memoryTraces[id]?.synapticStrength ?? mem.synapticStrength;
    // scoreMemory is used ONLY as pre-filter (binary gate above), not here
    // Post-multiply removed to avoid compound penalty with the pre-filter
    weighted[id] = score * severity * synaptic;
  }

  // Stage 5.5: Link traversal via linker module
  const directIds = new Set(Object.keys(chained.scores));
  const scoredIdMap = new Map(Object.entries(weighted));
  const linkResult = traverseLinksForRetrieval(scoredIdMap, viableMap);
  const linkTraversalCount = linkResult.traversalCount;
  for (const [id, score] of linkResult.additionalScores) {
    weighted[id] = Math.max(weighted[id] ?? 0, score);
    const target = viableMap.get(id);
    if (target) for (const tag of target.tags) chained.matchedTags.add(tag);
  }

  // Stage 7: Rank and select
  const rankedPain = Object.entries(weighted)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxPain);

  const scoredPain: ScoredMemory[] = [];
  for (const [id, score] of rankedPain) {
    const mem = viableMap.get(id) ?? memMap.get(id);
    if (!mem) continue;
    scoredPain.push({
      memory: mem,
      score,
      matchedTags: mem.tags.filter(t => chained.matchedTags.has(t)),
      source: directIds.has(id) ? 'direct' : 'associative',
    });
  }

  // Stage 8: Dopamine -- wins using same matched tags
  const winIndex = buildTagIndex(winMems);
  const winScores: Record<string, number> = {};
  for (const tag of chained.matchedTags) {
    if (tag in winIndex) {
      for (const id of winIndex[tag]) {
        winScores[id] = (winScores[id] ?? 0) + 1;
      }
    }
  }

  const scoredWins: ScoredMemory[] = [];
  const rankedWins = Object.entries(winScores).sort(([, a], [, b]) => b - a).slice(0, maxWins);
  const winIdSet = new Set(rankedWins.map(([id]) => id));
  for (const [id, score] of rankedWins) {
    const mem = memMap.get(id);
    if (!mem) continue;
    scoredWins.push({
      memory: mem,
      score,
      matchedTags: mem.tags.filter(t => chained.matchedTags.has(t)),
      source: 'dopamine',
    });
  }

  // Forced pain-win pairing: if a pain memory links to a 'resolves' win, pull it in (respecting maxWins cap)
  for (const pm of scoredPain) {
    if (scoredWins.length >= maxWins) break;
    const links = pm.memory.links;
    if (!links?.length) continue;
    for (const link of links) {
      if (scoredWins.length >= maxWins) break;
      if (link.relationship !== 'resolves') continue;
      if (winIdSet.has(link.targetId)) continue;
      const winMem = viableMap.get(link.targetId);
      if (!winMem || winMem.type !== 'win') continue;
      scoredWins.push({
        memory: winMem,
        score: 0.5,
        matchedTags: winMem.tags.filter(t => chained.matchedTags.has(t)),
        source: 'dopamine',
      });
      winIdSet.add(link.targetId);
    }
  }

  // Stage 9: Hot tags
  const hotTags: string[] = [];
  if (state) {
    for (const tag of chained.matchedTags) {
      const freq = (state.firingFrequency[tag] ?? 0) + 1;
      if (freq >= cfg.sessionTagRepeatThreshold) hotTags.push(tag);
    }
  }

  // Build telemetry
  const telemetry: RetrievalTelemetry = {
    queryLength: prompt.length,
    tokenCount: tokens.size,
    candidateCount: viable.length,
    directMatchCount,
    associativeMatchCount,
    linkTraversalCount,
    fuzzyFallback,
    resultCount: scoredPain.length + scoredWins.length,
    topScore: rankedPain.length > 0 ? rankedPain[0][1] : 0,
    executionMs: performance.now() - startTime,
    contextPhase: phase,
    hotTagsTriggered: hotTags.length,
    cortexGaps,
  };

  const result = {
    painMemories: scoredPain,
    winMemories: scoredWins,
    matchedTags: [...chained.matchedTags],
    attentionFilter,
    contextPhase: phase,
    hotTags,
    telemetry,
  };

  return { ...result, injectionText: formatInjection(result) };
}

// ── Context Phase Helper ────────────────────────────────────────

export function getContextPhase(
  messageCount: number,
  cfg: Pick<EngineConfig, 'contextPhaseMid' | 'contextPhaseLate'>,
): 'early' | 'mid' | 'late' {
  if (messageCount >= cfg.contextPhaseLate) return 'late';
  if (messageCount >= cfg.contextPhaseMid) return 'mid';
  return 'early';
}

// ── Severity Inference ──────────────────────────────────────────

export function inferSeverity(content: string, rule = ''): 'low' | 'medium' | 'high' {
  const text = `${content} ${rule}`.toLowerCase();
  for (const word of HIGH_SEVERITY) if (text.includes(word)) return 'high';
  for (const word of MEDIUM_SEVERITY) if (text.includes(word)) return 'medium';
  return 'low';
}
