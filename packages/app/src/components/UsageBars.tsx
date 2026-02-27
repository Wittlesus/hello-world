import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { useClaudeUsage } from '../hooks/useClaudeUsage.js';

interface QwenEntry {
  timestamp: string;
  provider: string;
  totalTokens: number;
  costUsd: number;
  context?: string;
}

interface QwenUsageFile {
  entries: QwenEntry[];
  sessionStart?: string;
}

interface BrainState {
  state: {
    messageCount: number;
  };
}

const DAILY_LIMIT = 300;

function todayEntries(entries: QwenEntry[]): QwenEntry[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.toISOString();
  return entries.filter(e => e.timestamp >= cutoff);
}

function formatCost(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function barColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500/70';
  if (pct >= 50) return 'bg-yellow-500/70';
  return 'bg-sky-500/70';
}

function barTextColor(pct: number): string {
  if (pct >= 80) return 'text-red-400';
  if (pct >= 50) return 'text-yellow-400';
  return 'text-sky-400';
}

function MiniBar({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</span>
        <span className={`text-[9px] font-mono ${barTextColor(pct)}`}>{detail}</span>
      </div>
      <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full ${barColor(pct)} rounded-full transition-all`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function UsageBars({ collapsed }: { collapsed: boolean }) {
  const projectPath = useProjectPath();
  const { data: qwenData } = useTauriData<QwenUsageFile>('get_usage', projectPath);
  const { data: brainData } = useTauriData<BrainState>('get_brain_state', projectPath);
  const { data: claudeData } = useClaudeUsage(projectPath);

  const todayReqs = qwenData?.entries ? todayEntries(qwenData.entries).length : 0;
  const qwenPct = Math.min(100, (todayReqs / DAILY_LIMIT) * 100);
  const sessionMsgs = brainData?.state?.messageCount ?? 0;
  const web = claudeData?.webUsage;
  const sessionPct = web?.fiveHour.utilization ?? 0;
  const weeklyPct = web?.sevenDay.utilization ?? 0;
  const extraPct = web?.extraUsage?.utilization ?? 0;
  const extraSpent = web?.extraUsage ? `$${(web.extraUsage.usedCredits / 100).toFixed(0)}` : '';

  if (collapsed) {
    return (
      <div
        className="border-t border-gray-800/60 px-3 py-2 shrink-0"
        title={`Session: ${sessionPct}% | Weekly: ${weeklyPct}% | Extra: ${extraPct}% | Qwen: ${todayReqs}/${DAILY_LIMIT}`}
      >
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full ${barColor(sessionPct)} rounded-full transition-all`}
            style={{ width: `${Math.min(100, sessionPct)}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-800/60 px-3 py-2 shrink-0 space-y-1.5">
      {/* Claude.ai session limit */}
      {web && (
        <>
          <MiniBar label="Session" pct={sessionPct} detail={`${sessionPct}%`} />
          <MiniBar label="Weekly" pct={weeklyPct} detail={`${weeklyPct}%`} />
          {web.extraUsage && web.extraUsage.isEnabled && (
            <MiniBar label="Extra" pct={extraPct} detail={`${extraSpent} (${extraPct}%)`} />
          )}
        </>
      )}

      {/* Qwen daily requests */}
      <MiniBar label="Qwen" pct={qwenPct} detail={`${todayReqs}/${DAILY_LIMIT}`} />

      {/* Session messages */}
      <MiniBar
        label="Msgs"
        pct={Math.min(100, (sessionMsgs / 50) * 100)}
        detail={`${sessionMsgs}`}
      />
    </div>
  );
}
