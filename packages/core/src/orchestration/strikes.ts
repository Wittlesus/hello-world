/**
 * Two-Strike Engine
 *
 * Tracks error patterns per task. Same error class twice = HALT.
 * This is a system-level constraint, not a suggestion.
 */

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

export class TwoStrikeEngine {
  private strikes: Map<string, Strike[]> = new Map();

  /**
   * Classify an error into a class based on type + affected area.
   * Same class = same type of failure in the same area.
   */
  private classifyError(errorMessage: string, affectedFile?: string): string {
    const type = this.detectErrorType(errorMessage);
    const area = affectedFile ?? 'unknown';
    return `${type}:${area}`;
  }

  private detectErrorType(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('compile') || lower.includes('syntax') || lower.includes('ts(')) return 'compile';
    if (lower.includes('test') || lower.includes('assert') || lower.includes('expect')) return 'test';
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

    const existing = this.strikes.get(key) ?? [];
    existing.push({
      errorClass,
      errorMessage,
      approach,
      timestamp: new Date().toISOString(),
    });
    this.strikes.set(key, existing);

    return {
      count: existing.length,
      shouldHalt: existing.length >= 2,
      history: [...existing],
    };
  }

  checkStrikes(taskId: string): StrikeCheck {
    // Find the worst (most strikes) error class for this task
    let worst: StrikeCheck = { count: 0, shouldHalt: false, history: [] };

    for (const [key, strikes] of this.strikes) {
      if (key.startsWith(`${taskId}:`)) {
        if (strikes.length > worst.count) {
          worst = { count: strikes.length, shouldHalt: strikes.length >= 2, history: [...strikes] };
        }
      }
    }

    return worst;
  }

  resetStrikes(taskId: string): void {
    for (const key of this.strikes.keys()) {
      if (key.startsWith(`${taskId}:`)) {
        this.strikes.delete(key);
      }
    }
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
    lines.push('');
    lines.push('STOP. Present 2-3 fundamentally different approaches to Pat.');
    return lines.join('\n');
  }
}
