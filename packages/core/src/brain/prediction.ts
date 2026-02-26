/**
 * Prediction-Error Auto-Capture System
 *
 * Biological basis: The brain stores surprises, not routine events.
 * Dopamine neurons fire on prediction errors -- when outcomes violate
 * expectations. This module implements that principle:
 *
 * 1. Track frequency of event patterns (the expectation model)
 * 2. Estimate how expected a new event is based on prior frequency
 * 3. Only auto-capture events that are surprising (low expectedness)
 * 4. Classify surprises by valence: pain (bad), win (good), fact (neutral)
 * 5. Adapt the capture threshold based on recent memory density
 *
 * The expectation model is simple: frequency counts with time decay.
 * Events seen many times recently become expected. Novel events are surprising.
 * This prevents the memory store from filling with routine task completions
 * while ensuring genuine anomalies get captured.
 */

import type { Memory, MemoryType, MemorySeverity, BrainState } from '../types.js';
import type { ExpectationModel, PredictionEvent, EventSignature } from './prediction-types.js';

// ── Constants ────────────────────────────────────────────────────

/** Below this expectedness score, events are considered surprising */
const DEFAULT_SURPRISE_THRESHOLD = 0.6;

/** Minimum threshold -- never drop below this even with adaptive adjustment */
const MIN_SURPRISE_THRESHOLD = 0.3;

/** Maximum threshold -- never raise above this */
const MAX_SURPRISE_THRESHOLD = 0.85;

/** How many recent memories to consider for adaptive threshold */
const MEMORY_DENSITY_WINDOW_HOURS = 4;

/** Maximum memories per density window before threshold rises */
const DENSITY_SOFT_CAP = 8;

/** Time decay factor for frequency counts (per day) */
const FREQUENCY_DECAY_RATE = 0.1;

/** Maximum frequency entries to keep in the model */
const MAX_FREQUENCY_ENTRIES = 500;

/** Minimum expectedness below which we boost encoding strength */
const HIGH_SURPRISE_CUTOFF = 0.2;

// ── Event Fingerprinting ─────────────────────────────────────────

/**
 * Create a signature for an event that captures its "class" --
 * the pattern that determines whether this type of event has been seen before.
 *
 * Two events with the same signature are considered "the same kind of thing."
 * This is intentionally coarse: we want "build failed" to match "build failed"
 * regardless of the specific error message.
 */
export function createEventSignature(event: PredictionEvent): EventSignature {
  const parts: string[] = [event.category];

  if (event.subcategory) {
    parts.push(event.subcategory);
  }

  // For errors, include the error class but not the specific message
  if (event.category === 'error' && event.errorClass) {
    parts.push(event.errorClass);
  }

  // For tool results, include the tool name and outcome class
  if (event.category === 'tool_result' && event.toolName) {
    parts.push(event.toolName);
    if (event.outcomeClass) {
      parts.push(event.outcomeClass);
    }
  }

  // For user patterns, include the pattern type
  if (event.category === 'user_pattern' && event.patternType) {
    parts.push(event.patternType);
  }

  return parts.join('::');
}

// ── Expectation Estimation ───────────────────────────────────────

/**
 * Initialize a fresh expectation model.
 */
export function createExpectationModel(): ExpectationModel {
  return {
    frequencies: {},
    totalEvents: 0,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Estimate how expected an event is given the current expectation model.
 *
 * Returns a value from 0 to 1:
 * - 0.0 = total surprise (never seen this pattern before)
 * - 0.5 = somewhat expected (seen a few times)
 * - 1.0 = completely expected (very frequent pattern)
 *
 * The estimation uses:
 * 1. Raw frequency of this event signature (with time decay)
 * 2. Proportion relative to total events
 * 3. Recency of last occurrence
 */
export function estimateExpectedness(
  event: PredictionEvent,
  model: ExpectationModel,
  recentContext: { recentMemoryCount: number; sessionMessageCount: number },
): number {
  const signature = createEventSignature(event);
  const entry = model.frequencies[signature];

  // Never seen this pattern before = maximum surprise
  if (!entry) {
    return 0.0;
  }

  const now = Date.now();

  // 1. Frequency component: how often has this been seen?
  // Apply time decay to the count
  const daysSinceLastSeen = (now - new Date(entry.lastSeen).getTime()) / 86_400_000;
  const decayedCount = entry.count * Math.exp(-FREQUENCY_DECAY_RATE * daysSinceLastSeen);

  // Logarithmic scale: first occurrence is novel, 10th is routine
  // log2(1) = 0, log2(2) = 1, log2(4) = 2, log2(8) = 3, log2(16) = 4
  const frequencyScore = Math.min(1.0, Math.log2(decayedCount + 1) / 4);

  // 2. Proportion component: what fraction of all events is this pattern?
  const proportion = model.totalEvents > 0
    ? Math.min(1.0, (entry.count / model.totalEvents) * 5)
    : 0;

  // 3. Recency component: was this seen very recently?
  // Seeing it within the last hour makes it very expected
  const hoursSinceLastSeen = daysSinceLastSeen * 24;
  const recencyScore = hoursSinceLastSeen < 1 ? 0.8
    : hoursSinceLastSeen < 4 ? 0.5
    : hoursSinceLastSeen < 24 ? 0.2
    : 0.0;

  // 4. Session context: if we're deep in a session, routine events are more expected
  const sessionFatigue = Math.min(0.15, recentContext.sessionMessageCount * 0.005);

  // Weighted combination
  const expectedness = (
    frequencyScore * 0.4 +
    proportion * 0.15 +
    recencyScore * 0.3 +
    sessionFatigue * 0.15
  );

  return Math.min(1.0, Math.max(0.0, expectedness));
}

// ── Capture Decision ─────────────────────────────────────────────

/**
 * Compute the adaptive surprise threshold based on recent memory density.
 *
 * When many memories have been captured recently, raise the threshold
 * (require more surprise to capture). When few have been captured,
 * lower the threshold (be more receptive to new information).
 *
 * This prevents memory flooding during active sessions while
 * ensuring quiet periods still capture useful information.
 */
export function computeAdaptiveThreshold(
  recentMemories: Array<{ createdAt: string }>,
  baseThreshold: number = DEFAULT_SURPRISE_THRESHOLD,
): number {
  const now = Date.now();
  const windowMs = MEMORY_DENSITY_WINDOW_HOURS * 3600_000;

  // Count memories created in the density window
  const recentCount = recentMemories.filter(m => {
    const age = now - new Date(m.createdAt).getTime();
    return age < windowMs;
  }).length;

  // Adaptive adjustment: more recent memories = higher threshold
  if (recentCount <= 2) {
    // Low density: lower threshold slightly (more receptive)
    return Math.max(MIN_SURPRISE_THRESHOLD, baseThreshold - 0.1);
  }
  if (recentCount >= DENSITY_SOFT_CAP) {
    // High density: raise threshold significantly (more selective)
    const excess = recentCount - DENSITY_SOFT_CAP;
    const raise = Math.min(0.25, excess * 0.05);
    return Math.min(MAX_SURPRISE_THRESHOLD, baseThreshold + raise);
  }

  // Normal density: use base threshold
  return baseThreshold;
}

/**
 * Decide whether an event is surprising enough to auto-capture as a memory.
 *
 * Returns a decision object with:
 * - capture: boolean (should we store this?)
 * - expectedness: the computed expectedness score
 * - threshold: the threshold that was applied
 * - reason: human-readable explanation of the decision
 * - encodingStrength: if capturing, how strong should the encoding be?
 */
export function shouldAutoCapture(
  event: PredictionEvent,
  expectedness: number,
  recentMemories: Array<{ createdAt: string }>,
  baseThreshold: number = DEFAULT_SURPRISE_THRESHOLD,
): {
  capture: boolean;
  expectedness: number;
  threshold: number;
  reason: string;
  encodingStrength: number;
} {
  const threshold = computeAdaptiveThreshold(recentMemories, baseThreshold);

  // Surprise = 1 - expectedness
  // We capture when expectedness is BELOW the threshold
  // (i.e., the event is surprising enough)
  if (expectedness >= threshold) {
    return {
      capture: false,
      expectedness,
      threshold,
      reason: `Expected event (${expectedness.toFixed(2)} >= threshold ${threshold.toFixed(2)})`,
      encodingStrength: 0,
    };
  }

  // Override: critical events always get captured regardless of expectedness
  if (event.severity === 'high') {
    return {
      capture: true,
      expectedness,
      threshold,
      reason: 'High severity event -- always capture',
      encodingStrength: 1.5,
    };
  }

  // Compute encoding strength: more surprising = stronger encoding
  // This mirrors dopamine's role in modulating memory encoding
  let encodingStrength: number;
  if (expectedness < HIGH_SURPRISE_CUTOFF) {
    // Highly surprising: strong encoding
    encodingStrength = 1.3;
  } else if (expectedness < threshold * 0.5) {
    // Moderately surprising: normal encoding
    encodingStrength = 1.1;
  } else {
    // Mildly surprising (just below threshold): weak encoding
    encodingStrength = 0.9;
  }

  return {
    capture: true,
    expectedness,
    threshold,
    reason: `Surprising event (${expectedness.toFixed(2)} < threshold ${threshold.toFixed(2)})`,
    encodingStrength,
  };
}

// ── Surprise Memory Creation ─────────────────────────────────────

/**
 * Classify the valence of a surprising event:
 * - Negative surprise (expected success, got failure) -> pain
 * - Positive surprise (expected failure or neutral, got success) -> win
 * - Neutral surprise (unexpected but neither good nor bad) -> fact
 */
function classifyValence(event: PredictionEvent): MemoryType {
  if (event.valence === 'negative') return 'pain';
  if (event.valence === 'positive') return 'win';

  // Infer from category if valence not explicitly set
  if (event.category === 'error') return 'pain';
  if (event.category === 'tool_result' && event.outcomeClass === 'failure') return 'pain';
  if (event.category === 'tool_result' && event.outcomeClass === 'unexpected_success') return 'win';

  return 'fact';
}

/**
 * Determine severity for a surprise memory based on the event
 * and how surprising it was.
 */
function classifySeverity(event: PredictionEvent, expectedness: number): MemorySeverity {
  // Explicit severity from the event takes priority
  if (event.severity) return event.severity;

  // Very surprising events get bumped up
  if (expectedness < 0.1) return 'high';
  if (expectedness < 0.3) return 'medium';
  return 'low';
}

/**
 * Generate a Memory-compatible object from a surprising event.
 *
 * The memory includes:
 * - Type based on valence (pain/win/fact)
 * - Title that captures what was surprising
 * - Content with full context
 * - Rule that captures the lesson (if we can infer one)
 * - Tags from the event context
 * - Quality score based on surprise level
 */
export function createSurpriseMemory(
  event: PredictionEvent,
  expectedness: number,
  encodingStrength: number,
  context: { sessionId?: string; activeTaskId?: string; activeTaskTitle?: string },
): Omit<Memory, 'id' | 'projectId' | 'createdAt' | 'links'> & { predictionError: number } {
  const type = classifyValence(event);
  const severity = classifySeverity(event, expectedness);
  const predictionError = 1 - expectedness;

  // Build title
  let title: string;
  if (event.title) {
    title = event.title;
  } else {
    const valenceWord = type === 'pain' ? 'Unexpected failure'
      : type === 'win' ? 'Unexpected success'
      : 'Unexpected observation';
    title = `${valenceWord}: ${event.description.slice(0, 80)}`;
  }

  // Build content with context
  const contentParts: string[] = [event.description];
  if (context.activeTaskTitle) {
    contentParts.push(`During task: ${context.activeTaskTitle}`);
  }
  if (event.details) {
    contentParts.push(event.details);
  }
  contentParts.push(`Prediction error: ${predictionError.toFixed(2)} (expectedness: ${expectedness.toFixed(2)})`);

  // Build rule (lesson) -- only for pain and win
  let rule = '';
  if (type === 'pain' && event.lesson) {
    rule = event.lesson;
  } else if (type === 'win' && event.lesson) {
    rule = event.lesson;
  } else if (type === 'pain') {
    rule = `Watch for: ${event.description.slice(0, 120)}`;
  } else if (type === 'win') {
    rule = `Pattern that worked: ${event.description.slice(0, 120)}`;
  }

  // Build tags
  const tags = [...(event.tags ?? [])];
  tags.push('auto-surprise');
  if (event.category === 'error') tags.push('error-pattern');
  if (event.category === 'tool_result') tags.push(`tool:${event.toolName ?? 'unknown'}`);

  // Quality score: higher prediction error = higher quality (more informative)
  // But cap it -- even very surprising events need content quality
  const qualityScore = Math.min(0.9, 0.3 + predictionError * 0.5);

  return {
    type,
    title,
    content: contentParts.join('\n'),
    rule,
    tags: Array.from(new Set(tags)),
    severity,
    synapticStrength: encodingStrength,
    accessCount: 0,
    qualityScore,
    predictionError,
    // Optional fields
    relatedTaskId: context.activeTaskId,
  };
}

// ── Expectation Model Update ─────────────────────────────────────

/**
 * Update the expectation model after processing an event.
 *
 * This implements simple frequency-based learning:
 * - Increment the count for this event signature
 * - Update the last-seen timestamp
 * - Increment total event count
 * - Prune old entries if the model gets too large
 *
 * Pure function: returns a new model, does not mutate input.
 */
export function updateExpectations(
  event: PredictionEvent,
  model: ExpectationModel,
): ExpectationModel {
  const signature = createEventSignature(event);
  const now = new Date().toISOString();

  const existing = model.frequencies[signature];
  const updatedFrequencies = {
    ...model.frequencies,
    [signature]: {
      count: (existing?.count ?? 0) + 1,
      lastSeen: now,
      firstSeen: existing?.firstSeen ?? now,
    },
  };

  let result: ExpectationModel = {
    frequencies: updatedFrequencies,
    totalEvents: model.totalEvents + 1,
    lastUpdated: now,
  };

  // Prune if over capacity
  if (Object.keys(result.frequencies).length > MAX_FREQUENCY_ENTRIES) {
    result = pruneExpectationModel(result);
  }

  return result;
}

/**
 * Prune the expectation model by removing the oldest, least-frequent entries.
 *
 * Uses a composite score of recency and frequency to decide what to keep.
 * Keeps the top 80% of entries by score.
 */
export function pruneExpectationModel(model: ExpectationModel): ExpectationModel {
  const now = Date.now();
  const entries = Object.entries(model.frequencies);

  // Score each entry: recent + frequent = higher score
  const scored = entries.map(([sig, entry]) => {
    const daysSince = (now - new Date(entry.lastSeen).getTime()) / 86_400_000;
    const recency = Math.exp(-0.05 * daysSince);
    const frequency = Math.log2(entry.count + 1);
    return { sig, entry, score: recency * 0.6 + frequency * 0.4 };
  });

  // Sort by score descending, keep top 80%
  scored.sort((a, b) => b.score - a.score);
  const keepCount = Math.floor(scored.length * 0.8);
  const kept = scored.slice(0, keepCount);

  const frequencies: ExpectationModel['frequencies'] = {};
  for (const { sig, entry } of kept) {
    frequencies[sig] = entry;
  }

  return {
    frequencies,
    totalEvents: model.totalEvents,
    lastUpdated: model.lastUpdated,
  };
}

/**
 * Apply time decay to the entire expectation model.
 *
 * Called at session start (analogous to how brain state decay works).
 * Reduces all frequency counts based on time since last seen.
 * Removes entries that have decayed below a minimum threshold.
 */
export function decayExpectationModel(model: ExpectationModel): ExpectationModel {
  const now = Date.now();
  const frequencies: ExpectationModel['frequencies'] = {};
  let pruned = 0;

  for (const [sig, entry] of Object.entries(model.frequencies)) {
    const daysSince = (now - new Date(entry.lastSeen).getTime()) / 86_400_000;
    const decayedCount = entry.count * Math.exp(-FREQUENCY_DECAY_RATE * daysSince);

    // Remove entries that have decayed below 0.5 (effectively forgotten)
    if (decayedCount < 0.5) {
      pruned++;
      continue;
    }

    frequencies[sig] = {
      ...entry,
      count: Math.round(decayedCount * 100) / 100, // Keep 2 decimal places
    };
  }

  return {
    frequencies,
    totalEvents: model.totalEvents,
    lastUpdated: new Date().toISOString(),
  };
}

// ── Full Pipeline Integration ────────────────────────────────────

/**
 * Process a single event through the full prediction-error pipeline.
 *
 * This is the main entry point for the auto-capture system.
 * Call this whenever a significant event occurs (tool result, error,
 * user message pattern, task completion, etc.).
 *
 * Returns:
 * - updatedModel: the expectation model with this event incorporated
 * - captureResult: whether to capture and the memory data if so
 */
export function processPredictionEvent(
  event: PredictionEvent,
  model: ExpectationModel,
  recentMemories: Array<{ createdAt: string }>,
  sessionContext: {
    sessionId?: string;
    activeTaskId?: string;
    activeTaskTitle?: string;
    sessionMessageCount: number;
  },
): {
  updatedModel: ExpectationModel;
  captureResult: {
    capture: boolean;
    expectedness: number;
    threshold: number;
    reason: string;
    memory: ReturnType<typeof createSurpriseMemory> | null;
  };
} {
  // 1. Estimate expectedness
  const expectedness = estimateExpectedness(event, model, {
    recentMemoryCount: recentMemories.length,
    sessionMessageCount: sessionContext.sessionMessageCount,
  });

  // 2. Decide whether to capture
  const decision = shouldAutoCapture(event, expectedness, recentMemories);

  // 3. Update the model (always, regardless of capture decision)
  const updatedModel = updateExpectations(event, model);

  // 4. Create memory if capturing
  let memory: ReturnType<typeof createSurpriseMemory> | null = null;
  if (decision.capture) {
    memory = createSurpriseMemory(event, expectedness, decision.encodingStrength, {
      sessionId: sessionContext.sessionId,
      activeTaskId: sessionContext.activeTaskId,
      activeTaskTitle: sessionContext.activeTaskTitle,
    });
  }

  return {
    updatedModel,
    captureResult: {
      capture: decision.capture,
      expectedness,
      threshold: decision.threshold,
      reason: decision.reason,
      memory,
    },
  };
}

// ── Event Constructors ───────────────────────────────────────────
// Helper functions to create well-typed PredictionEvents from
// various sources. These are the integration points for the MCP server.

/**
 * Create a prediction event from a tool call result.
 */
export function toolResultEvent(
  toolName: string,
  success: boolean,
  description: string,
  opts?: {
    details?: string;
    tags?: string[];
    lesson?: string;
    errorClass?: string;
  },
): PredictionEvent {
  return {
    category: 'tool_result',
    toolName,
    outcomeClass: success ? 'success' : 'failure',
    description,
    details: opts?.details,
    tags: opts?.tags,
    lesson: opts?.lesson,
    valence: success ? 'positive' : 'negative',
    errorClass: opts?.errorClass,
  };
}

/**
 * Create a prediction event from an error.
 */
export function errorEvent(
  errorClass: string,
  description: string,
  opts?: {
    details?: string;
    tags?: string[];
    lesson?: string;
    severity?: MemorySeverity;
  },
): PredictionEvent {
  return {
    category: 'error',
    errorClass,
    description,
    details: opts?.details,
    tags: opts?.tags,
    lesson: opts?.lesson,
    valence: 'negative',
    severity: opts?.severity,
  };
}

/**
 * Create a prediction event from a task outcome.
 */
export function taskOutcomeEvent(
  outcome: 'success' | 'partial' | 'failure',
  taskTitle: string,
  description: string,
  opts?: {
    details?: string;
    tags?: string[];
    lesson?: string;
  },
): PredictionEvent {
  return {
    category: 'tool_result',
    subcategory: 'task_outcome',
    toolName: 'task_completion',
    outcomeClass: outcome === 'success' ? 'success'
      : outcome === 'failure' ? 'failure'
      : 'unexpected_success',
    description: `${taskTitle}: ${description}`,
    details: opts?.details,
    tags: opts?.tags,
    lesson: opts?.lesson,
    valence: outcome === 'failure' ? 'negative'
      : outcome === 'success' ? 'positive'
      : 'neutral',
  };
}

/**
 * Create a prediction event from a user behavior pattern.
 */
export function userPatternEvent(
  patternType: string,
  description: string,
  opts?: {
    details?: string;
    tags?: string[];
    valence?: 'positive' | 'negative' | 'neutral';
  },
): PredictionEvent {
  return {
    category: 'user_pattern',
    patternType,
    description,
    details: opts?.details,
    tags: opts?.tags,
    valence: opts?.valence ?? 'neutral',
  };
}

/**
 * Create a prediction event from a build/compile result.
 */
export function buildResultEvent(
  success: boolean,
  description: string,
  opts?: {
    errorClass?: string;
    details?: string;
    tags?: string[];
    lesson?: string;
  },
): PredictionEvent {
  return {
    category: 'tool_result',
    subcategory: 'build',
    toolName: 'build',
    outcomeClass: success ? 'success' : 'failure',
    description,
    details: opts?.details,
    tags: [...(opts?.tags ?? []), 'build', 'compilation'],
    lesson: opts?.lesson,
    valence: success ? 'positive' : 'negative',
    errorClass: opts?.errorClass,
  };
}
