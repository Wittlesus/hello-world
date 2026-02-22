import type { ApprovalRequest, ApprovalTier, ApprovalStatus } from '../types.js';
import { ApprovalRequestSchema } from '../types.js';
import { generateId, now } from '../utils.js';

/** Default tier assignments for common actions */
const DEFAULT_TIERS: Record<string, ApprovalTier> = {
  // Auto-approve: safe, reversible
  read_file: 'auto',
  list_directory: 'auto',
  git_status: 'auto',
  git_diff: 'auto',
  git_log: 'auto',
  run_command_build: 'auto',
  run_command_test: 'auto',

  // Notify: human sees it, can intervene
  write_file: 'notify',
  git_commit: 'notify',
  run_command: 'notify',

  // Block: requires explicit approval
  git_push: 'block',
  delete_file: 'block',
  deploy: 'block',
  architecture_decision: 'block',
  security_change: 'block',
};

export class ApprovalGates {
  private pending: Map<string, ApprovalRequest> = new Map();
  private resolved: ApprovalRequest[] = [];
  private tierOverrides: Record<string, ApprovalTier> = {};

  constructor(overrides?: Record<string, ApprovalTier>) {
    if (overrides) this.tierOverrides = overrides;
  }

  classifyAction(action: string): ApprovalTier {
    return this.tierOverrides[action] ?? DEFAULT_TIERS[action] ?? 'notify';
  }

  requestApproval(action: string, description: string, context = '', options: string[] = []): ApprovalRequest {
    const tier = this.classifyAction(action);

    // Auto-approve immediately
    if (tier === 'auto') {
      const request = ApprovalRequestSchema.parse({
        id: generateId('apr'),
        action,
        description,
        tier,
        status: 'approved',
        options,
        context,
        resolution: 'auto-approved',
        resolvedAt: now(),
        createdAt: now(),
      });
      this.resolved.push(request);
      return request;
    }

    const request = ApprovalRequestSchema.parse({
      id: generateId('apr'),
      action,
      description,
      tier,
      options,
      context,
      createdAt: now(),
    });

    this.pending.set(request.id, request);
    return request;
  }

  resolveApproval(
    requestId: string,
    decision: 'approved' | 'rejected',
    notes = '',
  ): ApprovalRequest {
    const request = this.pending.get(requestId);
    if (!request) throw new Error(`Approval request not found: ${requestId}`);

    const resolved: ApprovalRequest = {
      ...request,
      status: decision as ApprovalStatus,
      resolution: notes,
      resolvedAt: now(),
    };

    this.pending.delete(requestId);
    this.resolved.push(resolved);
    return resolved;
  }

  getPending(): ApprovalRequest[] {
    return [...this.pending.values()];
  }

  getResolved(): ApprovalRequest[] {
    return [...this.resolved];
  }

  isBlocked(action: string): boolean {
    return this.classifyAction(action) === 'block';
  }
}
