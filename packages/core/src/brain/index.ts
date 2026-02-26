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

// S49: Quality gates, linking, reflection, prediction
export {
  qualityGate,
  computeFingerprint,
  isDuplicate,
  assessQuality,
  detectConflict,
  resolveConflict,
} from './quality-gate.js';
export type { QualityGateResult, QualityGateOptions, ConflictInfo, DuplicateResult } from './quality-gate.js';

export {
  computeSimilarity,
  findLinks,
  applyLinks,
  buildLinkGraph,
  traverseLinks,
  detectContradiction,
  detectSupersession,
} from './linker.js';

export {
  createReflection,
  shouldReflect,
  generateMetaObservations,
  detectSurprise,
  clusterByTagOverlap,
} from './reflection.js';

export {
  estimateExpectedness,
  shouldAutoCapture,
  createSurpriseMemory,
  updateExpectations,
  processPredictionEvent,
  createExpectationModel,
  decayExpectationModel,
} from './prediction.js';
