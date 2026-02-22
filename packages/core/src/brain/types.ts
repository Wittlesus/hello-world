import type { Memory, BrainState, ContextPhase } from '../types.js';
import { DEFAULT_CORTEX, ATTENTION_PATTERNS } from '../types.js';

export interface ScoredMemory {
  memory: Memory;
  score: number;
  matchedTags: string[];
  source: 'direct' | 'associative' | 'dopamine';
}

export interface AttentionFilterResult {
  type: string;
  message: string;
}

export interface EngineConfig {
  cortex: Record<string, string[]>;
  attentionPatterns: Record<string, string>;
  maxPain: number;
  maxWins: number;
  lateMaxPain: number;
  lateMaxWins: number;
  minPromptLength: number;
  checkpointInterval: number;
  decayThresholdDays: number;
  sessionTagRepeatThreshold: number;
  contextPhaseMid: number;
  contextPhaseLate: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  cortex: DEFAULT_CORTEX,
  attentionPatterns: ATTENTION_PATTERNS,
  maxPain: 5,
  maxWins: 3,
  lateMaxPain: 2,
  lateMaxWins: 1,
  minPromptLength: 5,
  checkpointInterval: 12,
  decayThresholdDays: 30,
  sessionTagRepeatThreshold: 3,
  contextPhaseMid: 20,
  contextPhaseLate: 40,
};

export type TagIndex = Record<string, string[]>;

export interface RetrievalResult {
  painMemories: ScoredMemory[];
  winMemories: ScoredMemory[];
  matchedTags: string[];
  attentionFilter: AttentionFilterResult | null;
  contextPhase: ContextPhase;
  hotTags: string[];
  injectionText: string;
}

export type { Memory, BrainState, ContextPhase };
