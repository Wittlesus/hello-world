/**
 * Workflow Engine — state machine implementing SCOPE → PLAN → BUILD → VERIFY → SHIP
 * Persisted to workflow.json so phase survives MCP server restarts.
 */

import { JsonStore } from '../storage.js';
import type { WorkflowPhase, WorkflowState } from '../types.js';
import { WorkflowStateSchema } from '../types.js';
import { now } from '../utils.js';

type TransitionResult = { ok: true; state: WorkflowState } | { ok: false; reason: string };

const VALID_TRANSITIONS: Record<string, WorkflowPhase[]> = {
  idle: ['scope'],
  scope: ['plan', 'build'],
  plan: ['build'],
  build: ['verify', 'waiting_approval'],
  verify: ['ship', 'build', 'blocked'],
  ship: ['idle'],
  waiting_approval: ['build', 'scope', 'idle', 'blocked'],
  blocked: ['idle'],
};

export class WorkflowEngine {
  private store: JsonStore<WorkflowState>;

  constructor(projectRoot: string) {
    const initial = WorkflowStateSchema.parse({});
    this.store = new JsonStore<WorkflowState>(projectRoot, 'workflow.json', initial);
  }

  getState(): WorkflowState {
    return { ...this.store.read() };
  }

  getPhase(): WorkflowPhase {
    return this.store.read().phase;
  }

  transition(to: WorkflowPhase): TransitionResult {
    const state = this.store.read();
    const valid = VALID_TRANSITIONS[state.phase];
    if (!valid?.includes(to)) {
      return { ok: false, reason: `Cannot transition from '${state.phase}' to '${to}'` };
    }

    const updated = this.store.update((s) => {
      const next = { ...s, phase: to };
      if (to === 'build') next.autonomousStartedAt = now();
      if (to === 'scope' || to === 'idle') {
        next.strikes = 0;
        next.lastStrikeError = undefined;
      }
      return next;
    });

    return { ok: true, state: { ...updated } };
  }

  assignTask(taskId: string): TransitionResult {
    this.store.update((s) => ({ ...s, currentTaskId: taskId }));
    return this.transition('scope');
  }

  recordStrike(errorMessage: string): void {
    this.store.update((s) => {
      const strikes = s.strikes + 1;
      return {
        ...s,
        strikes,
        lastStrikeError: errorMessage,
        phase: strikes >= 2 ? 'blocked' : s.phase,
      };
    });
  }

  checkAutonomousTimer(): { minutesElapsed: number; warn: boolean; halt: boolean } {
    const { autonomousStartedAt } = this.store.read();
    if (!autonomousStartedAt) return { minutesElapsed: 0, warn: false, halt: false };
    const elapsed = (Date.now() - new Date(autonomousStartedAt).getTime()) / 60000;
    return { minutesElapsed: Math.floor(elapsed), warn: elapsed >= 15, halt: elapsed >= 20 };
  }

  resetAutonomousTimer(): void {
    this.store.update((s) => ({ ...s, autonomousStartedAt: now() }));
  }

  updateContextUsage(percent: number): void {
    this.store.update((s) => ({ ...s, contextUsagePercent: percent }));
  }

  isBlocked(): boolean {
    return this.store.read().phase === 'blocked';
  }

  isWaitingApproval(): boolean {
    return this.store.read().phase === 'waiting_approval';
  }
}
