/**
 * Learned Rules tests.
 *
 * Tests the rule extraction and learning system:
 * - extractRuleCandidates: finds pain/win patterns and contradiction resolutions
 * - learnRules: creates new rules, reinforces existing ones
 * - getClaudeMdCandidates: filters promotable rules, formats for CLAUDE.md
 */

import { describe, it, expect } from 'vitest';
import type { Memory } from '../../types.js';
import {
  extractRuleCandidates,
  learnRules,
  getClaudeMdCandidates,
  type LearnedRule,
  type RuleCandidate,
} from '../rules.js';

// ── Test Helpers ────────────────────────────────────────────────

function makeMemory(
  overrides: Partial<Memory> & { id: string; type: Memory['type']; title: string },
): Memory {
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

function makeLearnedRule(overrides: Partial<LearnedRule> & { id: string }): LearnedRule {
  return {
    rule: 'Always run tests before merging',
    tags: ['testing', 'git'],
    sourceMemoryIds: [],
    confidence: 0.6,
    observationCount: 1,
    type: 'pain-pattern',
    promotedToClaudeMd: false,
    createdAt: new Date().toISOString(),
    lastReinforced: new Date().toISOString(),
    ...overrides,
  };
}

// ── extractRuleCandidates ──────────────────────────────────────

describe('extractRuleCandidates', () => {
  it('finds pain patterns from grouped memories', () => {
    // 3 pain memories with overlapping tags ['git', 'deployment']
    const memories: Memory[] = [
      makeMemory({
        id: 'p1',
        type: 'pain',
        title: 'Force push destroyed production',
        rule: 'Never use git push --force on main branch without verification',
        tags: ['git', 'deployment', 'production'],
      }),
      makeMemory({
        id: 'p2',
        type: 'pain',
        title: 'Deployed broken build',
        rule: 'Always run the full test suite before deploying to production',
        tags: ['git', 'deployment', 'testing'],
      }),
      makeMemory({
        id: 'p3',
        type: 'pain',
        title: 'Merge conflict in deploy pipeline',
        rule: 'Always pull latest main before starting a deployment branch',
        tags: ['git', 'deployment', 'ci-cd'],
      }),
    ];

    const candidates = extractRuleCandidates(memories, 3, 2);

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const painCandidate = candidates.find(c => c.type === 'pain-pattern');
    expect(painCandidate).toBeDefined();
    expect(painCandidate!.tags).toEqual(expect.arrayContaining(['git', 'deployment']));
    expect(painCandidate!.sourceMemoryIds).toHaveLength(3);
    expect(painCandidate!.confidence).toBeGreaterThan(0);
  });

  it('finds win patterns from grouped memories', () => {
    const memories: Memory[] = [
      makeMemory({
        id: 'w1',
        type: 'win',
        title: 'Automated testing saved a release',
        rule: 'Always maintain comprehensive test coverage for critical paths',
        tags: ['testing', 'ci-cd', 'automation'],
      }),
      makeMemory({
        id: 'w2',
        type: 'win',
        title: 'CI caught regression before merge',
        rule: 'Ensure CI runs on every pull request before merge',
        tags: ['testing', 'ci-cd', 'github'],
      }),
      makeMemory({
        id: 'w3',
        type: 'win',
        title: 'Snapshot tests caught UI breakage',
        rule: 'Use snapshot testing for component rendering verification',
        tags: ['testing', 'ci-cd', 'react'],
      }),
    ];

    const candidates = extractRuleCandidates(memories, 3, 2);

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const winCandidate = candidates.find(c => c.type === 'win-pattern');
    expect(winCandidate).toBeDefined();
    expect(winCandidate!.tags).toEqual(expect.arrayContaining(['testing', 'ci-cd']));
    expect(winCandidate!.sourceMemoryIds).toHaveLength(3);
  });

  it('finds contradiction resolutions when pain and win share tags', () => {
    const memories: Memory[] = [
      // Pain: crashed doing deploys manually
      makeMemory({
        id: 'pain1',
        type: 'pain',
        title: 'Manual deploy broke production',
        rule: 'Never deploy manually without a checklist',
        tags: ['deployment', 'production', 'manual'],
      }),
      // Win: automated deploys fixed it
      makeMemory({
        id: 'win1',
        type: 'win',
        title: 'Automated deploy pipeline eliminated outages',
        rule: 'Always use automated CI/CD pipelines instead of manual deploys',
        tags: ['deployment', 'production', 'automation'],
      }),
    ];

    const candidates = extractRuleCandidates(memories, 1, 2);

    const contradictionCandidate = candidates.find(c => c.type === 'contradiction-resolution');
    expect(contradictionCandidate).toBeDefined();
    expect(contradictionCandidate!.tags).toEqual(
      expect.arrayContaining(['deployment', 'production']),
    );
    // Should prefer the win rule (solution) over the pain rule
    expect(contradictionCandidate!.rule).toContain('automated');
    expect(contradictionCandidate!.sourceMemoryIds).toContain('pain1');
    expect(contradictionCandidate!.sourceMemoryIds).toContain('win1');
  });

  it('requires minimum group size for pain/win patterns', () => {
    // Only 2 pain memories, but minGroupSize is 3 (default)
    const memories: Memory[] = [
      makeMemory({
        id: 'p1',
        type: 'pain',
        title: 'Forgot to update docs',
        rule: 'Always update documentation when changing APIs',
        tags: ['documentation', 'api'],
      }),
      makeMemory({
        id: 'p2',
        type: 'pain',
        title: 'API docs out of date',
        rule: 'Keep API docs in sync with implementation',
        tags: ['documentation', 'api'],
      }),
    ];

    const candidates = extractRuleCandidates(memories, 3, 2);

    // No pain-pattern or win-pattern candidates since group size < 3
    const patterns = candidates.filter(
      c => c.type === 'pain-pattern' || c.type === 'win-pattern',
    );
    expect(patterns).toHaveLength(0);
  });

  it('skips memories without rules (rule.length <= 10)', () => {
    const memories: Memory[] = [
      makeMemory({
        id: 'p1',
        type: 'pain',
        title: 'Something broke',
        rule: '', // empty rule
        tags: ['git', 'deployment'],
      }),
      makeMemory({
        id: 'p2',
        type: 'pain',
        title: 'Another break',
        rule: 'short', // too short (<=10 chars)
        tags: ['git', 'deployment'],
      }),
      makeMemory({
        id: 'p3',
        type: 'pain',
        title: 'Third break',
        rule: 'also short', // exactly 10 chars, still <=10
        tags: ['git', 'deployment'],
      }),
    ];

    const candidates = extractRuleCandidates(memories, 1, 2);

    // All rules are <= 10 chars, so they should be filtered out
    const patterns = candidates.filter(c => c.type === 'pain-pattern');
    expect(patterns).toHaveLength(0);
  });

  it('returns candidates sorted by confidence descending', () => {
    // Create two groups of different sizes to get different confidence levels
    const memories: Memory[] = [
      // Group 1: 4 pain memories (higher confidence)
      makeMemory({
        id: 'a1',
        type: 'pain',
        title: 'Git issue 1',
        rule: 'Always verify branch before force pushing to remote',
        tags: ['git', 'branching', 'remote'],
      }),
      makeMemory({
        id: 'a2',
        type: 'pain',
        title: 'Git issue 2',
        rule: 'Never push directly to main without code review approval',
        tags: ['git', 'branching', 'review'],
      }),
      makeMemory({
        id: 'a3',
        type: 'pain',
        title: 'Git issue 3',
        rule: 'Always create feature branches for isolated development work',
        tags: ['git', 'branching', 'workflow'],
      }),
      makeMemory({
        id: 'a4',
        type: 'pain',
        title: 'Git issue 4',
        rule: 'Use branch protection rules to prevent accidental pushes',
        tags: ['git', 'branching', 'protection'],
      }),
      // Group 2: 3 win memories (lower confidence due to smaller group)
      makeMemory({
        id: 'b1',
        type: 'win',
        title: 'DB optimization 1',
        rule: 'Always add indexes for frequently queried columns in queries',
        tags: ['database', 'performance', 'indexing'],
      }),
      makeMemory({
        id: 'b2',
        type: 'win',
        title: 'DB optimization 2',
        rule: 'Use connection pooling to avoid database connection exhaustion',
        tags: ['database', 'performance', 'connections'],
      }),
      makeMemory({
        id: 'b3',
        type: 'win',
        title: 'DB optimization 3',
        rule: 'Prefer batch operations over individual database queries',
        tags: ['database', 'performance', 'batch'],
      }),
    ];

    const candidates = extractRuleCandidates(memories, 3, 2);

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    // Sorted by confidence descending
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence);
    }
  });
});

// ── learnRules ─────────────────────────────────────────────────

describe('learnRules', () => {
  it('creates new rules from candidates with sufficient confidence', () => {
    const candidates: RuleCandidate[] = [
      {
        rule: 'Always run tests before merging pull requests to main',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m1', 'm2', 'm3'],
        confidence: 0.6,
        type: 'pain-pattern',
      },
    ];

    const { newRules, reinforced } = learnRules(candidates, []);

    expect(newRules).toHaveLength(1);
    expect(reinforced).toHaveLength(0);
    expect(newRules[0].rule).toBe('Always run tests before merging pull requests to main');
    expect(newRules[0].tags).toEqual(['testing', 'git']);
    expect(newRules[0].sourceMemoryIds).toEqual(['m1', 'm2', 'm3']);
    expect(newRules[0].confidence).toBe(0.6);
    expect(newRules[0].observationCount).toBe(1);
    expect(newRules[0].type).toBe('pain-pattern');
    expect(newRules[0].promotedToClaudeMd).toBe(false);
    expect(newRules[0].id).toMatch(/^rule_/);
  });

  it('does not create rules from candidates below 0.4 confidence', () => {
    const candidates: RuleCandidate[] = [
      {
        rule: 'Some weak pattern observed only once',
        tags: ['misc'],
        sourceMemoryIds: ['m1'],
        confidence: 0.3,
        type: 'win-pattern',
      },
    ];

    const { newRules, reinforced } = learnRules(candidates, []);

    expect(newRules).toHaveLength(0);
    expect(reinforced).toHaveLength(0);
  });

  it('reinforces existing matching rules instead of creating duplicates', () => {
    const existing: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_existing_1',
        rule: 'Always run tests before merging',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m1', 'm2'],
        confidence: 0.5,
        observationCount: 2,
        type: 'pain-pattern',
      }),
    ];

    const candidates: RuleCandidate[] = [
      {
        rule: 'Always run the full test suite before merging code to main',
        tags: ['testing', 'git', 'ci-cd'],
        sourceMemoryIds: ['m3', 'm4'],
        confidence: 0.6,
        type: 'pain-pattern',
      },
    ];

    const { newRules, reinforced } = learnRules(candidates, existing);

    expect(newRules).toHaveLength(0);
    expect(reinforced).toHaveLength(1);
    expect(reinforced[0].id).toBe('rule_existing_1');
    // Source memory IDs should be merged
    expect(reinforced[0].sourceMemoryIds).toEqual(
      expect.arrayContaining(['m1', 'm2', 'm3', 'm4']),
    );
  });

  it('increases confidence on reinforcement', () => {
    const existing: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_existing_1',
        rule: 'Always run tests before merging code changes',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m1'],
        confidence: 0.5,
        observationCount: 1,
        type: 'pain-pattern',
      }),
    ];

    const candidates: RuleCandidate[] = [
      {
        rule: 'Always run the full test suite before merging to main',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m2', 'm3'],
        confidence: 0.6,
        type: 'pain-pattern',
      },
    ];

    const { reinforced } = learnRules(candidates, existing);

    expect(reinforced).toHaveLength(1);
    expect(reinforced[0].confidence).toBe(0.6); // 0.5 + 0.1
    expect(reinforced[0].observationCount).toBe(2); // 1 + 1
  });

  it('caps confidence at 0.95 on reinforcement', () => {
    const existing: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_high',
        rule: 'Always use feature branches for isolated development work',
        tags: ['git', 'branching'],
        sourceMemoryIds: ['m1'],
        confidence: 0.92,
        observationCount: 8,
        type: 'win-pattern',
      }),
    ];

    const candidates: RuleCandidate[] = [
      {
        rule: 'Always create feature branches for each development task',
        tags: ['git', 'branching'],
        sourceMemoryIds: ['m9'],
        confidence: 0.8,
        type: 'win-pattern',
      },
    ];

    const { reinforced } = learnRules(candidates, existing);

    expect(reinforced).toHaveLength(1);
    expect(reinforced[0].confidence).toBe(0.95); // capped, not 1.02
  });

  it('updates rule text when candidate has a longer rule', () => {
    const existing: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_short',
        rule: 'Always run tests before merging',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m1'],
        confidence: 0.5,
        observationCount: 1,
        type: 'pain-pattern',
      }),
    ];

    const candidates: RuleCandidate[] = [
      {
        rule: 'Always run the complete test suite including integration tests before merging any code to main',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m2'],
        confidence: 0.6,
        type: 'pain-pattern',
      },
    ];

    const { reinforced } = learnRules(candidates, existing);

    expect(reinforced).toHaveLength(1);
    expect(reinforced[0].rule).toContain('complete test suite');
  });

  it('does not match candidates to rules of a different type', () => {
    const existing: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_win',
        rule: 'Always run tests before merging code changes',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m1'],
        confidence: 0.6,
        observationCount: 2,
        type: 'win-pattern', // different type
      }),
    ];

    const candidates: RuleCandidate[] = [
      {
        rule: 'Always run the full test suite before merging to main',
        tags: ['testing', 'git'],
        sourceMemoryIds: ['m2'],
        confidence: 0.5,
        type: 'pain-pattern', // pain, not win
      },
    ];

    const { newRules, reinforced } = learnRules(candidates, existing);

    // Should create a new rule, not reinforce the existing win-pattern
    expect(reinforced).toHaveLength(0);
    expect(newRules).toHaveLength(1);
    expect(newRules[0].type).toBe('pain-pattern');
  });
});

// ── getClaudeMdCandidates ──────────────────────────────────────

describe('getClaudeMdCandidates', () => {
  const rules: LearnedRule[] = [
    makeLearnedRule({
      id: 'rule_high',
      rule: 'Always run tests before deploying to production environments',
      tags: ['testing', 'deployment'],
      confidence: 0.9,
      observationCount: 5,
      type: 'pain-pattern',
      promotedToClaudeMd: false,
    }),
    makeLearnedRule({
      id: 'rule_low_conf',
      rule: 'Consider using TypeScript strict mode everywhere',
      tags: ['typescript', 'configuration'],
      confidence: 0.5,
      observationCount: 4,
      type: 'win-pattern',
      promotedToClaudeMd: false,
    }),
    makeLearnedRule({
      id: 'rule_low_obs',
      rule: 'Check memory limits before batch processing',
      tags: ['memory', 'performance'],
      confidence: 0.85,
      observationCount: 1,
      type: 'pain-pattern',
      promotedToClaudeMd: false,
    }),
    makeLearnedRule({
      id: 'rule_promoted',
      rule: 'Never skip approval gates for destructive operations',
      tags: ['git', 'deployment'],
      confidence: 0.95,
      observationCount: 10,
      type: 'pain-pattern',
      promotedToClaudeMd: true,
    }),
    makeLearnedRule({
      id: 'rule_contradiction',
      rule: 'Use automated pipelines instead of manual deploys for safety',
      tags: ['deployment', 'automation'],
      confidence: 0.85,
      observationCount: 4,
      type: 'contradiction-resolution',
      promotedToClaudeMd: false,
    }),
  ];

  it('filters by confidence threshold', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    // rule_low_conf has 0.5 confidence, below 0.8 threshold
    const ids = candidates.map(c => c.rule.id);
    expect(ids).not.toContain('rule_low_conf');
  });

  it('filters by observation count', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    // rule_low_obs has 1 observation, below 3 minimum
    const ids = candidates.map(c => c.rule.id);
    expect(ids).not.toContain('rule_low_obs');
  });

  it('excludes already promoted rules', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    // rule_promoted has promotedToClaudeMd: true
    const ids = candidates.map(c => c.rule.id);
    expect(ids).not.toContain('rule_promoted');
  });

  it('includes rules that meet all criteria', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    const ids = candidates.map(c => c.rule.id);
    expect(ids).toContain('rule_high');
    expect(ids).toContain('rule_contradiction');
  });

  it('formats pain-pattern rules correctly', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    const highCandidate = candidates.find(c => c.rule.id === 'rule_high');
    expect(highCandidate).toBeDefined();
    expect(highCandidate!.formattedRule).toContain('**Learned (pain):**');
    expect(highCandidate!.formattedRule).toContain(
      'Always run tests before deploying to production environments',
    );
    expect(highCandidate!.formattedRule).toContain('90%');
    expect(highCandidate!.formattedRule).toContain('5 observations');
  });

  it('formats contradiction-resolution rules correctly', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    const resCandidate = candidates.find(c => c.rule.id === 'rule_contradiction');
    expect(resCandidate).toBeDefined();
    expect(resCandidate!.formattedRule).toContain('**Learned (resolution):**');
  });

  it('formats win-pattern rules correctly', () => {
    // Use lower thresholds to include the win-pattern rule
    const candidates = getClaudeMdCandidates(rules, 0.4, 1);

    const winCandidate = candidates.find(c => c.rule.id === 'rule_low_conf');
    expect(winCandidate).toBeDefined();
    expect(winCandidate!.formattedRule).toContain('**Learned (win):**');
  });

  it('infers CLAUDE.md section from tags', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    const highCandidate = candidates.find(c => c.rule.id === 'rule_high');
    expect(highCandidate).toBeDefined();
    // 'testing' or 'deployment' tags -> 'Coding Rules'
    expect(highCandidate!.section).toBe('Coding Rules');
  });

  it('returns candidates sorted by confidence descending', () => {
    const candidates = getClaudeMdCandidates(rules, 0.8, 3);

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].rule.confidence).toBeGreaterThanOrEqual(
        candidates[i].rule.confidence,
      );
    }
  });

  it('returns empty array when no rules qualify', () => {
    const lowRules: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_weak',
        confidence: 0.3,
        observationCount: 1,
        promotedToClaudeMd: false,
      }),
    ];

    const candidates = getClaudeMdCandidates(lowRules, 0.8, 3);

    expect(candidates).toHaveLength(0);
  });

  it('section mapping covers strategy tags', () => {
    const strategyRules: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_strategy',
        tags: ['strategy', 'validation'],
        confidence: 0.9,
        observationCount: 5,
        promotedToClaudeMd: false,
      }),
    ];

    const candidates = getClaudeMdCandidates(strategyRules, 0.8, 3);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].section).toBe("Pat's Preferences");
  });

  it('section mapping covers memory/brain tags', () => {
    const brainRules: LearnedRule[] = [
      makeLearnedRule({
        id: 'rule_brain',
        tags: ['memory', 'brain'],
        confidence: 0.9,
        observationCount: 5,
        promotedToClaudeMd: false,
      }),
    ];

    const candidates = getClaudeMdCandidates(brainRules, 0.8, 3);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].section).toBe('Architecture');
  });
});
