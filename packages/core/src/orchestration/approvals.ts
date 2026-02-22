import type { ApprovalRequest, ApprovalTier, ApprovalStatus } from '../types.js';
import { ApprovalRequestSchema } from '../types.js';
import { JsonStore } from '../storage.js';
import { generateId, now } from '../utils.js';

const DEFAULT_TIERS: Record<string, ApprovalTier> = {
  read_file: 'auto',
  list_directory: 'auto',
  git_status: 'auto',
  git_diff: 'auto',
  git_log: 'auto',
  run_command_build: 'auto',
  run_command_test: 'auto',
  write_file: 'notify',
  git_commit: 'notify',
  run_command: 'notify',
  git_push: 'block',
  delete_file: 'block',
  deploy: 'block',
  architecture_decision: 'block',
  security_change: 'block',
};

interface ApprovalsData {
  pending: ApprovalRequest[];
  resolved: ApprovalRequest[];
}

export class ApprovalGates {
  private store: JsonStore<ApprovalsData>;
  private tierOverrides: Record<string, ApprovalTier>;

  constructor(projectRoot: string, overrides?: Record<string, ApprovalTier>) {
    this.store = new JsonStore<ApprovalsData>(projectRoot, 'approvals.json', { pending: [], resolved: [] });
    this.tierOverrides = overrides ?? {};
  }

  classifyAction(action: string): ApprovalTier {
    return this.tierOverrides[action] ?? DEFAULT_TIERS[action] ?? 'notify';
  }

  requestApproval(action: string, description: string, context = '', options: string[] = []): ApprovalRequest {
    const tier = this.classifyAction(action);

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
      this.store.update((d) => ({ ...d, resolved: [...d.resolved, request] }));
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

    this.store.update((d) => ({ ...d, pending: [...d.pending, request] }));
    return request;
  }

  resolveApproval(requestId: string, decision: 'approved' | 'rejected', notes = ''): ApprovalRequest {
    const data = this.store.read();
    const request = data.pending.find((r) => r.id === requestId);
    if (!request) throw new Error(`Approval request not found: ${requestId}`);

    const resolved: ApprovalRequest = {
      ...request,
      status: decision as ApprovalStatus,
      resolution: notes,
      resolvedAt: now(),
    };

    this.store.update((d) => ({
      pending: d.pending.filter((r) => r.id !== requestId),
      resolved: [...d.resolved, resolved],
    }));

    return resolved;
  }

  getPending(): ApprovalRequest[] {
    return this.store.read().pending;
  }

  getResolved(): ApprovalRequest[] {
    return this.store.read().resolved;
  }

  isBlocked(action: string): boolean {
    return this.classifyAction(action) === 'block';
  }
}
