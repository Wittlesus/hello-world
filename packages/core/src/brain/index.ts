export { retrieveMemories, inferSeverity, tokenize, buildTagIndex } from './engine.js';
export {
  initBrainState,
  tickMessageCount,
  recordSynapticActivity,
  recordMemoryTraces,
  applySynapticPlasticity,
  applyDecay,
  shouldCheckpoint,
  findDecayedMemories,
} from './state.js';
export { MemoryStore } from './store.js';
export type {
  ScoredMemory,
  AttentionFilterResult,
  RetrievalResult,
  RetrievalTelemetry,
  EngineConfig,
  TagIndex,
} from './types.js';
export { DEFAULT_CONFIG } from './types.js';
