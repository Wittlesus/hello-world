/**
 * Workflow Engine — state machine implementing SCOPE → PLAN → BUILD → VERIFY → SHIP
 */

import type { WorkflowPhase, WorkflowState } from '../types.js';
import { WorkflowStateSchema } from '../types.js';
import { now } from '../utils.js';

type TransitionResult = { ok: true; state: WorkflowState } | { ok: false; reason: string };

const VALID_TRANSITIONS: Record<string, WorkflowPhase[]> = {
  idle: ['scope'],
  scope: ['plan', 'build'],            // small tasks skip plan
  plan: ['build'],
  build: ['verify', 'waiting_approval'],
  verify: ['ship', 'build', 'blocked'], // test fail → back to build (strike++)
  ship: ['idle'],
  waiting_approval: ['build', 'scope', 'idle', 'blocked'],
  blocked: ['idle'],                     // only Pat can unblock (reset + new direction)
};

export class WorkflowEngine {
  private state: WorkflowState;

  constructor(initial?: Partial<WorkflowState>) {
    this.state = WorkflowStateSchema.parse(initial ?? {});
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  getPhase(): WorkflowPhase {
    return this.state.phase;
  }

  transition(to: WorkflowPhase): TransitionResult {
    const valid = VALID_TRANSITIONS[this.state.phase];
    if (!valid?.includes(to)) {
      return { ok: false, reason: `Cannot transition from '${this.state.phase}' to '${to}'` };
    }

    this.state = { ...this.state, phase: to };

    // Reset autonomous timer on phase change
    if (to === 'build') {
      this.state.autonomousStartedAt = now();
    }

    // Reset strikes when moving to new task
    if (to === 'scope' || to === 'idle') {
      this.state.strikes = 0;
      this.state.lastStrikeError = undefined;
    }

    return { ok: true, state: this.getState() };
  }

  assignTask(taskId: string): TransitionResult {
    this.state.currentTaskId = taskId;
    return this.transition('scope');
  }

  recordStrike(errorMessage: string): void {
    this.state.strikes += 1;
    this.state.lastStrikeError = errorMessage;

    if (this.state.strikes >= 2) {
      this.state.phase = 'blocked';
    }
  }

  /**
   * Check autonomous timer. Returns minutes elapsed since build started.
   * Warns at 15 min, halts at 20 min.
   */
  checkAutonomousTimer(): { minutesElapsed: number; warn: boolean; halt: boolean } {
    if (!this.state.autonomousStartedAt) {
      return { minutesElapsed: 0, warn: false, halt: false };
    }

    const elapsed = (Date.now() - new Date(this.state.autonomousStartedAt).getTime()) / 60000;
    return {
      minutesElapsed: Math.floor(elapsed),
      warn: elapsed >= 15,
      halt: elapsed >= 20,
    };
  }

  resetAutonomousTimer(): void {
    this.state.autonomousStartedAt = now();
  }

  updateContextUsage(percent: number): void {
    this.state.contextUsagePercent = percent;
  }

  isBlocked(): boolean {
    return this.state.phase === 'blocked';
  }

  isWaitingApproval(): boolean {
    return this.state.phase === 'waiting_approval';
  }
}
