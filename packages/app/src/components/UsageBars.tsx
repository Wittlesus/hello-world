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

export function UsageBars({ collapsed }: { collapsed: boolean }) {
  const projectPath = useProjectPath();
  const { data: qwenData } = useTauriData<QwenUsageFile>('get_usage', projectPath);
  const { data: brainData } = useTauriData<BrainState>('get_brain_state', projectPath);
  const { data: claudeData } = useClaudeUsage(projectPath);

  const todayReqs = qwenData?.entries ? todayEntries(qwenData.entries).length : 0;
  const qwenPct = Math.min(100, (todayReqs / DAILY_LIMIT) * 100);
  const sessionMsgs = brainData?.state?.messageCount ?? 0;
  const totalCost = claudeData?.totalCostUsd ?? 0;
  const totalSessions = claudeData?.totalSessions ?? 0;

  // Color shifts as you approach the limit
  const qwenBarColor = qwenPct >= 80 ? 'bg-red-500/70' : qwenPct >= 50 ? 'bg-yellow-500/70' : 'bg-emerald-500/70';
  const qwenTextColor = qwenPct >= 80 ? 'text-red-400' : qwenPct >= 50 ? 'text-yellow-400' : 'text-emerald-400';

  if (collapsed) {
    return (
      <div
        className="border-t border-gray-800/60 px-3 py-2 shrink-0"
        title={`Claude: ${formatCost(totalCost)} total | Qwen: ${todayReqs}/${DAILY_LIMIT} | Session: ${sessionMsgs} msgs`}
      >
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full ${qwenBarColor} rounded-full transition-all`}
            style={{ width: `${qwenPct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-800/60 px-3 py-2 shrink-0 space-y-1.5">
      {/* Claude total cost */}
      {totalCost > 0 && (
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Claude</span>
            <span className="text-[9px] font-mono text-violet-400/80">
              {formatCost(totalCost)} / {totalSessions}s
            </span>
          </div>
        </div>
      )}

      {/* Qwen daily requests */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-gray-500 uppercase tracking-wider">Qwen</span>
          <span className={`text-[9px] font-mono ${qwenTextColor}`}>
            {todayReqs}/{DAILY_LIMIT}
          </span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full ${qwenBarColor} rounded-full transition-all`}
            style={{ width: `${qwenPct}%` }}
          />
        </div>
      </div>

      {/* Claude session activity */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-gray-500 uppercase tracking-wider">Session</span>
          <span className="text-[9px] font-mono text-violet-400/80">
            {sessionMsgs} msgs
          </span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full bg-violet-500/60 rounded-full transition-all"
            style={{ width: `${Math.min(100, (sessionMsgs / 50) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
