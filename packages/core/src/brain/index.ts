export { buildTagIndex, inferSeverity, retrieveMemories, tokenize } from './engine.js';
export {
  applyDecay,
  applySynapticPlasticity,
  findDecayedMemories,
  initBrainState,
  recordMemoryTraces,
  recordSynapticActivity,
  shouldCheckpoint,
  tickMessageCount,
} from './state.js';
export { MemoryStore } from './store.js';
export type {
  AttentionFilterResult,
  EngineConfig,
  RetrievalResult,
  ScoredMemory,
  TagIndex,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';
