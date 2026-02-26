/**
 * Brain State — pure mutation functions for session tracking,
 * synaptic plasticity, and decay.
 *
 * All functions are pure: they return new state objects.
 * Callers persist via the memory store.
 */

import type { BrainState } from '../types.js';
import type { EngineConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { getContextPhase } from './engine.js';
import { now } from '../utils.js';

/**
 * Initialize session state. Applies decay to existing state,
 * resets session-local counters.
 */
export function initBrainState(existing: BrainState | null): BrainState {
  const base: BrainState = existing
    ? applyDecay(existing)
    : {
        sessionStart: now(),
        messageCount: 0,
        contextPhase: 'early',
        synapticActivity: {},
        memoryTraces: {},
        firingFrequency: {},
        activeTraces: [],
        significantEventsSinceCheckpoint: 0,
      };

  // Prune carried-over maps to prevent unbounded growth
  const prunedTraces = pruneMemoryTraces(base.memoryTraces);
  const prunedActivity = pruneSynapticActivity(base.synapticActivity);

  return {
    ...base,
    sessionStart: now(),
    messageCount: 0,
    contextPhase: 'early',
    firingFrequency: {},
    activeTraces: [],
    memoryTraces: prunedTraces,
    synapticActivity: prunedActivity,
  };
}

const MAX_MEMORY_TRACES = 500;
const MAX_SYNAPTIC_ACTIVITY = 500;
const DECAY_THRESHOLD = 0.05; // within this distance of 1.0 = fully decayed
const STALE_ACTIVITY_DAYS = 7;

/**
 * Remove fully-decayed memory traces (synapticStrength within 0.05 of 1.0),
 * then cap at 500 entries keeping highest synapticStrength.
 */
function pruneMemoryTraces(
  traces: BrainState['memoryTraces'],
): BrainState['memoryTraces'] {
  // Filter out fully-decayed entries
  const entries = Object.entries(traces).filter(
    ([, t]) => Math.abs(t.synapticStrength - 1.0) > DECAY_THRESHOLD,
  );

  // If still over cap, keep top N by synapticStrength
  if (entries.length > MAX_MEMORY_TRACES) {
    entries.sort((a, b) => b[1].synapticStrength - a[1].synapticStrength);
    entries.length = MAX_MEMORY_TRACES;
  }

  return Object.fromEntries(entries);
}

/**
 * Remove stale single-hit synaptic activity (count=1 and older than 7 days),
 * then cap at 500 entries keeping highest count.
 */
function pruneSynapticActivity(
  activity: BrainState['synapticActivity'],
): BrainState['synapticActivity'] {
  const cutoff = Date.now() - STALE_ACTIVITY_DAYS * 86400000;

  // Filter out stale single-hit entries
  const entries = Object.entries(activity).filter(([, a]) => {
    if (a.count === 1 && new Date(a.lastHit).getTime() < cutoff) return false;
    return true;
  });

  // If still over cap, keep top N by count
  if (entries.length > MAX_SYNAPTIC_ACTIVITY) {
    entries.sort((a, b) => b[1].count - a[1].count);
    entries.length = MAX_SYNAPTIC_ACTIVITY;
  }

  return Object.fromEntries(entries);
}

/**
 * Increment message counter and update context phase.
 */
export function tickMessageCount(
  state: BrainState,
  config: Pick<EngineConfig, 'contextPhaseMid' | 'contextPhaseLate'> = DEFAULT_CONFIG,
): BrainState {
  const newCount = state.messageCount + 1;
  return {
    ...state,
    messageCount: newCount,
    contextPhase: getContextPhase(newCount, config),
  };
}

/**
 * Record which tags were activated (cross-session + session-local).
 */
export function recordSynapticActivity(state: BrainState, tags: string[]): BrainState {
  if (tags.length === 0) return state;

  const timestamp = now();
  const synapticActivity = { ...state.synapticActivity };
  const firingFrequency = { ...state.firingFrequency };

  for (const tag of tags) {
    synapticActivity[tag] = {
      count: (synapticActivity[tag]?.count ?? 0) + 1,
      lastHit: timestamp,
    };
    firingFrequency[tag] = (firingFrequency[tag] ?? 0) + 1;
  }

  return { ...state, synapticActivity, firingFrequency };
}

/**
 * Record which memory IDs were surfaced this retrieval.
 */
export function recordMemoryTraces(state: BrainState, memoryIds: string[]): BrainState {
  if (memoryIds.length === 0) return state;

  const timestamp = now();
  const memoryTraces = { ...state.memoryTraces };
  const activeTraces = new Set(state.activeTraces);

  for (const id of memoryIds) {
    memoryTraces[id] = {
      count: (memoryTraces[id]?.count ?? 0) + 1,
      lastAccessed: timestamp,
      synapticStrength: memoryTraces[id]?.synapticStrength ?? 1.0,
    };
    activeTraces.add(id);
  }

  return { ...state, memoryTraces, activeTraces: [...activeTraces] };
}

/**
 * Apply synaptic plasticity at end of session.
 * All surfaced memories get a small effectiveness boost (max 2.0).
 */
export function applySynapticPlasticity(
  state: BrainState,
  boost = 0.1,
  max = 2.0,
): { state: BrainState; boosted: string[] } {
  if (state.activeTraces.length === 0) return { state, boosted: [] };

  const memoryTraces = { ...state.memoryTraces };
  const boosted: string[] = [];

  for (const id of state.activeTraces) {
    if (!memoryTraces[id]) continue;
    const current = memoryTraces[id].synapticStrength;
    memoryTraces[id] = {
      ...memoryTraces[id],
      synapticStrength: Math.min(max, parseFloat((current + boost).toFixed(2))),
    };
    boosted.push(id);
  }

  return { state: { ...state, memoryTraces }, boosted };
}

/**
 * Decay toward neutral on session start.
 * Moves all synaptic strengths 10% toward 1.0.
 */
export function applyDecay(state: BrainState): BrainState {
  const memoryTraces = { ...state.memoryTraces };

  for (const [id, trace] of Object.entries(memoryTraces)) {
    const strength = trace.synapticStrength;
    if (strength !== 1.0) {
      memoryTraces[id] = {
        ...trace,
        synapticStrength: parseFloat((strength + (1.0 - strength) * 0.1).toFixed(2)),
      };
    }
  }

  return { ...state, memoryTraces };
}

/**
 * Check if a consolidation checkpoint should fire.
 * More frequent in late-session phases.
 */
export function shouldCheckpoint(state: BrainState, config: EngineConfig = DEFAULT_CONFIG): boolean {
  const interval = state.contextPhase === 'late'
    ? Math.floor(config.checkpointInterval / 2)
    : state.contextPhase === 'mid'
    ? Math.floor(config.checkpointInterval * 0.75)
    : config.checkpointInterval;

  return state.messageCount > 0 && state.messageCount % interval === 0;
}

/**
 * Find memories not accessed in decayThresholdDays.
 */
export function findDecayedMemories(
  state: BrainState,
  config: EngineConfig = DEFAULT_CONFIG,
): Array<{ id: string; daysSince: number; accessCount: number }> {
  const today = Date.now();
  const result: Array<{ id: string; daysSince: number; accessCount: number }> = [];

  for (const [id, trace] of Object.entries(state.memoryTraces)) {
    if (!trace.lastAccessed) continue;
    const daysSince = Math.floor((today - new Date(trace.lastAccessed).getTime()) / 86400000);
    if (daysSince >= config.decayThresholdDays) {
      result.push({ id, daysSince, accessCount: trace.count });
    }
  }

  return result.sort((a, b) => b.daysSince - a.daysSince);
}
