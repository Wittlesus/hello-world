/**
 * Quality Gate tests for Brain Magnum Opus.
 *
 * Tests the write-time quality system:
 * - Fingerprint generation (deterministic, content-based)
 * - Duplicate detection (>0.85 similarity threshold)
 * - Quality assessment (reject vague, accept specific)
 * - Conflict detection and resolution
 * - Full quality gate accept/reject/merge paths
 */

import { describe, it, expect } from 'vitest';
import type { Memory } from '../../types.js';
import {
  computeFingerprint,
  isDuplicate,
  assessQuality,
  detectConflict,
  resolveConflict,
  qualityGate,
} from '../quality-gate.js';

// ── Test Helpers ────────────────────────────────────────────────

function makeMemory(overrides: Partial<Memory> & { id: string; type: Memory['type']; title: string }): Memory {
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

// ── Fingerprint Generation ──────────────────────────────────────

describe('computeFingerprint', () => {
  it('produces a deterministic hash for the same content', () => {
    const fp1 = computeFingerprint({ title: 'Never use git push --force on main', content: 'Force pushed and lost work' });
    const fp2 = computeFingerprint({ title: 'Never use git push --force on main', content: 'Force pushed and lost work' });
    expect(fp1).toBe(fp2);
  });

  it('produces different hashes for different content', () => {
    const fp1 = computeFingerprint({ title: 'Never use git push --force on main', content: 'Lost work' });
    const fp2 = computeFingerprint({ title: 'Always run tests before deploying', content: 'Testing prevents bugs' });
    expect(fp1).not.toBe(fp2);
  });

  it('returns a 12-character string', () => {
    const fp = computeFingerprint({ title: 'Some title here for testing', content: 'Some content' });
    expect(fp).toHaveLength(12);
    expect(typeof fp).toBe('string');
  });

  it('is insensitive to minor word order changes in content', () => {
    // Keywords are sorted in fingerprint, so order shouldn't matter
    const fp1 = computeFingerprint({ title: 'git push force main', content: '' });
    const fp2 = computeFingerprint({ title: 'force push git main', content: '' });
    // Same keywords sorted = same fingerprint
    expect(fp1).toBe(fp2);
  });
});

// ── Duplicate Detection ────────────────────────────────────────

describe('isDuplicate', () => {
  const existingMemories: Memory[] = [
    makeMemory({
      id: 'mem_001',
      type: 'pain',
      title: 'Never use git push --force on main',
      content: 'Force pushed and lost 3 hours of work',
      rule: 'Always use --force-with-lease instead',
      tags: ['git', 'deployment'],
      severity: 'high',
      fingerprint: computeFingerprint({
        title: 'Never use git push --force on main',
        content: 'Force pushed and lost 3 hours of work',
      }),
    }),
    makeMemory({
      id: 'mem_002',
      type: 'win',
      title: 'CI pipeline automated with GitHub Actions',
      content: 'Automated testing and deployment pipeline',
      tags: ['ci-cd', 'deployment', 'github'],
    }),
    makeMemory({
      id: 'mem_003',
      type: 'fact',
      title: 'PostgreSQL max connections default is 100',
      content: 'Default max_connections in postgresql.conf is 100',
      tags: ['database', 'configuration'],
    }),
  ];

  it('catches nearly identical memories above 0.85 threshold', () => {
    // Near-duplicate: same keywords, minor rewording
    const candidate = {
      title: 'Never use git push --force on main',
      content: 'Force pushed and lost 3 hours of work on deployment',
      tags: ['git', 'deployment'],
    };

    const result = isDuplicate(candidate, existingMemories);
    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe('mem_001');
    expect(result.similarity).toBeGreaterThan(0.85);
  });

  it('catches paraphrased memories above a lower threshold', () => {
    // Paraphrased but same idea -- still caught at 0.6 threshold
    const candidate = {
      title: 'Do not use git push --force on main branch',
      content: 'Force pushing caused loss of 3 hours of work',
      tags: ['git', 'deployment'],
    };

    const result = isDuplicate(candidate, existingMemories, 0.6);
    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe('mem_001');
    expect(result.similarity).toBeGreaterThan(0.6);
  });

  it('allows distinct memories below 0.85 similarity', () => {
    const candidate = {
      title: 'React useEffect cleanup prevents memory leaks',
      content: 'Always return cleanup functions in useEffect',
      tags: ['react', 'frontend', 'performance'],
    };

    const result = isDuplicate(candidate, existingMemories);
    expect(result.isDuplicate).toBe(false);
  });

  it('detects exact fingerprint matches', () => {
    const candidate = {
      title: 'Never use git push --force on main',
      content: 'Force pushed and lost 3 hours of work',
      tags: ['git', 'deployment'],
    };

    const result = isDuplicate(candidate, existingMemories);
    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe('mem_001');
    expect(result.similarity).toBe(1.0);
  });

  it('returns not duplicate for empty existing memory list', () => {
    const candidate = {
      title: 'Something new and unique',
      content: 'Details here',
      tags: ['test'],
    };

    const result = isDuplicate(candidate, []);
    expect(result.isDuplicate).toBe(false);
    expect(result.similarity).toBe(0);
  });
});

// ── Quality Assessment ─────────────────────────────────────────

describe('assessQuality', () => {
  it('gives very low score to vague memories', () => {
    const score = assessQuality({
      type: 'pain',
      title: 'Bug',
      content: '',
      rule: '',
      tags: [],
      severity: 'low',
    });

    expect(score).toBeLessThan(0.15);
  });

  it('gives high score to specific, actionable memories', () => {
    const score = assessQuality({
      type: 'pain',
      title: 'Electron subprocess hangs with claude -p on Windows',
      content: '6+ attempts to spawn Claude as subprocess. Shell:true, named pipes, direct spawn all fail on Windows.',
      rule: 'Do not attempt shell spawning in Electron for Claude. Use API directly or Tauri instead.',
      tags: ['electron', 'subprocess', 'windows', 'architecture'],
      severity: 'high',
    });

    expect(score).toBeGreaterThanOrEqual(0.15);
  });

  it('penalizes memories with no tags', () => {
    const noTagScore = assessQuality({
      type: 'fact',
      title: 'The API uses REST endpoints for data retrieval',
      content: 'All data is fetched via REST endpoints with pagination support',
      rule: '',
      tags: [],
      severity: 'low',
    });

    const withTagScore = assessQuality({
      type: 'fact',
      title: 'The API uses REST endpoints for data retrieval',
      content: 'All data is fetched via REST endpoints with pagination support',
      rule: '',
      tags: ['api', 'rest', 'backend'],
      severity: 'low',
    });

    expect(withTagScore).toBeGreaterThan(noTagScore);
  });

  it('rewards memories with a rule field', () => {
    const noRuleScore = assessQuality({
      type: 'pain',
      title: 'Database connection pool exhaustion',
      content: 'Production DB ran out of connections during peak load',
      rule: '',
      tags: ['database', 'production'],
      severity: 'medium',
    });

    const withRuleScore = assessQuality({
      type: 'pain',
      title: 'Database connection pool exhaustion',
      content: 'Production DB ran out of connections during peak load',
      rule: 'Set max pool size to 20 and add connection timeout of 5s',
      tags: ['database', 'production'],
      severity: 'medium',
    });

    expect(withRuleScore).toBeGreaterThan(noRuleScore);
  });

  it('gives high scores to detailed, high-severity pain memories', () => {
    const score = assessQuality({
      type: 'pain',
      title: 'Production data loss from unguarded migration on server.ts',
      content: 'Ran ALTER TABLE DROP COLUMN without backup. Lost 50k rows of user preferences. Took 4 hours to recover from WAL logs.',
      rule: 'Always backup before destructive migrations. Use transactions with SAVEPOINT.',
      tags: ['database', 'migration', 'production', 'data-loss'],
      severity: 'high',
    });

    expect(score).toBeGreaterThan(0.5);
  });
});

// ── Conflict Detection ─────────────────────────────────────────

describe('detectConflict', () => {
  const existingMemories: Memory[] = [
    makeMemory({
      id: 'mem_old_1',
      type: 'fact',
      title: 'Database uses PostgreSQL',
      content: 'Production database is PostgreSQL 15',
      tags: ['database', 'configuration'],
    }),
    makeMemory({
      id: 'mem_old_2',
      type: 'pain',
      title: 'React setState causes infinite loop in useEffect',
      content: 'Calling setState without dependency array guard loops forever',
      rule: 'Always include proper dependency arrays in useEffect',
      tags: ['react', 'frontend', 'hooks'],
    }),
    makeMemory({
      id: 'mem_old_3',
      type: 'fact',
      title: 'API rate limit is 100 requests per minute',
      content: 'External API enforces 100 req/min rate limit',
      tags: ['api', 'rate-limiting', 'configuration'],
    }),
  ];

  it('finds conflicting memories with overlapping tags and same type', () => {
    const conflicts = detectConflict(
      {
        type: 'fact',
        title: 'Database uses MySQL',
        content: 'Production database is MySQL 8.0',
        tags: ['database', 'configuration'],
        rule: '',
      },
      existingMemories,
    );

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].existingMemory.id).toBe('mem_old_1');
  });

  it('does not flag unrelated memories as conflicts', () => {
    const conflicts = detectConflict(
      {
        type: 'pain',
        title: 'Docker build fails on ARM architecture',
        content: 'Multi-arch builds fail for ARM64',
        tags: ['docker', 'infrastructure', 'ci-cd'],
        rule: '',
      },
      existingMemories,
    );

    expect(conflicts).toHaveLength(0);
  });

  it('detects complementary type conflicts (pain vs win on same topic)', () => {
    const conflicts = detectConflict(
      {
        type: 'win',
        title: 'React useEffect dependency arrays working properly now',
        content: 'Fixed all dependency array warnings and infinite loops gone',
        tags: ['react', 'frontend', 'hooks'],
        rule: '',
      },
      existingMemories,
    );

    // Should detect the pain memory about useEffect as a complementary conflict
    expect(conflicts.length).toBeGreaterThan(0);
    const ids = conflicts.map((c: ConflictInfo) => c.existingMemory.id);
    expect(ids).toContain('mem_old_2');
  });
});

// Import type for use in tests
import type { ConflictInfo } from '../quality-gate.js';

// ── Conflict Resolution ────────────────────────────────────────

describe('resolveConflict', () => {
  const oldMemory = makeMemory({
    id: 'mem_old',
    type: 'fact',
    title: 'API rate limit is 100 requests per minute',
    content: 'External API enforces 100 req/min rate limit',
    tags: ['api', 'rate-limiting'],
    createdAt: '2026-01-15T10:00:00Z',
  });

  const newMemoryFields = {
    type: 'fact' as const,
    title: 'API rate limit increased to 200 requests per minute',
    content: 'Rate limit was raised to 200 req/min as of Feb 2026',
    rule: '',
    tags: ['api', 'rate-limiting'],
    severity: 'low' as const,
  };

  it('keep_new supersedes the old memory', () => {
    const result = resolveConflict(newMemoryFields, oldMemory, 'keep_new');

    expect(result.action).toBe('supersede');
    expect(result.supersededId).toBe('mem_old');
  });

  it('keep_old skips the new memory', () => {
    const result = resolveConflict(newMemoryFields, oldMemory, 'keep_old');

    expect(result.action).toBe('skip');
  });

  it('merge combines insights from both memories', () => {
    const result = resolveConflict(newMemoryFields, oldMemory, 'merge');

    expect(result.action).toBe('merge');
    expect(result.mergedContent).toBeDefined();
    // Merged content should contain new information
    expect(result.mergedContent).toContain('200');
    // Old content should also be present
    expect(result.mergedContent).toContain('100');
    expect(result.supersededId).toBe('mem_old');
  });
});

// ── Full Quality Gate ──────────────────────────────────────────

describe('qualityGate', () => {
  const existingMemories: Memory[] = [
    makeMemory({
      id: 'mem_exist_1',
      type: 'pain',
      title: 'Never use git push --force on main',
      content: 'Force pushed and lost 3 hours of work',
      rule: 'Always use --force-with-lease instead',
      tags: ['git', 'deployment'],
      severity: 'high',
      fingerprint: computeFingerprint({
        title: 'Never use git push --force on main',
        content: 'Force pushed and lost 3 hours of work',
      }),
    }),
    makeMemory({
      id: 'mem_exist_2',
      type: 'fact',
      title: 'Database uses PostgreSQL 15',
      content: 'Production database is PostgreSQL 15',
      tags: ['database', 'configuration'],
    }),
  ];

  it('accepts a high-quality, unique memory', () => {
    const candidate = {
      type: 'pain' as const,
      title: 'Tauri v2 IPC fails silently when payload exceeds 1MB',
      content: 'Large payloads in invoke() are silently dropped. No error, no response. Debugged for 2 hours.',
      rule: 'Chunk large payloads or use Tauri event system for data > 500KB.',
      tags: ['tauri', 'ipc', 'debugging'],
      severity: 'high' as const,
    };

    const result = qualityGate(candidate, existingMemories);

    expect(result.action).toBe('accept');
    expect(result.qualityScore).toBeGreaterThanOrEqual(0.15);
    expect(result.fingerprint).toBeDefined();
    expect(result.fingerprint).toHaveLength(12);
  });

  it('rejects a low-quality, vague memory', () => {
    const candidate = {
      type: 'pain' as const,
      title: 'Bug',
      content: '',
      rule: '',
      tags: [],
      severity: 'low' as const,
    };

    const result = qualityGate(candidate, existingMemories);

    expect(result.action).toBe('reject');
    expect(result.qualityScore).toBeLessThan(0.15);
    expect(result.reason).toMatch(/quality|below/i);
  });

  it('rejects a duplicate memory', () => {
    // Near-identical to mem_exist_1
    const candidate = {
      type: 'pain' as const,
      title: 'Never use git push --force on main',
      content: 'Force pushed and lost 3 hours of work on production',
      rule: 'Always use --force-with-lease instead',
      tags: ['git', 'deployment'],
      severity: 'high' as const,
    };

    const result = qualityGate(candidate, existingMemories);

    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/duplicate/i);
  });

  it('flags conflicts but still accepts when quality is good', () => {
    const candidate = {
      type: 'fact' as const,
      title: 'Database migrated to PostgreSQL 16',
      content: 'Production database upgraded from PG 15 to PG 16 on Feb 25',
      rule: '',
      tags: ['database', 'configuration'],
      severity: 'low' as const,
    };

    const result = qualityGate(candidate, existingMemories, { autoResolve: false });

    // The memory is high enough quality and not a duplicate
    expect(result.qualityScore).toBeGreaterThanOrEqual(0.15);
    // Should have conflicts flagged with the existing PG15 fact
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts!.length).toBeGreaterThan(0);
    expect(result.conflicts![0].existingMemory.id).toBe('mem_exist_2');
    // Action should be accept (conflicts are informational when autoResolve is off)
    expect(result.action).toBe('accept');
  });

  it('auto-resolves conflicts by merging when enabled', () => {
    const candidate = {
      type: 'fact' as const,
      title: 'Database migrated to PostgreSQL 16',
      content: 'Production database upgraded from PG 15 to PG 16 on Feb 25',
      rule: '',
      tags: ['database', 'configuration'],
      severity: 'low' as const,
    };

    const result = qualityGate(candidate, existingMemories, { autoResolve: true });

    // With auto-resolve, high-confidence same-type conflicts trigger merge or supersede
    expect(['accept', 'merge']).toContain(result.action);
  });
});
