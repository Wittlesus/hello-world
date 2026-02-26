/**
 * Types for the prediction-error auto-capture system.
 *
 * These types define:
 * - PredictionEvent: an event that can be evaluated for surprise
 * - ExpectationModel: the brain's learned expectations (stored in BrainState)
 * - EventSignature: a string fingerprint that groups similar events
 */

import type { MemorySeverity } from '../types.js';

// ── Event Signature ──────────────────────────────────────────────

/**
 * A string fingerprint that identifies the "class" of an event.
 * Two events with the same signature are considered the same kind of thing.
 *
 * Format: "category::subcategory::detail"
 * Examples:
 *   "error::TypeError"
 *   "tool_result::npm_install::failure"
 *   "user_pattern::scope_change"
 */
export type EventSignature = string;

// ── Prediction Event ─────────────────────────────────────────────

/**
 * An event that the prediction system can evaluate for surprise.
 *
 * Events come from various sources:
 * - Tool call results (success/failure of MCP tool calls)
 * - Errors (build failures, runtime errors)
 * - User behavior patterns (repeated questions, scope changes)
 * - Task outcomes (completion, blocking, unexpected difficulty)
 */
export interface PredictionEvent {
  /** Primary category: what kind of event is this? */
  category: 'error' | 'tool_result' | 'user_pattern' | 'system';

  /** Optional sub-category for finer-grained fingerprinting */
  subcategory?: string;

  /** Human-readable description of what happened */
  description: string;

  /** Optional detailed context (error stack, full output, etc.) */
  details?: string;

  /** Optional explicit title for the memory (if captured) */
  title?: string;

  /** Optional lesson learned (becomes the memory's rule field) */
  lesson?: string;

  /** Tags to apply to the memory if captured */
  tags?: string[];

  /** Explicit severity override */
  severity?: MemorySeverity;

  /**
   * Emotional valence of the event:
   * - positive: something good happened (unexpected success)
   * - negative: something bad happened (unexpected failure)
   * - neutral: neither good nor bad (unexpected but informational)
   */
  valence?: 'positive' | 'negative' | 'neutral';

  // ── Category-specific fields ─────────────────────────────────

  /** For errors: the class/type of error (e.g., "TypeError", "ENOENT") */
  errorClass?: string;

  /** For tool results: which tool was called */
  toolName?: string;

  /** For tool results: coarse outcome class */
  outcomeClass?: 'success' | 'failure' | 'unexpected_success' | 'partial';

  /** For user patterns: what kind of pattern (e.g., "scope_change", "repeated_question") */
  patternType?: string;
}

// ── Expectation Model ────────────────────────────────────────────

/**
 * A single frequency entry for an event signature.
 */
export interface FrequencyEntry {
  /** How many times this event signature has been observed */
  count: number;
  /** When this event was last seen */
  lastSeen: string;
  /** When this event was first seen */
  firstSeen: string;
}

/**
 * The brain's learned expectations.
 *
 * This is a simple frequency model: events that have been seen
 * many times are expected; events never seen before are surprising.
 *
 * Stored as part of BrainState (in brain-state.json).
 */
export interface ExpectationModel {
  /** Frequency counts by event signature */
  frequencies: Record<EventSignature, FrequencyEntry>;
  /** Total number of events processed (for proportion calculation) */
  totalEvents: number;
  /** When the model was last updated */
  lastUpdated: string;
}
