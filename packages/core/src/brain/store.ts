import type { Memory, MemoryType, MemorySeverity, BrainState } from '../types.js';
import { MemorySchema, BrainStateSchema, DEFAULT_CORTEX } from '../types.js';
import { JsonStore } from '../storage.js';
import { generateId, now } from '../utils.js';
import { inferSeverity } from './engine.js';

interface MemoryStoreData {
  memories: Memory[];
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
  }): Memory {
    let tags = opts.tags ?? [];
    if (tags.length < 2) {
      const autoTags = this.inferTags(opts.title, opts.content ?? '', opts.rule ?? '');
      tags = [...new Set([...tags, ...autoTags])];
    }

    const memory = MemorySchema.parse({
      id: generateId('mem'),
      projectId: this.projectId,
      type: opts.type,
      title: opts.title,
      content: opts.content ?? '',
      rule: opts.rule ?? '',
      tags,
      severity: opts.severity ?? inferSeverity(opts.content ?? '', opts.rule),
      createdAt: now(),
    });

    this.store.update(data => ({
      memories: [...data.memories, memory],
    }));

    return memory;
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
