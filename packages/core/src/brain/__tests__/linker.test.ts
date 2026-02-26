/**
 * Linker tests for Brain Magnum Opus.
 *
 * Tests the memory link graph system:
 * - computeSimilarity for content-based similarity scoring
 * - findLinks for relationship detection (resolves, extends, contradicts)
 * - detectSupersession for newer versions of same facts
 * - traverseLinks for graph traversal with depth limits
 * - buildLinkGraph for adjacency map construction
 */

import { describe, it, expect } from 'vitest';
import type { Memory } from '../../types.js';
import {
  computeSimilarity,
  findLinks,
  detectSupersession,
  detectContradiction,
  traverseLinks,
  buildLinkGraph,
} from '../linker.js';
import type { CandidateLink, LinkGraph } from '../linker.js';

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

// ── computeSimilarity ───────────────────────────────────────────

describe('computeSimilarity', () => {
  it('returns high similarity for closely related memories', () => {
    const a = makeMemory({
      id: 'mem_a',
      type: 'pain',
      title: 'Never use git push --force on main',
      content: 'Force pushed to main and lost work',
      rule: 'Use --force-with-lease instead',
      tags: ['git', 'deployment'],
    });

    const b = makeMemory({
      id: 'mem_b',
      type: 'pain',
      title: 'Git force push destroyed branch history',
      content: 'Force push overwrote teammate commits on main',
      rule: 'Always use --force-with-lease for safety',
      tags: ['git', 'deployment'],
    });

    const score = computeSimilarity(a, b);
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns low similarity for unrelated memories', () => {
    const a = makeMemory({
      id: 'mem_a',
      type: 'pain',
      title: 'Never use git push --force on main',
      content: 'Force pushed to main and lost work',
      tags: ['git', 'deployment'],
    });

    const b = makeMemory({
      id: 'mem_b',
      type: 'win',
      title: 'React performance optimization with memo',
      content: 'Used React.memo to reduce unnecessary re-renders by 60%',
      tags: ['react', 'performance', 'frontend'],
    });

    const score = computeSimilarity(a, b);
    expect(score).toBeLessThan(0.3);
  });

  it('returns 1.0 for identical memories', () => {
    const a = makeMemory({
      id: 'mem_a',
      type: 'pain',
      title: 'Deploy broke production',
      content: 'Deployed without testing',
      tags: ['deployment', 'testing'],
    });

    const b = makeMemory({
      id: 'mem_b',
      type: 'pain',
      title: 'Deploy broke production',
      content: 'Deployed without testing',
      tags: ['deployment', 'testing'],
    });

    const score = computeSimilarity(a, b);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns a score between 0 and 1', () => {
    const a = makeMemory({ id: 'a', type: 'pain', title: 'Random title one', tags: ['misc'] });
    const b = makeMemory({ id: 'b', type: 'win', title: 'Random title two', tags: ['other'] });

    const score = computeSimilarity(a, b);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('weighs tag overlap heavily in similarity', () => {
    const a = makeMemory({
      id: 'a',
      type: 'fact',
      title: 'PostgreSQL uses MVCC concurrency model',
      tags: ['database', 'postgresql', 'concurrency'],
    });

    const b = makeMemory({
      id: 'b',
      type: 'fact',
      title: 'MySQL uses row-level locking mechanism',
      tags: ['database', 'mysql', 'concurrency'],
    });

    // Different DB engines but same domain -- moderate similarity via shared tags
    const score = computeSimilarity(a, b);
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.8);
  });
});

// ── findLinks ───────────────────────────────────────────────────

describe('findLinks', () => {
  const painDeploy = makeMemory({
    id: 'pain_deploy',
    type: 'pain',
    title: 'Deploy broke production because no tests ran',
    content: 'Deployed without running test suite first',
    rule: 'Always run tests before deploy',
    tags: ['deployment', 'testing'],
    severity: 'high',
    createdAt: '2026-01-10T10:00:00Z',
  });

  const winDeploy = makeMemory({
    id: 'win_deploy',
    type: 'win',
    title: 'CI pipeline now runs tests before deploy',
    content: 'Set up GitHub Actions to run full test suite before any deployment',
    tags: ['deployment', 'testing', 'ci-cd'],
    createdAt: '2026-02-01T10:00:00Z',
  });

  const factDB = makeMemory({
    id: 'fact_db',
    type: 'fact',
    title: 'Database uses PostgreSQL 15 with pgvector',
    content: 'Production database is PostgreSQL 15 with pgvector extension',
    tags: ['database', 'configuration', 'postgresql'],
    createdAt: '2026-01-15T10:00:00Z',
  });

  const factDBExtended = makeMemory({
    id: 'fact_db_ext',
    type: 'fact',
    title: 'PostgreSQL 15 connection pooling configured via PgBouncer',
    content: 'PgBouncer configured with 50 max connections for PostgreSQL 15',
    tags: ['database', 'configuration', 'performance', 'postgresql'],
    createdAt: '2026-02-15T10:00:00Z',
  });

  const allMemories = [painDeploy, winDeploy, factDB, factDBExtended];

  it('identifies "resolves" relationships (win resolving pain)', () => {
    const links = findLinks(winDeploy, allMemories);
    // The win about CI should have some relationship to the deploy pain
    expect(links.length).toBeGreaterThan(0);
    const targetIds = links.map(l => l.targetId);
    expect(targetIds).toContain('pain_deploy');
  });

  it('identifies "extends" relationships (related topics)', () => {
    const links = findLinks(factDBExtended, allMemories);
    // DB connection pooling extends or relates to the base DB fact
    expect(links.length).toBeGreaterThan(0);
    const targetIds = links.map(l => l.targetId);
    expect(targetIds).toContain('fact_db');
  });

  it('does not link a memory to itself', () => {
    const links = findLinks(painDeploy, allMemories);
    const selfLinks = links.filter(l => l.targetId === painDeploy.id);
    expect(selfLinks).toHaveLength(0);
  });

  it('returns empty array for a completely unrelated memory', () => {
    const unrelated = makeMemory({
      id: 'unrelated',
      type: 'win',
      title: 'Logo redesign approved by stakeholders',
      content: 'New brand identity well received',
      tags: ['design', 'branding'],
      createdAt: '2026-02-20T10:00:00Z',
    });

    const links = findLinks(unrelated, allMemories);
    expect(links).toHaveLength(0);
  });

  it('returns candidate links with weight and reason', () => {
    const links = findLinks(winDeploy, allMemories);
    for (const link of links) {
      expect(link.targetId).toBeDefined();
      expect(link.relationship).toBeDefined();
      expect(link.weight).toBeGreaterThan(0);
      expect(link.reason).toBeDefined();
    }
  });
});

// ── detectContradiction ─────────────────────────────────────────

describe('detectContradiction', () => {
  it('detects contradiction between pain and win with shared tags', () => {
    const pain = makeMemory({
      id: 'p1',
      type: 'pain',
      title: 'Deployment always breaks with manual process',
      content: 'Manual deployments always fail',
      rule: 'Never deploy manually',
      tags: ['deployment', 'testing', 'production'],
    });

    const win = makeMemory({
      id: 'w1',
      type: 'win',
      title: 'Deployment works reliably now',
      content: 'CI/CD pipeline makes deployments safe',
      rule: 'Always use CI pipeline',
      tags: ['deployment', 'testing', 'production'],
    });

    const score = detectContradiction(pain, win);
    expect(score).toBeGreaterThan(0.3);
  });

  it('returns 0 for memories with no shared tags', () => {
    const a = makeMemory({
      id: 'a',
      type: 'pain',
      title: 'Git problems',
      tags: ['git', 'version-control'],
    });
    const b = makeMemory({
      id: 'b',
      type: 'win',
      title: 'React performance fixed',
      tags: ['react', 'performance'],
    });

    const score = detectContradiction(a, b);
    expect(score).toBe(0);
  });

  it('detects negation pair contradiction in rules', () => {
    const a = makeMemory({
      id: 'a',
      type: 'fact',
      title: 'Config approach for database connections',
      rule: 'Always use connection pooling',
      tags: ['database', 'configuration'],
    });
    const b = makeMemory({
      id: 'b',
      type: 'fact',
      title: 'Config approach for database connections',
      rule: 'Never use connection pooling for small apps',
      tags: ['database', 'configuration'],
    });

    const score = detectContradiction(a, b);
    expect(score).toBeGreaterThan(0.4);
  });
});

// ── detectSupersession ──────────────────────────────────────────

describe('detectSupersession', () => {
  it('catches newer version of same fact with matching title prefix', () => {
    const oldFact = makeMemory({
      id: 'fact_old',
      type: 'fact',
      title: 'External API rate limit configuration and enforcement policy',
      content: 'External API enforces 100 req/min rate limit',
      tags: ['api', 'rate-limiting', 'configuration'],
      createdAt: '2026-01-10T10:00:00Z',
    });

    const newFact = makeMemory({
      id: 'fact_new',
      type: 'fact',
      title: 'External API rate limit configuration and enforcement policy',
      content: 'Rate limit raised to 200 req/min as of Feb 2026',
      tags: ['api', 'rate-limiting', 'configuration'],
      createdAt: '2026-02-20T10:00:00Z',
    });

    // Same title, same type, newer date, shared tags = clear supersession
    const score = detectSupersession(newFact, oldFact);
    expect(score).toBeGreaterThan(0.5);
  });

  it('does not flag unrelated facts as supersession', () => {
    const oldFact = makeMemory({
      id: 'fact_old',
      type: 'fact',
      title: 'API rate limit is 100 requests per minute',
      content: 'External API enforces 100 req/min rate limit',
      tags: ['api', 'rate-limiting'],
      createdAt: '2026-01-10T10:00:00Z',
    });

    const differentFact = makeMemory({
      id: 'fact_different',
      type: 'fact',
      title: 'Database connection timeout is 30 seconds',
      content: 'Connection timeout configured to 30s',
      tags: ['database', 'configuration'],
      createdAt: '2026-02-21T10:00:00Z',
    });

    const score = detectSupersession(differentFact, oldFact);
    expect(score).toBe(0);
  });

  it('returns 0 for different memory types', () => {
    const fact = makeMemory({
      id: 'f1',
      type: 'fact',
      title: 'API rate limit is 100 requests per minute',
      tags: ['api', 'rate-limiting'],
      createdAt: '2026-01-10T10:00:00Z',
    });

    const pain = makeMemory({
      id: 'p1',
      type: 'pain',
      title: 'Hit API rate limit during bulk import',
      content: 'Bulk import exceeded 100 req/min limit',
      tags: ['api', 'rate-limiting'],
      createdAt: '2026-02-22T10:00:00Z',
    });

    // Pain should not supersede a fact
    const score = detectSupersession(pain, fact);
    expect(score).toBe(0);
  });

  it('returns 0 when new memory is older than existing', () => {
    const old = makeMemory({
      id: 'old',
      type: 'fact',
      title: 'API rate limit is 100 requests per minute',
      tags: ['api', 'rate-limiting'],
      createdAt: '2026-02-20T10:00:00Z',
    });

    const older = makeMemory({
      id: 'older',
      type: 'fact',
      title: 'API rate limit is 50 requests per minute',
      tags: ['api', 'rate-limiting'],
      createdAt: '2026-01-01T10:00:00Z',
    });

    const score = detectSupersession(older, old);
    expect(score).toBe(0);
  });
});

// ── traverseLinks ───────────────────────────────────────────────

describe('traverseLinks', () => {
  // Build a link graph: A -> B -> C -> D
  const memA = makeMemory({
    id: 'mem_a', type: 'pain', title: 'Root pain memory',
    tags: ['root'],
    links: [{ targetId: 'mem_b', relationship: 'related', createdAt: new Date().toISOString() }],
  });
  const memB = makeMemory({
    id: 'mem_b', type: 'win', title: 'Resolves root pain memory',
    tags: ['mid'],
    links: [{ targetId: 'mem_c', relationship: 'extends', createdAt: new Date().toISOString() }],
  });
  const memC = makeMemory({
    id: 'mem_c', type: 'fact', title: 'Extended fact memory',
    tags: ['leaf'],
    links: [{ targetId: 'mem_d', relationship: 'related', createdAt: new Date().toISOString() }],
  });
  const memD = makeMemory({
    id: 'mem_d', type: 'fact', title: 'Deep leaf memory',
    tags: ['deep'],
    links: [],
  });

  const allMemories = [memA, memB, memC, memD];

  it('follows links to correct depth', () => {
    const visited = traverseLinks('mem_a', allMemories, 3);
    const visitedIds = visited.map(t => t.memory.id);

    expect(visitedIds).toContain('mem_b');
    expect(visitedIds).toContain('mem_c');
    expect(visitedIds).toContain('mem_d');
  });

  it('respects max depth of 1', () => {
    const visited = traverseLinks('mem_a', allMemories, 1);
    const visitedIds = visited.map(t => t.memory.id);

    expect(visitedIds).toContain('mem_b');
    expect(visitedIds).not.toContain('mem_c');
    expect(visitedIds).not.toContain('mem_d');
  });

  it('respects max depth of 2', () => {
    const visited = traverseLinks('mem_a', allMemories, 2);
    const visitedIds = visited.map(t => t.memory.id);

    expect(visitedIds).toContain('mem_b');
    expect(visitedIds).toContain('mem_c');
    expect(visitedIds).not.toContain('mem_d');
  });

  it('does not include the starting node itself', () => {
    const visited = traverseLinks('mem_a', allMemories, 3);
    const visitedIds = visited.map(t => t.memory.id);
    expect(visitedIds).not.toContain('mem_a');
  });

  it('handles nodes with no links', () => {
    const visited = traverseLinks('mem_d', allMemories, 3);
    // mem_d has no outgoing links, but mem_c links TO it -- bidirectional traversal may find mem_c
    // At minimum it should not crash
    expect(Array.isArray(visited)).toBe(true);
  });

  it('handles missing nodes gracefully', () => {
    const visited = traverseLinks('mem_nonexistent', allMemories, 3);
    expect(visited).toHaveLength(0);
  });

  it('handles circular links without infinite loop', () => {
    const circA = makeMemory({
      id: 'circ_a', type: 'fact', title: 'Circular A',
      links: [{ targetId: 'circ_b', relationship: 'related', createdAt: new Date().toISOString() }],
    });
    const circB = makeMemory({
      id: 'circ_b', type: 'fact', title: 'Circular B',
      links: [{ targetId: 'circ_a', relationship: 'related', createdAt: new Date().toISOString() }],
    });

    const visited = traverseLinks('circ_a', [circA, circB], 10);
    // Should visit circ_b without infinite loop
    const visitedIds = visited.map(t => t.memory.id);
    expect(visitedIds).toContain('circ_b');
    // Should not contain duplicates
    const uniqueIds = new Set(visitedIds);
    expect(uniqueIds.size).toBe(visitedIds.length);
  });

  it('returns traversed memories with depth and path weight info', () => {
    const visited = traverseLinks('mem_a', allMemories, 3);
    for (const tm of visited) {
      expect(tm.memory).toBeDefined();
      expect(tm.depth).toBeGreaterThanOrEqual(1);
      expect(tm.pathWeight).toBeGreaterThan(0);
      expect(tm.via).toBeDefined();
    }
  });
});

// ── buildLinkGraph ──────────────────────────────────────────────

describe('buildLinkGraph', () => {
  const memories: Memory[] = [
    makeMemory({
      id: 'mem_1', type: 'pain', title: 'Pain 1',
      links: [
        { targetId: 'mem_2', relationship: 'related', createdAt: new Date().toISOString() },
        { targetId: 'mem_3', relationship: 'resolves', createdAt: new Date().toISOString() },
      ],
    }),
    makeMemory({
      id: 'mem_2', type: 'win', title: 'Win 2',
      links: [
        { targetId: 'mem_3', relationship: 'extends', createdAt: new Date().toISOString() },
      ],
    }),
    makeMemory({
      id: 'mem_3', type: 'fact', title: 'Fact 3',
      links: [],
    }),
    makeMemory({
      id: 'mem_4', type: 'fact', title: 'Isolated node',
      links: [],
    }),
  ];

  it('creates entries for all memories', () => {
    const graph = buildLinkGraph(memories);

    // All memories should have entries (even those with no outgoing links)
    expect(graph.has('mem_1')).toBe(true);
    expect(graph.has('mem_2')).toBe(true);
    expect(graph.has('mem_3')).toBe(true);
    expect(graph.has('mem_4')).toBe(true);
  });

  it('tracks outgoing links correctly', () => {
    const graph = buildLinkGraph(memories);

    // mem_1 has outgoing to mem_2 and mem_3
    const entry1 = graph.get('mem_1')!;
    expect(entry1.outgoing).toHaveLength(2);
    expect(entry1.outgoing.map(e => e.targetId)).toContain('mem_2');
    expect(entry1.outgoing.map(e => e.targetId)).toContain('mem_3');

    // mem_2 has outgoing to mem_3
    const entry2 = graph.get('mem_2')!;
    expect(entry2.outgoing).toHaveLength(1);
    expect(entry2.outgoing[0].targetId).toBe('mem_3');

    // mem_3 has no outgoing links
    const entry3 = graph.get('mem_3')!;
    expect(entry3.outgoing).toHaveLength(0);
  });

  it('tracks incoming links correctly', () => {
    const graph = buildLinkGraph(memories);

    // mem_3 should have incoming from mem_1 and mem_2
    const entry3 = graph.get('mem_3')!;
    expect(entry3.incoming.length).toBeGreaterThanOrEqual(2);
    expect(entry3.incoming.map(e => e.sourceId)).toContain('mem_1');
    expect(entry3.incoming.map(e => e.sourceId)).toContain('mem_2');
  });

  it('preserves relationship types in edges', () => {
    const graph = buildLinkGraph(memories);

    const entry1 = graph.get('mem_1')!;
    const resolveEdge = entry1.outgoing.find(e => e.targetId === 'mem_3');
    expect(resolveEdge).toBeDefined();
    expect(resolveEdge!.relationship).toBe('resolves');
  });

  it('returns empty map for empty memory array', () => {
    const graph = buildLinkGraph([]);
    expect(graph.size).toBe(0);
  });
});
