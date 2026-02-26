/**
 * Two-Strike Engine
 *
 * Tracks error patterns per task. Same error class twice = HALT.
 * Persisted to strikes.json so the rule fires across MCP server restarts.
 */

import { JsonStore } from '../storage.js';
import { now } from '../utils.js';

export interface Strike {
  errorClass: string;
  errorMessage: string;
  approach: string;
  timestamp: string;
}

export interface StrikeCheck {
  count: number;
  shouldHalt: boolean;
  history: Strike[];
}

interface StrikesData {
  strikes: Record<string, Strike[]>; // key: "taskId:errorClass"
}

export class TwoStrikeEngine {
  private store: JsonStore<StrikesData>;

  constructor(projectRoot: string) {
    this.store = new JsonStore<StrikesData>(projectRoot, 'strikes.json', { strikes: {} });
  }

  private classifyError(errorMessage: string, affectedFile?: string): string {
    const type = this.detectErrorType(errorMessage);
    const area = affectedFile ?? 'unknown';
    return `${type}:${area}`;
  }

  private detectErrorType(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('compile') || lower.includes('syntax') || lower.includes('ts('))
      return 'compile';
    if (lower.includes('test') || lower.includes('assert') || lower.includes('expect'))
      return 'test';
    if (lower.includes('timeout')) return 'timeout';
    if (lower.includes('permission') || lower.includes('eacces')) return 'permission';
    if (lower.includes('not found') || lower.includes('enoent')) return 'not_found';
    if (lower.includes('network') || lower.includes('econnrefused')) return 'network';
    return 'runtime';
  }

  recordFailure(
    taskId: string,
    errorMessage: string,
    approach: string,
    affectedFile?: string,
  ): StrikeCheck {
    const errorClass = this.classifyError(errorMessage, affectedFile);
    const key = `${taskId}:${errorClass}`;

    const data = this.store.update((d) => {
      const existing = d.strikes[key] ?? [];
      existing.push({ errorClass, errorMessage, approach, timestamp: now() });
      return { strikes: { ...d.strikes, [key]: existing } };
    });

    const strikes = data.strikes[key];
    return { count: strikes.length, shouldHalt: strikes.length >= 2, history: [...strikes] };
  }

  checkStrikes(taskId: string): StrikeCheck {
    const data = this.store.read();
    let worst: StrikeCheck = { count: 0, shouldHalt: false, history: [] };

    for (const [key, strikes] of Object.entries(data.strikes)) {
      if (key.startsWith(`${taskId}:`) && strikes.length > worst.count) {
        worst = { count: strikes.length, shouldHalt: strikes.length >= 2, history: [...strikes] };
      }
    }

    return worst;
  }

  resetStrikes(taskId: string): void {
    this.store.update((d) => {
      const filtered = Object.fromEntries(
        Object.entries(d.strikes).filter(([key]) => !key.startsWith(`${taskId}:`)),
      );
      return { strikes: filtered };
    });
  }

  getAlternatives(taskId: string): string {
    const check = this.checkStrikes(taskId);
    if (check.history.length === 0) return 'No failures recorded.';

    const lines = [
      `TWO-STRIKE HALT: ${check.count} failures on same error class.`,
      '',
      'Attempts:',
    ];
    for (const s of check.history) {
      lines.push(`  ${s.timestamp}: "${s.approach}"`);
      lines.push(`    Error: ${s.errorMessage.slice(0, 200)}`);
    }
    lines.push('', 'STOP. Present 2-3 fundamentally different approaches to Pat.');
    return lines.join('\n');
  }
}
