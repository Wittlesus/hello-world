import type { Memory, MemoryType, MemorySeverity, BrainState } from '../types.js';
import { MemorySchema, BrainStateSchema, DEFAULT_CORTEX } from '../types.js';
import { JsonStore } from '../storage.js';
import { generateId, now } from '../utils.js';
import { inferSeverity } from './engine.js';
import { qualityGate } from './quality-gate.js';
import type { QualityGateResult } from './quality-gate.js';

interface MemoryStoreData {
  memories: Memory[];
}

export interface StoreMemoryResult {
  memory: Memory;
  gateResult: QualityGateResult;
  merged?: boolean;
  superseded?: string[];
}

export class MemoryStore {
  private store: JsonStore<MemoryStoreData>;
  private brainStore: JsonStore<{ state: BrainState | null }>;
  private projectId: string;

  constructor(projectRoot: string, projectId: string) {
    this.projectId = projectId;
    this.store = new JsonStore<MemoryStoreData>(projectRoot, 'memories.json', { memories: [] });
    this.brainStore = new JsonStore<{ state: BrainState | null }>(projectRoot, 'brain-state.json', { state: null });
  }

  // Auto-infer tags from title + content + rule if fewer than 2 tags provided
  private inferTags(title: string, content: string, rule: string): string[] {
    const text = `${title} ${content} ${rule}`.toLowerCase();
    const words = text.match(/\b[\w][\w.-]*\b/g) ?? [];
    const tagSet = new Set<string>();
    for (const word of words) {
      const mapped = DEFAULT_CORTEX[word];
      if (mapped) {
        for (const tag of mapped) tagSet.add(tag);
      }
    }
    return [...tagSet].slice(0, 8); // Cap at 8 auto-inferred tags
  }

  storeMemory(opts: {
    type: MemoryType;
    title: string;
    content?: string;
    rule?: string;
    tags?: string[];
    severity?: MemorySeverity;
    relatedTaskId?: string;
    surfacedMemoryIds?: string[];
    outcome?: 'success' | 'partial' | 'failure';
    skipGate?: boolean;
  }): StoreMemoryResult {
    let tags = opts.tags ?? [];
    if (tags.length < 2) {
      const autoTags = this.inferTags(opts.title, opts.content ?? '', opts.rule ?? '');
      tags = [...new Set([...tags, ...autoTags])];
    }

    const severity = opts.severity ?? inferSeverity(opts.content ?? '', opts.rule);
    const candidate = { type: opts.type, title: opts.title, content: opts.content ?? '', rule: opts.rule ?? '', tags, severity };

    // Run quality gate (unless explicitly skipped for system-generated memories)
    const existingMemories = this.getAllMemories();
    const gateResult = opts.skipGate
      ? { action: 'accept' as const, reason: 'Gate skipped', qualityScore: 0.5, fingerprint: '' }
      : qualityGate(candidate, existingMemories, { autoResolve: true });

    if (gateResult.action === 'reject') {
      // Return a memory object but do NOT persist it
      const rejected = MemorySchema.parse({
        id: generateId('mem'),
        projectId: this.projectId,
        ...candidate,
        qualityScore: gateResult.qualityScore,
        fingerprint: gateResult.fingerprint,
        createdAt: now(),
      });
      return { memory: rejected, gateResult };
    }

    if (gateResult.action === 'merge' && gateResult.mergeTarget) {
      // Update the existing memory with merged content
      const target = gateResult.mergeTarget;
      this.store.update(data => ({
        memories: data.memories.map(m => {
          if (m.id !== target.id) return m;
          return {
            ...m,
            title: gateResult.mergedTitle ?? m.title,
            content: gateResult.mergedContent ?? m.content,
            rule: gateResult.mergedRule ?? m.rule,
            qualityScore: gateResult.qualityScore,
            fingerprint: gateResult.fingerprint,
            tags: [...new Set([...m.tags, ...tags])],
          };
        }),
      }));
      // Re-read the merged memory from store for accurate snapshot
      const merged = this.getMemory(target.id) ?? { ...target, qualityScore: gateResult.qualityScore };
      return { memory: merged, gateResult, merged: true };
    }

    // Accept path: store the new memory
    const memory = MemorySchema.parse({
      id: generateId('mem'),
      projectId: this.projectId,
      ...candidate,
      qualityScore: gateResult.qualityScore,
      fingerprint: gateResult.fingerprint,
      relatedTaskId: opts.relatedTaskId,
      surfacedMemoryIds: opts.surfacedMemoryIds,
      outcome: opts.outcome,
      createdAt: now(),
    });

    // Handle supersession: mark conflicting same-type memories as superseded
    const superseded: string[] = [];
    if (gateResult.conflicts?.length) {
      for (const conflict of gateResult.conflicts) {
        if (conflict.confidence > 0.7 && conflict.existingMemory.type === opts.type) {
          this.markSuperseded(conflict.existingMemory.id, memory.id);
          superseded.push(conflict.existingMemory.id);
        }
      }
    }

    this.store.update(data => ({
      memories: [...data.memories, memory],
    }));

    return { memory, gateResult, superseded: superseded.length > 0 ? superseded : undefined };
  }

  getMemory(id: string): Memory | undefined {
    return this.store.read().memories.find(m => m.id === id);
  }

  getAllMemories(): Memory[] {
    return this.store.read().memories.filter(m => m.projectId === this.projectId);
  }

  getMemoriesByType(type: MemoryType): Memory[] {
    return this.getAllMemories().filter(m => m.type === type);
  }

  getMemoriesByTags(tags: string[]): Memory[] {
    const tagSet = new Set(tags);
    return this.getAllMemories().filter(m => m.tags.some(t => tagSet.has(t)));
  }

  updateStrength(id: string, delta: number): void {
    this.store.update(data => ({
      memories: data.memories.map(m => {
        if (m.id !== id) return m;
        return {
          ...m,
          synapticStrength: Math.max(0.3, Math.min(2.0, m.synapticStrength + delta)),
        };
      }),
    }));
  }

  incrementAccess(ids: string[]): void {
    const idSet = new Set(ids);
    const timestamp = now();

    this.store.update(data => ({
      memories: data.memories.map(m => {
        if (!idSet.has(m.id)) return m;
        return {
          ...m,
          accessCount: m.accessCount + 1,
          lastAccessed: timestamp,
        };
      }),
    }));
  }

  markSuperseded(id: string, supersededBy: string): void {
    this.store.update(data => ({
      memories: data.memories.map(m => {
        if (m.id !== id) return m;
        return { ...m, supersededBy };
      }),
    }));
  }

  private reverseRelationship(rel: Memory['links'][number]['relationship']): Memory['links'][number]['relationship'] {
    switch (rel) {
      case 'similar': return 'similar';
      case 'contradicts': return 'contradicts';
      case 'supersedes': return 'superseded_by';
      case 'superseded_by': return 'supersedes';
      case 'related': return 'related';
      default: return 'related';
    }
  }

  addLink(memoryId: string, targetId: string, relationship: Memory['links'][number]['relationship']): void {
    const reverse = this.reverseRelationship(relationship);
    const timestamp = now();

    this.store.update(data => ({
      memories: data.memories.map(m => {
        if (m.id === memoryId) {
          // Forward link: source -> target
          if (m.links.some(l => l.targetId === targetId && l.relationship === relationship)) return m;
          return {
            ...m,
            links: [...m.links, { targetId, relationship, createdAt: timestamp }],
          };
        }
        if (m.id === targetId) {
          // Reverse link: target -> source
          if (m.links.some(l => l.targetId === memoryId && l.relationship === reverse)) return m;
          return {
            ...m,
            links: [...m.links, { targetId: memoryId, relationship: reverse, createdAt: timestamp }],
          };
        }
        return m;
      }),
    }));
  }

  updateMemory(id: string, updates: Partial<Pick<Memory, 'title' | 'content' | 'rule' | 'tags' | 'qualityScore' | 'fingerprint'>>): void {
    this.store.update(data => ({
      memories: data.memories.map(m => {
        if (m.id !== id) return m;
        return { ...m, ...updates };
      }),
    }));
  }

  cleanDanglingLinks(validIds: Set<string>): number {
    let removed = 0;

    this.store.update(data => ({
      memories: data.memories.map(m => {
        if (m.links.length === 0) return m;
        const cleaned = m.links.filter(l => validIds.has(l.targetId));
        const delta = m.links.length - cleaned.length;
        if (delta === 0) return m;
        removed += delta;
        return { ...m, links: cleaned };
      }),
    }));

    return removed;
  }

  deleteMemory(id: string): void {
    this.store.update(data => ({
      memories: data.memories.filter(m => m.id !== id),
    }));
  }

  // ── Brain State ──────────────────────────────────────────────

  getBrainState(): BrainState | null {
    return this.brainStore.read().state;
  }

  saveBrainState(state: BrainState): void {
    this.brainStore.write({ state });
  }
}
