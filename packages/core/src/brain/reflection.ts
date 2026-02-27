/**
 * Reflection Engine -- Metacognitive layer for the brain system.
 *
 * Implements prediction-error-driven learning from the neuroscience team's
 * proposal (Part IV-A). The reflection system generates predictions about
 * upcoming work, detects surprises when outcomes diverge from expectations,
 * identifies patterns across recent memories, and decides when reflection
 * is worthwhile based on brain state signals.
 *
 * All functions are pure -- no side effects, no file I/O.
 * Callers (MCP server, session hooks) persist results via MemoryStore.
 */

import type { Memory, BrainState, MemorySeverity } from '../types.js';
import type { ScoredMemory } from './types.js';
import { computeFingerprint } from './quality-gate.js';
import { STOP_WORDS } from './stop-words.js';

// ── Reflection Subtypes ─────────────────────────────────────────

export type ReflectionKind =
  | 'prediction'
  | 'surprise'
  | 'meta-observation'
  | 'consolidation';

export interface ReflectionContent {
  kind: ReflectionKind;
  summary: string;
  detail: string;
  confidence: number; // 0-1: how confident we are in this reflection
  linkedMemoryIds: string[];
}

export interface PredictionContent extends ReflectionContent {
  kind: 'prediction';
  predictedOutcome: 'success' | 'partial' | 'failure';
  basis: string; // why we predicted this
}

export interface SurpriseContent extends ReflectionContent {
  kind: 'surprise';
  predictionId: string;
  surpriseScore: number; // 0-1: how unexpected the outcome was
  predictedOutcome: 'success' | 'partial' | 'failure';
  actualOutcome: 'success' | 'partial' | 'failure';
  lesson: string;
}

export interface MetaObservationContent extends ReflectionContent {
  kind: 'meta-observation';
  patternType: 'recurring-failure' | 'contradiction' | 'knowledge-gap' | 'strength' | 'drift';
  affectedTags: string[];
}

export interface ConsolidationContent extends ReflectionContent {
  kind: 'consolidation';
  sourceMemoryIds: string[];
  mergedTags: string[];
  abstractedRule: string;
}

// ── Reflection Thresholds ───────────────────────────────────────

export interface ReflectionConfig {
  /** Messages between automatic reflection checks */
  reflectionInterval: number;
  /** Minimum significant events to trigger reflection */
  minSignificantEvents: number;
  /** Minimum memories needed for meta-observation */
  minMemoriesForMeta: number;
  /** Tag overlap threshold to detect patterns */
  tagOverlapThreshold: number;
  /** Minimum surprise score to store a surprise reflection */
  minSurpriseScore: number;
  /** Maximum age in days for memories to count as "recent" */
  recentWindowDays: number;
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  reflectionInterval: 8,
  minSignificantEvents: 3,
  minMemoriesForMeta: 5,
  tagOverlapThreshold: 2,
  minSurpriseScore: 0.3,
  recentWindowDays: 7,
};

// ── Outcome value map for distance calculation ──────────────────

const OUTCOME_VALUE: Record<string, number> = {
  success: 1.0,
  partial: 0.5,
  failure: 0.0,
};

// ── Quality score for reflections ───────────────────────────────

/**
 * Compute quality score for a reflection memory.
 * Factors: confidence, number of linked memories, content length,
 * and whether it contains an actionable rule.
 */
function computeQualityScore(content: ReflectionContent): number {
  let score = 0;

  // Confidence contributes 0-0.35
  score += content.confidence * 0.35;

  // Linked memories: more evidence = higher quality (0-0.25)
  const linkCount = content.linkedMemoryIds.length;
  score += Math.min(0.25, linkCount * 0.05);

  // Actionability: has a concrete rule (0-0.2)
  if (content.kind === 'surprise') {
    score += (content as SurpriseContent).lesson.length > 0 ? 0.2 : 0.05;
  } else if (content.kind === 'consolidation') {
    score += (content as ConsolidationContent).abstractedRule.length > 0 ? 0.2 : 0.05;
  } else {
    score += content.summary.length > 20 ? 0.15 : 0.05;
  }

  // Summary quality: not too short, not too long (0-0.2)
  const summaryLength = content.summary.length;
  if (summaryLength >= 20 && summaryLength <= 200) score += 0.2;
  else if (summaryLength >= 10) score += 0.1;

  return Math.max(0, Math.min(1, score));
}

// ── Severity inference for reflections ──────────────────────────

function reflectionSeverity(content: ReflectionContent): MemorySeverity {
  if (content.kind === 'surprise') {
    const s = content as SurpriseContent;
    if (s.surpriseScore >= 0.7) return 'high';
    if (s.surpriseScore >= 0.4) return 'medium';
    return 'low';
  }
  if (content.kind === 'meta-observation') {
    const m = content as MetaObservationContent;
    if (m.patternType === 'recurring-failure' || m.patternType === 'contradiction') return 'high';
    if (m.patternType === 'knowledge-gap') return 'medium';
    return 'low';
  }
  if (content.confidence >= 0.8) return 'medium';
  return 'low';
}

// ── Core Functions ──────────────────────────────────────────────

/**
 * Create a reflection Memory object from structured reflection content.
 * Returns a Memory-shaped object ready to pass to MemoryStore.storeMemory().
 *
 * The caller is responsible for assigning `id`, `projectId`, and `createdAt`
 * (typically done by MemoryStore). This function builds the content fields.
 */
export function createReflection(
  content: ReflectionContent,
): Omit<Memory, 'id' | 'projectId' | 'createdAt'> {
  const tags = buildReflectionTags(content);
  const quality = computeQualityScore(content);
  const severity = reflectionSeverity(content);
  const title = `[${content.kind}] ${content.summary}`;
  const fp = computeFingerprint({ title, content: content.detail });

  // Build the rule string from the reflection
  let rule = '';
  if (content.kind === 'surprise') {
    rule = (content as SurpriseContent).lesson;
  } else if (content.kind === 'meta-observation') {
    rule = content.summary;
  } else if (content.kind === 'consolidation') {
    rule = (content as ConsolidationContent).abstractedRule;
  } else if (content.kind === 'prediction') {
    rule = (content as PredictionContent).basis;
  }

  // Build links array from linkedMemoryIds
  const links = content.linkedMemoryIds.map(targetId => ({
    targetId,
    relationship: 'related' as const,
    createdAt: new Date().toISOString(),
  }));

  return {
    type: 'reflection',
    title,
    content: content.detail,
    rule,
    tags,
    severity,
    synapticStrength: 1.0,
    accessCount: 0,
    links,
    qualityScore: quality,
    fingerprint: fp,
    surfacedMemoryIds: content.linkedMemoryIds,
    outcome: content.kind === 'prediction'
      ? (content as PredictionContent).predictedOutcome
      : content.kind === 'surprise'
        ? (content as SurpriseContent).actualOutcome
        : undefined,
  };
}

/**
 * Build tags for a reflection memory based on its kind and content.
 */
function buildReflectionTags(content: ReflectionContent): string[] {
  const tags = new Set<string>(['reflection', content.kind]);

  if (content.kind === 'meta-observation') {
    const meta = content as MetaObservationContent;
    tags.add(meta.patternType);
    for (const tag of meta.affectedTags) tags.add(tag);
  }

  if (content.kind === 'consolidation') {
    const consolidation = content as ConsolidationContent;
    for (const tag of consolidation.mergedTags) tags.add(tag);
  }

  // Extract significant words from summary for tag enrichment
  const words = content.summary
    .toLowerCase()
    .match(/\b[\w][\w.-]*\b/g) ?? [];
  for (const word of words) {
    if (word.length > 4 && !STOP_WORDS.has(word)) {
      tags.add(word);
    }
  }

  return [...tags].slice(0, 12);
}

/**
 * Generate a prediction about the likely outcome of upcoming work.
 *
 * Analyzes the current context (active task description, workflow phase)
 * against retrieved memories to predict success, partial success, or failure.
 *
 * The prediction is stored as a reflection memory. When the task completes,
 * detectSurprise() compares the prediction to the actual outcome to drive
 * prediction-error learning.
 */
export function generatePrediction(
  context: {
    taskTitle: string;
    taskDescription: string;
    workflowPhase: string;
    recentActivity: string;
  },
  memories: ScoredMemory[],
): PredictionContent {
  // Analyze memory signals
  const painCount = memories.filter(m => m.memory.type === 'pain').length;
  const winCount = memories.filter(m => m.memory.type === 'win').length;
  const totalRelevant = memories.length;

  // Extract domain tags from the task
  const taskText = `${context.taskTitle} ${context.taskDescription}`.toLowerCase();
  const domainTags = new Set<string>();
  for (const sm of memories) {
    for (const tag of sm.matchedTags) domainTags.add(tag);
  }

  // Compute a risk signal from pain memories
  let riskSignal = 0;
  for (const sm of memories) {
    if (sm.memory.type === 'pain') {
      const severityWeight = sm.memory.severity === 'high' ? 1.0
        : sm.memory.severity === 'medium' ? 0.6
          : 0.3;
      riskSignal += sm.score * severityWeight;
    }
  }
  // Normalize risk to 0-1 range
  const normalizedRisk = totalRelevant > 0
    ? Math.min(1, riskSignal / Math.max(1, totalRelevant))
    : 0;

  // Compute a confidence signal from win memories
  let confidenceSignal = 0;
  for (const sm of memories) {
    if (sm.memory.type === 'win') {
      confidenceSignal += sm.score * 0.5;
    }
  }
  const normalizedConfidence = totalRelevant > 0
    ? Math.min(1, confidenceSignal / Math.max(1, totalRelevant))
    : 0.5; // neutral if no data

  // Determine predicted outcome
  let predictedOutcome: 'success' | 'partial' | 'failure';
  let confidence: number;

  if (normalizedRisk > 0.6 && painCount > winCount * 2) {
    // High risk domain with many more pains than wins
    predictedOutcome = 'failure';
    confidence = Math.min(0.9, 0.4 + normalizedRisk * 0.4);
  } else if (normalizedRisk > 0.3 || painCount >= winCount) {
    // Moderate risk or balanced pain/win ratio
    predictedOutcome = 'partial';
    confidence = 0.3 + Math.abs(normalizedRisk - normalizedConfidence) * 0.3;
  } else {
    // Low risk, wins dominate
    predictedOutcome = 'success';
    confidence = Math.min(0.9, 0.4 + normalizedConfidence * 0.4);
  }

  // If we have no relevant memories at all, low confidence prediction
  if (totalRelevant === 0) {
    predictedOutcome = 'partial';
    confidence = 0.2;
  }

  // Build the basis explanation
  const basisParts: string[] = [];
  if (painCount > 0) {
    const topPain = memories
      .filter(m => m.memory.type === 'pain')
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const p of topPain) {
      basisParts.push(`Pain: "${p.memory.title}" (score ${p.score.toFixed(2)})`);
    }
  }
  if (winCount > 0) {
    const topWin = memories
      .filter(m => m.memory.type === 'win')
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const w of topWin) {
      basisParts.push(`Win: "${w.memory.title}" (score ${w.score.toFixed(2)})`);
    }
  }
  if (totalRelevant === 0) {
    basisParts.push('No relevant memories found -- prediction based on neutral prior');
  }

  const basis = basisParts.join('; ');

  // Collect linked memory IDs from the memories that influenced the prediction
  const linkedMemoryIds = memories
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(m => m.memory.id);

  return {
    kind: 'prediction',
    summary: `Predicting ${predictedOutcome} for: ${context.taskTitle}`,
    detail: [
      `Task: ${context.taskTitle}`,
      `Phase: ${context.workflowPhase}`,
      `Relevant memories: ${totalRelevant} (${painCount} pain, ${winCount} win)`,
      `Risk signal: ${normalizedRisk.toFixed(2)}, Confidence signal: ${normalizedConfidence.toFixed(2)}`,
      basis,
    ].join('\n'),
    confidence,
    linkedMemoryIds,
    predictedOutcome,
    basis,
  };
}

/**
 * Compare a prediction against the actual outcome.
 * Returns a surprise score (0-1) and a SurpriseContent reflection.
 *
 * The surprise score drives prediction-error learning:
 * - High surprise (>0.7): strong encoding -- this is novel information
 * - Medium surprise (0.3-0.7): moderate encoding -- worth noting
 * - Low surprise (<0.3): expected outcome -- minimal encoding value
 *
 * This implements the neuroscience team's prediction-error-driven storage
 * proposal: store surprises, not confirmations.
 */
export function detectSurprise(
  prediction: PredictionContent,
  actualOutcome: 'success' | 'partial' | 'failure',
): SurpriseContent {
  const predictedValue = OUTCOME_VALUE[prediction.predictedOutcome] ?? 0.5;
  const actualValue = OUTCOME_VALUE[actualOutcome] ?? 0.5;

  // Surprise score: absolute distance between predicted and actual outcome
  const rawSurprise = Math.abs(predictedValue - actualValue);

  // Scale by prediction confidence: high-confidence wrong predictions are more surprising
  const confidenceMultiplier = 0.5 + prediction.confidence * 0.5;
  const surpriseScore = Math.min(1, rawSurprise * confidenceMultiplier);

  // Determine direction: was it better or worse than expected?
  const direction = actualValue > predictedValue ? 'better' : actualValue < predictedValue ? 'worse' : 'as expected';

  // Build the lesson
  let lesson: string;
  if (surpriseScore < 0.3) {
    lesson = `Outcome matched prediction (${prediction.predictedOutcome} -> ${actualOutcome}). No correction needed.`;
  } else if (direction === 'better') {
    lesson = `Outcome was better than predicted (${prediction.predictedOutcome} -> ${actualOutcome}). ` +
      `The risk factors identified may be less severe than thought, or the approach found a way around them.`;
  } else {
    lesson = `Outcome was worse than predicted (${prediction.predictedOutcome} -> ${actualOutcome}). ` +
      `The confidence signals were misleading. Review pain memories for this domain for missed risks.`;
  }

  return {
    kind: 'surprise',
    summary: `${direction === 'as expected' ? 'Expected' : `Surprise (${direction})`}: predicted ${prediction.predictedOutcome}, got ${actualOutcome}`,
    detail: [
      `Prediction: ${prediction.predictedOutcome} (confidence: ${prediction.confidence.toFixed(2)})`,
      `Actual: ${actualOutcome}`,
      `Surprise score: ${surpriseScore.toFixed(2)}`,
      `Direction: ${direction}`,
      `Original basis: ${prediction.basis}`,
    ].join('\n'),
    confidence: Math.min(0.95, 0.5 + surpriseScore * 0.4),
    linkedMemoryIds: [...prediction.linkedMemoryIds],
    predictionId: '', // Caller sets this to the prediction memory's ID
    surpriseScore,
    predictedOutcome: prediction.predictedOutcome,
    actualOutcome,
    lesson,
  };
}

/**
 * Analyze recent memories to detect meta-level patterns.
 *
 * Looks for:
 * - Recurring failures: same tags appearing in multiple pain memories
 * - Contradictions: pain + win memories with overlapping tags (conflicting signals)
 * - Knowledge gaps: tags with pain memories but no win memories (unresolved domains)
 * - Strengths: tags with wins but no pains (reliable domains)
 * - Drift: tags whose pain/win ratio shifted significantly in recent memories
 *
 * Returns an array of MetaObservationContent reflections.
 */
export function generateMetaObservations(
  recentMemories: Memory[],
  config: ReflectionConfig = DEFAULT_REFLECTION_CONFIG,
): MetaObservationContent[] {
  if (recentMemories.length < config.minMemoriesForMeta) return [];
  const nonReflections = recentMemories.filter(m => m.type !== 'reflection');

  const observations: MetaObservationContent[] = [];

  // Build tag frequency maps by memory type
  const painTagCounts = new Map<string, number>();
  const winTagCounts = new Map<string, number>();
  const painByTag = new Map<string, Memory[]>();
  const winByTag = new Map<string, Memory[]>();

  for (const mem of nonReflections) {
    if (mem.type === 'pain' || mem.type === 'fact') {
      for (const tag of mem.tags) {
        painTagCounts.set(tag, (painTagCounts.get(tag) ?? 0) + 1);
        if (!painByTag.has(tag)) painByTag.set(tag, []);
        painByTag.get(tag)!.push(mem);
      }
    }
    if (mem.type === 'win') {
      for (const tag of mem.tags) {
        winTagCounts.set(tag, (winTagCounts.get(tag) ?? 0) + 1);
        if (!winByTag.has(tag)) winByTag.set(tag, []);
        winByTag.get(tag)!.push(mem);
      }
    }
  }

  // Detect recurring failures: tag appears in 3+ pain memories
  for (const [tag, count] of painTagCounts) {
    if (count >= 3) {
      const painMems = painByTag.get(tag) ?? [];
      const linkedIds = painMems.slice(0, 6).map(m => m.id);
      const titles = painMems.slice(0, 3).map(m => m.title);

      observations.push({
        kind: 'meta-observation',
        summary: `Recurring failure pattern in "${tag}" domain (${count} pain memories)`,
        detail: [
          `Tag "${tag}" appears in ${count} pain memories recently.`,
          `Examples: ${titles.join('; ')}`,
          `This suggests a systemic issue rather than isolated incidents.`,
          `Consider: is there a root cause that has not been addressed?`,
        ].join('\n'),
        confidence: Math.min(0.9, 0.5 + count * 0.1),
        linkedMemoryIds: linkedIds,
        patternType: 'recurring-failure',
        affectedTags: [tag],
      });
    }
  }

  // Detect contradictions: same tag has both pain and win memories
  for (const [tag, painCount] of painTagCounts) {
    const winCount = winTagCounts.get(tag) ?? 0;
    if (painCount >= 2 && winCount >= 2) {
      const painMems = painByTag.get(tag) ?? [];
      const winMems = winByTag.get(tag) ?? [];
      const linkedIds = [
        ...painMems.slice(0, 3).map(m => m.id),
        ...winMems.slice(0, 3).map(m => m.id),
      ];

      observations.push({
        kind: 'meta-observation',
        summary: `Contradictory signals in "${tag}" domain (${painCount} pain, ${winCount} win)`,
        detail: [
          `Tag "${tag}" has both pain (${painCount}) and win (${winCount}) memories.`,
          `This could indicate: context-dependent success/failure, evolving understanding,`,
          `or conflicting approaches that have not been reconciled.`,
          `Pain examples: ${painMems.slice(0, 2).map(m => m.title).join('; ')}`,
          `Win examples: ${winMems.slice(0, 2).map(m => m.title).join('; ')}`,
        ].join('\n'),
        confidence: 0.6,
        linkedMemoryIds: linkedIds,
        patternType: 'contradiction',
        affectedTags: [tag],
      });
    }
  }

  // Detect knowledge gaps: tags with pains but zero wins
  for (const [tag, painCount] of painTagCounts) {
    if (painCount >= 2 && !winTagCounts.has(tag)) {
      const painMems = painByTag.get(tag) ?? [];
      const linkedIds = painMems.slice(0, 4).map(m => m.id);

      observations.push({
        kind: 'meta-observation',
        summary: `Knowledge gap: "${tag}" has ${painCount} pains but no wins`,
        detail: [
          `Tag "${tag}" has accumulated ${painCount} pain memories with zero corresponding wins.`,
          `This domain has caused problems but no successful resolution pattern exists yet.`,
          `This is a priority area for developing expertise or avoiding the domain entirely.`,
        ].join('\n'),
        confidence: 0.7,
        linkedMemoryIds: linkedIds,
        patternType: 'knowledge-gap',
        affectedTags: [tag],
      });
    }
  }

  // Detect strengths: tags with wins but zero pains
  for (const [tag, winCount] of winTagCounts) {
    if (winCount >= 3 && !painTagCounts.has(tag)) {
      const winMems = winByTag.get(tag) ?? [];
      const linkedIds = winMems.slice(0, 4).map(m => m.id);

      observations.push({
        kind: 'meta-observation',
        summary: `Strength identified: "${tag}" domain (${winCount} wins, 0 pains)`,
        detail: [
          `Tag "${tag}" has ${winCount} win memories with no corresponding pains.`,
          `This is a reliable domain. Approaches used here can be trusted and potentially`,
          `applied as patterns for less reliable domains.`,
        ].join('\n'),
        confidence: Math.min(0.9, 0.5 + winCount * 0.1),
        linkedMemoryIds: linkedIds,
        patternType: 'strength',
        affectedTags: [tag],
      });
    }
  }

  // Sort by confidence descending, take top observations
  observations.sort((a, b) => b.confidence - a.confidence);

  // Cap at 5 observations per reflection cycle to avoid noise
  return observations.slice(0, 5);
}

/**
 * Determine whether the brain should generate reflections right now.
 *
 * Reflection is triggered by a combination of:
 * - Message count (periodic, every N messages)
 * - Significant events since last checkpoint (task completions, failures, decisions)
 * - Time since last reflection (avoid over-reflecting)
 * - Context phase (more reflection in mid-session, less in early/late)
 *
 * Returns an object describing whether to reflect and why.
 */
export function shouldReflect(
  brainState: BrainState,
  config: ReflectionConfig = DEFAULT_REFLECTION_CONFIG,
): { reflect: boolean; reason: string } {
  const messageCount = brainState.messageCount;
  const significantEvents = brainState.significantEventsSinceCheckpoint;

  // Never reflect in the first few messages (not enough context)
  if (messageCount < 4) {
    return { reflect: false, reason: 'Too early in session (< 4 messages)' };
  }

  // Periodic interval check
  const isIntervalHit = messageCount > 0 && messageCount % config.reflectionInterval === 0;

  // Significant events threshold
  const hasEnoughEvents = significantEvents >= config.minSignificantEvents;

  // Phase-aware reflection frequency
  // Mid-session: most reflective (synthesizing accumulated context)
  // Early: occasional (building context)
  // Late: less frequent (conserving context window)
  const phaseMultiplier = brainState.contextPhase === 'mid' ? 1.0
    : brainState.contextPhase === 'early' ? 0.5
      : 0.3;

  // Active trace count as a signal of brain activity
  const highActivity = brainState.activeTraces.length >= 4;

  // Decision matrix
  if (isIntervalHit && hasEnoughEvents) {
    return {
      reflect: true,
      reason: `Interval hit (msg ${messageCount}) with ${significantEvents} significant events`,
    };
  }

  if (hasEnoughEvents && highActivity && phaseMultiplier >= 0.5) {
    return {
      reflect: true,
      reason: `${significantEvents} significant events + high activity (${brainState.activeTraces.length} traces) in ${brainState.contextPhase} phase`,
    };
  }

  // Emergency reflection: very high event count regardless of interval
  if (significantEvents >= config.minSignificantEvents * 2) {
    return {
      reflect: true,
      reason: `High event count (${significantEvents}) warrants reflection regardless of interval`,
    };
  }

  // Standard interval with phase gating
  if (isIntervalHit && phaseMultiplier >= 0.5) {
    return {
      reflect: true,
      reason: `Interval hit (msg ${messageCount}) in ${brainState.contextPhase} phase`,
    };
  }

  return {
    reflect: false,
    reason: `No trigger: msg ${messageCount}, events ${significantEvents}, phase ${brainState.contextPhase}`,
  };
}

/**
 * Generate a consolidation note from a cluster of related memories.
 *
 * This is the "sleep consolidation" analog: take N specific memories
 * about overlapping topics and produce one abstracted reflection that
 * captures the gist. The source memories can then be marked as
 * consolidated (via links with 'supersedes' relationship).
 *
 * The caller is responsible for determining which memories form a cluster
 * (typically via tag overlap >= 2, minimum cluster size 3).
 */
export function generateConsolidation(
  cluster: Memory[],
): ConsolidationContent | null {
  if (cluster.length < 2) return null;

  // Collect all tags across the cluster
  const tagCounts = new Map<string, number>();
  for (const mem of cluster) {
    for (const tag of mem.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  // Common tags: appear in at least half the cluster
  const threshold = Math.ceil(cluster.length / 2);
  const commonTags = [...tagCounts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([tag]) => tag);

  if (commonTags.length === 0) return null;

  // Extract the most common rule patterns
  const rules = cluster
    .map(m => m.rule)
    .filter(r => r.length > 0);

  // Find the longest shared rule as the base for abstraction
  // (longest rule is usually the most specific/useful)
  const abstractedRule = rules.length > 0
    ? abstractRules(rules)
    : `Pattern across ${cluster.length} memories in [${commonTags.slice(0, 3).join(', ')}] domain`;

  // Determine the dominant outcome if memories have outcome fields
  const outcomes = cluster
    .map(m => m.outcome)
    .filter((o): o is 'success' | 'partial' | 'failure' => o !== undefined);
  const outcomeSummary = outcomes.length > 0
    ? summarizeOutcomes(outcomes)
    : '';

  const sourceIds = cluster.map(m => m.id);
  const titles = cluster.map(m => m.title);

  return {
    kind: 'consolidation',
    summary: `Consolidated insight: ${commonTags.slice(0, 3).join(', ')} domain (${cluster.length} sources)`,
    detail: [
      `Consolidated from ${cluster.length} memories:`,
      ...titles.map(t => `  - ${t}`),
      '',
      `Common tags: ${commonTags.join(', ')}`,
      outcomeSummary ? `Outcomes: ${outcomeSummary}` : '',
      `Abstracted rule: ${abstractedRule}`,
    ].filter(line => line.length > 0).join('\n'),
    confidence: Math.min(0.9, 0.4 + cluster.length * 0.1),
    linkedMemoryIds: sourceIds,
    sourceMemoryIds: sourceIds,
    mergedTags: commonTags,
    abstractedRule,
  };
}

// ── Internal Helpers ────────────────────────────────────────────

/**
 * Abstract multiple rule strings into a single generalized rule.
 * Takes the most informative rule and appends any unique insights from others.
 */
function abstractRules(rules: string[]): string {
  if (rules.length === 0) return '';
  if (rules.length === 1) return rules[0];

  // Sort by length descending (longer rules tend to be more detailed)
  const sorted = [...rules].sort((a, b) => b.length - a.length);
  const primary = sorted[0];

  // Extract unique phrases from other rules that are not substrings of the primary
  const primaryLower = primary.toLowerCase();
  const supplements: string[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const rule = sorted[i];
    if (rule.length < 10) continue; // Skip trivially short rules

    // Check if this rule adds information not in the primary
    const ruleLower = rule.toLowerCase();
    const words = ruleLower.split(/\s+/).filter(w => w.length > 4);
    const novelWords = words.filter(w => !primaryLower.includes(w));

    if (novelWords.length >= 2) {
      supplements.push(rule);
    }
  }

  if (supplements.length === 0) return primary;

  // Take at most 2 supplements to keep the rule concise
  const supplementText = supplements
    .slice(0, 2)
    .map(s => s.length > 150 ? s.slice(0, 147) + '...' : s)
    .join(' Additionally: ');

  return `${primary} Additionally: ${supplementText}`;
}

/**
 * Summarize an array of outcomes into a human-readable string.
 */
function summarizeOutcomes(outcomes: Array<'success' | 'partial' | 'failure'>): string {
  const counts = { success: 0, partial: 0, failure: 0 };
  for (const o of outcomes) counts[o]++;

  const parts: string[] = [];
  if (counts.success > 0) parts.push(`${counts.success} success`);
  if (counts.partial > 0) parts.push(`${counts.partial} partial`);
  if (counts.failure > 0) parts.push(`${counts.failure} failure`);
  return parts.join(', ');
}

/**
 * Find clusters of memories that share at least `minOverlap` tags.
 * Uses a simple greedy clustering approach.
 */
export function clusterByTagOverlap(
  memories: Memory[],
  minOverlap: number = 2,
  minClusterSize: number = 3,
): Memory[][] {
  const clusters: Memory[][] = [];
  const assigned = new Set<string>();

  // Sort by tag count descending (richly-tagged memories are better cluster seeds)
  const sorted = [...memories].sort((a, b) => b.tags.length - a.tags.length);

  for (const seed of sorted) {
    if (assigned.has(seed.id)) continue;

    const cluster: Memory[] = [seed];
    const seedTags = new Set(seed.tags);

    for (const candidate of sorted) {
      if (candidate.id === seed.id || assigned.has(candidate.id)) continue;

      const overlap = candidate.tags.filter(t => seedTags.has(t)).length;
      if (overlap >= minOverlap) {
        cluster.push(candidate);
        // Expand the seed tag set with the new member's tags
        for (const tag of candidate.tags) seedTags.add(tag);
      }
    }

    if (cluster.length >= minClusterSize) {
      for (const mem of cluster) assigned.add(mem.id);
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Filter memories to only those within a recent time window.
 */
export function filterRecentMemories(
  memories: Memory[],
  windowDays: number = 7,
  now: number = Date.now(),
): Memory[] {
  const cutoff = now - windowDays * 86_400_000;
  return memories.filter(m => new Date(m.createdAt).getTime() >= cutoff);
}

/**
 * Check if a new reflection would be a duplicate of an existing one.
 * Uses fingerprint comparison.
 */
export function isDuplicateReflection(
  newContent: ReflectionContent,
  existingReflections: Memory[],
): boolean {
  const title = `[${newContent.kind}] ${newContent.summary}`;
  const newFp = computeFingerprint({ title, content: newContent.detail });
  return existingReflections.some(m => m.fingerprint === newFp);
}
