import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';

interface UsageEntry {
  provider: 'claude' | 'qwen';
  totalTokens: number;
  costUsd: number;
  timestamp: string;
}

interface UsageFile {
  entries: UsageEntry[];
  sessionStart?: string;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function UsageBars({ collapsed }: { collapsed: boolean }) {
  const projectPath = useProjectPath();
  const { data } = useTauriData<UsageFile>('get_usage', projectPath);

  if (!data?.entries?.length) return null;

  let qwenCost = 0;
  let claudeCost = 0;
  let qwenTokens = 0;
  let claudeTokens = 0;

  for (const e of data.entries) {
    if (e.provider === 'qwen') {
      qwenCost += e.costUsd;
      qwenTokens += e.totalTokens;
    } else {
      claudeCost += e.costUsd;
      claudeTokens += e.totalTokens;
    }
  }

  const totalCost = qwenCost + claudeCost;
  const totalTokens = qwenTokens + claudeTokens;
  const qwenPct = totalTokens > 0 ? (qwenTokens / totalTokens) * 100 : 0;

  if (collapsed) {
    return (
      <div
        className="border-t border-gray-800/60 px-3 py-2 shrink-0"
        title={`Total: ${formatCost(totalCost)} | Qwen: ${formatTokens(qwenTokens)} | Claude: ${formatTokens(claudeTokens)}`}
      >
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full bg-emerald-500/70 rounded-full transition-all"
            style={{ width: `${qwenPct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-800/60 px-3 py-2 shrink-0 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-gray-500 uppercase tracking-wider">Usage</span>
        <span className="text-[9px] font-mono text-gray-400">{formatCost(totalCost)}</span>
      </div>

      {/* Qwen bar */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-emerald-400/80">Qwen</span>
          <span className="text-[9px] font-mono text-gray-500">{formatTokens(qwenTokens)}</span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full bg-emerald-500/60 rounded-full transition-all"
            style={{ width: `${qwenPct}%` }}
          />
        </div>
      </div>

      {/* Claude bar */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-violet-400/80">Claude</span>
          <span className="text-[9px] font-mono text-gray-500">{formatTokens(claudeTokens)}</span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full bg-violet-500/60 rounded-full transition-all"
            style={{ width: `${totalTokens > 0 ? (claudeTokens / totalTokens) * 100 : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}
