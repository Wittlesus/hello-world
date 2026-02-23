import { useMemo, useState } from 'react';
import { useActivityStore, type ApprovalItem } from '../stores/activity';

const TIER_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  block:  { bg: 'bg-red-900/50',    text: 'text-red-400',    border: 'border-red-800',    label: 'BLOCK' },
  notify: { bg: 'bg-yellow-900/50', text: 'text-yellow-400', border: 'border-yellow-800', label: 'NOTIFY' },
  auto:   { bg: 'bg-green-900/50',  text: 'text-green-400',  border: 'border-green-800',  label: 'AUTO' },
};

function TierBadge({ tier }: { tier: string }) {
  const style = TIER_STYLES[tier] ?? TIER_STYLES.notify;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase border ${style.bg} ${style.text} ${style.border}`}>
      {style.label}
    </span>
  );
}

interface ApprovalCardProps {
  item: ApprovalItem;
  confirmingId: string | null;
  confirmingAction: 'approve' | 'reject' | null;
  onConfirmStart: (id: string, action: 'approve' | 'reject') => void;
  onConfirmCancel: () => void;
  onConfirmExecute: () => void;
}

function ApprovalCard({
  item,
  confirmingId,
  confirmingAction,
  onConfirmStart,
  onConfirmCancel,
  onConfirmExecute,
}: ApprovalCardProps) {
  const isConfirming = confirmingId === item.id;

  return (
    <div className="flex items-center gap-3 bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 w-full max-w-xl">
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
        {isConfirming ? (
          <>
            <span className="text-[11px] text-gray-400 mr-1">
              {confirmingAction === 'approve' ? 'Approve?' : 'Reject?'}
            </span>
            <button
              onClick={onConfirmExecute}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                confirmingAction === 'approve'
                  ? 'bg-green-800/50 text-green-300 hover:bg-green-700/60'
                  : 'bg-red-800/50 text-red-300 hover:bg-red-700/60'
              }`}
            >
              Yes
            </button>
            <button
              onClick={onConfirmCancel}
              className="px-2.5 py-1 text-xs font-medium rounded bg-gray-700/50 text-gray-400 hover:bg-gray-600/60 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onConfirmStart(item.id, 'approve')}
              className="px-2.5 py-1 text-xs font-medium rounded bg-green-800/50 text-green-300 hover:bg-green-700/60 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => onConfirmStart(item.id, 'reject')}
              className="px-2.5 py-1 text-xs font-medium rounded bg-red-800/50 text-red-300 hover:bg-red-700/60 transition-colors"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ApprovalQueue({ standalone = false }: { standalone?: boolean }) {
  const approvals = useActivityStore((s) => s.approvals);
  const resolveApproval = useActivityStore((s) => s.resolveApproval);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<'approve' | 'reject' | null>(null);

  const pending = useMemo(
    () => approvals.filter((a) => a.status === 'pending'),
    [approvals],
  );

  function handleConfirmStart(id: string, action: 'approve' | 'reject') {
    setConfirmingId(id);
    setConfirmingAction(action);
  }

  function handleConfirmCancel() {
    setConfirmingId(null);
    setConfirmingAction(null);
  }

  function handleConfirmExecute() {
    if (!confirmingId || !confirmingAction) return;
    resolveApproval(confirmingId, confirmingAction === 'approve' ? 'approved' : 'rejected');
    setConfirmingId(null);
    setConfirmingAction(null);
  }

  // Standalone full-page view (Approvals tab)
  if (standalone) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Approvals</span>
          {pending.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-700/60 text-[11px] font-bold text-amber-200">
              {pending.length}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {pending.length === 0 ? (
            <p className="text-sm text-gray-600 text-center mt-16 max-w-sm mx-auto">
              No pending approvals. Claude will request approval here before git push, deploy, delete, or architecture changes.
            </p>
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl">
              {pending.map((item) => (
                <ApprovalCard
                  key={item.id}
                  item={item}
                  confirmingId={confirmingId}
                  confirmingAction={confirmingAction}
                  onConfirmStart={handleConfirmStart}
                  onConfirmCancel={handleConfirmCancel}
                  onConfirmExecute={handleConfirmExecute}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Bottom-bar overlay (always present in App layout)
  if (pending.length === 0) {
    return (
      <div className="h-8 flex items-center px-4 bg-[#111118] border-t border-gray-800">
        <span className="text-xs text-gray-600">No pending approvals.</span>
      </div>
    );
  }

  return (
    <div className="bg-[#111118] border-t border-gray-800">
      <div className="px-4 py-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-700/60 text-[11px] font-bold text-amber-200">
            {pending.length}
          </span>
          <span className="text-[11px] text-gray-500">pending approval{pending.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {pending.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              confirmingId={confirmingId}
              confirmingAction={confirmingAction}
              onConfirmStart={handleConfirmStart}
              onConfirmCancel={handleConfirmCancel}
              onConfirmExecute={handleConfirmExecute}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
