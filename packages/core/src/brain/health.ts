/**
 * Brain Health -- observability dashboard for the memory system.
 *
 * Computes health metrics across all brain subsystems:
 * memories, cortex, rules, predictions, and retrieval performance.
 *
 * All functions are pure -- no side effects, no file I/O.
 */

import type { Memory, BrainState } from '../types.js';
import { scoreMemory, classifyHealth } from './scoring.js';
import type { MemoryHealth, MemoryScoreExtras } from './scoring.js';
import type { LearnedCortexEntry } from './cortex-learner.js';
import type { LearnedRule } from './rules.js';

// ── Types ──────────────────────────────────────────────────────────

export interface BrainHealthReport {
  timestamp: string;

  // Memory stats
  memories: {
    total: number;
    byType: Record<string, number>;
    byHealth: Record<MemoryHealth, number>;
    withLinks: number;
    withFingerprint: number;
    withQualityScore: number;
    averageQuality: number;
    averageAge: number; // days
  };

  // Cortex stats
  cortex: {
    defaultEntries: number;
    learnedEntries: number;
    promotionCandidates: number;
    totalGapsProcessed: number;
  };

  // Rules stats
  rules: {
    total: number;
    byType: Record<string, number>;
    claudeMdCandidates: number;
    averageConfidence: number;
  };

  // Brain state stats
  brainState: {
    messageCount: number;
    contextPhase: string;
    activeTraces: number;
    significantEvents: number;
    synapticActivityTags: number;
  };

  // Overall health grade
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  issues: string[];
  recommendations: string[];
}

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Generate a full brain health report.
 */
export function generateHealthReport(
  memories: Memory[],
  brainState: BrainState | null,
  learnedCortex: LearnedCortexEntry[],
  learnedRules: LearnedRule[],
  defaultCortexSize: number,
  totalGapsProcessed: number,
): BrainHealthReport {
  const now = Date.now();
  const nowIso = new Date().toISOString();

  // Memory stats
  const byType: Record<string, number> = {};
  const byHealth: Record<MemoryHealth, number> = {
    active: 0,
    aging: 0,
    stale: 0,
    harmful: 0,
    superseded: 0,
  };
  let totalQuality = 0;
  let qualityCount = 0;
  let totalAgeDays = 0;
  let withLinks = 0;
  let withFingerprint = 0;
  let withQualityScore = 0;

  for (const mem of memories) {
    byType[mem.type] = (byType[mem.type] ?? 0) + 1;

    const extras: MemoryScoreExtras = { supersededBy: mem.supersededBy };
    const score = scoreMemory({ ...mem, ...extras }, now);
    const health = classifyHealth({ ...mem, ...extras }, score);
    byHealth[health]++;

    if (mem.qualityScore !== undefined) {
      totalQuality += mem.qualityScore;
      qualityCount++;
      withQualityScore++;
    }

    totalAgeDays += (now - new Date(mem.createdAt).getTime()) / 86_400_000;

    if ((mem.links?.length ?? 0) > 0) withLinks++;
    if (mem.fingerprint) withFingerprint++;
  }

  // Rules stats
  const rulesByType: Record<string, number> = {};
  let totalRuleConfidence = 0;
  let claudeMdCandidates = 0;
  for (const rule of learnedRules) {
    rulesByType[rule.type] = (rulesByType[rule.type] ?? 0) + 1;
    totalRuleConfidence += rule.confidence;
    if (!rule.promotedToClaudeMd && rule.confidence >= 0.8 && rule.observationCount >= 3) {
      claudeMdCandidates++;
    }
  }

  // Cortex stats
  const promotionCandidates = learnedCortex.filter(
    e => !e.promoted && e.confidence >= 0.8 && e.observationCount >= 5,
  ).length;

  // Compute grade and issues
  const { grade, issues, recommendations } = computeGrade(
    memories,
    byHealth,
    qualityCount > 0 ? totalQuality / qualityCount : 0,
    learnedCortex.length,
    learnedRules.length,
    brainState,
  );

  return {
    timestamp: nowIso,
    memories: {
      total: memories.length,
      byType,
      byHealth,
      withLinks,
      withFingerprint,
      withQualityScore,
      averageQuality: qualityCount > 0 ? totalQuality / qualityCount : 0,
      averageAge: memories.length > 0 ? totalAgeDays / memories.length : 0,
    },
    cortex: {
      defaultEntries: defaultCortexSize,
      learnedEntries: learnedCortex.length,
      promotionCandidates,
      totalGapsProcessed,
    },
    rules: {
      total: learnedRules.length,
      byType: rulesByType,
      claudeMdCandidates,
      averageConfidence: learnedRules.length > 0 ? totalRuleConfidence / learnedRules.length : 0,
    },
    brainState: {
      messageCount: brainState?.messageCount ?? 0,
      contextPhase: brainState?.contextPhase ?? 'early',
      activeTraces: brainState?.activeTraces?.length ?? 0,
      significantEvents: brainState?.significantEventsSinceCheckpoint ?? 0,
      synapticActivityTags: brainState?.synapticActivity ? Object.keys(brainState.synapticActivity).length : 0,
    },
    grade,
    issues,
    recommendations,
  };
}

/**
 * Format a health report as human-readable text for MCP tool output.
 */
export function formatHealthReport(report: BrainHealthReport): string {
  const lines: string[] = [];

  lines.push(`Brain Health: ${report.grade}`);
  lines.push('');

  // Memory summary
  lines.push(`Memories: ${report.memories.total} total`);
  const typeEntries = Object.entries(report.memories.byType).map(([k, v]) => `${k}: ${v}`);
  lines.push(`  Types: ${typeEntries.join(', ')}`);
  lines.push(`  Health: active=${report.memories.byHealth.active}, aging=${report.memories.byHealth.aging}, stale=${report.memories.byHealth.stale}, superseded=${report.memories.byHealth.superseded}`);
  if (report.memories.averageQuality > 0) {
    lines.push(`  Avg quality: ${report.memories.averageQuality.toFixed(2)}, avg age: ${report.memories.averageAge.toFixed(0)}d`);
  }
  lines.push(`  Linked: ${report.memories.withLinks}, fingerprinted: ${report.memories.withFingerprint}`);

  // Cortex
  lines.push('');
  lines.push(`Cortex: ${report.cortex.defaultEntries} default + ${report.cortex.learnedEntries} learned`);
  lines.push(`  Gaps processed: ${report.cortex.totalGapsProcessed}, promotion candidates: ${report.cortex.promotionCandidates}`);

  // Rules
  lines.push('');
  lines.push(`Rules: ${report.rules.total} learned`);
  if (report.rules.total > 0) {
    const ruleTypeEntries = Object.entries(report.rules.byType).map(([k, v]) => `${k}: ${v}`);
    lines.push(`  Types: ${ruleTypeEntries.join(', ')}`);
    lines.push(`  Avg confidence: ${report.rules.averageConfidence.toFixed(2)}, CLAUDE.md candidates: ${report.rules.claudeMdCandidates}`);
  }

  // Brain state
  lines.push('');
  lines.push(`Session: msg ${report.brainState.messageCount}, phase ${report.brainState.contextPhase}`);
  lines.push(`  Active traces: ${report.brainState.activeTraces}, significant events: ${report.brainState.significantEvents}`);

  // Issues
  if (report.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of report.issues) lines.push(`  - ${issue}`);
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    for (const rec of report.recommendations) lines.push(`  - ${rec}`);
  }

  return lines.join('\n');
}

// ── Internal Helpers ───────────────────────────────────────────────

function computeGrade(
  memories: Memory[],
  byHealth: Record<MemoryHealth, number>,
  avgQuality: number,
  learnedCortexCount: number,
  learnedRulesCount: number,
  brainState: BrainState | null,
): { grade: 'A' | 'B' | 'C' | 'D' | 'F'; issues: string[]; recommendations: string[] } {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  const total = memories.length;

  // Memory health
  if (total === 0) {
    score -= 40;
    issues.push('No memories stored');
    recommendations.push('Store pain and win memories as you work');
  }

  const staleRatio = total > 0 ? (byHealth.stale + byHealth.superseded) / total : 0;
  if (staleRatio > 0.3) {
    score -= 20;
    issues.push(`${(staleRatio * 100).toFixed(0)}% of memories are stale or superseded`);
    recommendations.push('Run memory pruning to archive dead memories');
  } else if (staleRatio > 0.15) {
    score -= 10;
    issues.push(`${(staleRatio * 100).toFixed(0)}% of memories are stale or superseded`);
  }

  if (byHealth.harmful > 0) {
    score -= 15;
    issues.push(`${byHealth.harmful} harmful memories (correlated with failures)`);
    recommendations.push('Review and update harmful memories');
  }

  // Quality gate coverage
  const qualityCoverage = total > 0 ? memories.filter(m => m.qualityScore !== undefined).length / total : 0;
  if (qualityCoverage < 0.5 && total > 20) {
    score -= 10;
    issues.push(`Only ${(qualityCoverage * 100).toFixed(0)}% of memories have quality scores`);
    recommendations.push('Quality scores will auto-assign as new memories are stored through the gate');
  }

  // Link coverage
  const linkCoverage = total > 0 ? memories.filter(m => (m.links?.length ?? 0) > 0).length / total : 0;
  if (linkCoverage < 0.1 && total > 20) {
    score -= 5;
    recommendations.push('Memory linking will improve as the linker discovers relationships');
  }

  // Cortex learning
  if (learnedCortexCount === 0 && total > 50) {
    score -= 5;
    recommendations.push('Cortex learning is active -- gaps will be learned over time');
  }

  // Active brain state
  if (!brainState) {
    score -= 10;
    issues.push('No brain state found');
  }

  // Map score to grade
  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';

  return { grade, issues, recommendations };
}
