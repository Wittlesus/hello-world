import { useMemo } from 'react';
import { useActivityStore, type ApprovalItem } from '../stores/activity';

const TIER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  block:  { bg: 'bg-red-900/40',    text: 'text-red-400',    label: 'Block' },
  notify: { bg: 'bg-yellow-900/40', text: 'text-yellow-400', label: 'Notify' },
  auto:   { bg: 'bg-green-900/40',  text: 'text-green-400',  label: 'Auto' },
};

function TierBadge({ tier }: { tier: string }) {
  const style = TIER_STYLES[tier] ?? TIER_STYLES.notify;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

function ApprovalCard({ item }: { item: ApprovalItem }) {
  const resolveApproval = useActivityStore((s) => s.resolveApproval);

  return (
    <div className="flex items-center gap-3 bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 min-w-[260px] max-w-[340px] shrink-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-gray-200 truncate">{item.action}</span>
          <TierBadge tier={item.tier} />
        </div>
        <p className="text-[11px] text-gray-500 truncate" title={item.description}>
          {item.description}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => resolveApproval(item.id, 'approved')}
          className="px-2.5 py-1 text-xs font-medium rounded bg-green-800/50 text-green-300 hover:bg-green-700/60 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => resolveApproval(item.id, 'rejected')}
          className="px-2.5 py-1 text-xs font-medium rounded bg-red-800/50 text-red-300 hover:bg-red-700/60 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export function ApprovalQueue() {
  const approvals = useActivityStore((s) => s.approvals);

  const pending = useMemo(
    () => approvals.filter((a) => a.status === 'pending'),
    [approvals],
  );

  if (pending.length === 0) {
    return (
      <div className="h-8 flex items-center px-4 bg-[#111118] border-t border-gray-800">
        <span className="text-xs text-gray-600">No pending approvals. When Claude needs to take a sensitive action (git push, deploy, delete), it will appear here for your decision.</span>
      </div>
    );
  }

  return (
    <div className="bg-[#111118] border-t border-gray-800">
      <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto min-w-0">
        <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-700/60 text-[11px] font-bold text-amber-200">
          {pending.length}
        </span>

        {pending.map((item) => (
          <ApprovalCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
