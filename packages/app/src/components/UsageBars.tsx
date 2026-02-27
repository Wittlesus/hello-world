import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { useClaudeUsage } from '../hooks/useClaudeUsage.js';

interface QwenEntry {
  timestamp: string;
  provider: string;
  model: string;
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

const QWEN_BUDGET = 5.0;

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

function glowColor(pct: number): string {
  if (pct >= 80) return 'text-red-400 drop-shadow-[0_0_4px_rgba(248,113,113,0.6)]';
  if (pct >= 50) return 'text-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.6)]';
  return 'text-sky-400 drop-shadow-[0_0_4px_rgba(56,189,248,0.6)]';
}

function detectService(entries: QwenEntry[]): string {
  if (!entries.length) return 'OpenRouter';
  const last = entries[entries.length - 1];
  const model = last.model ?? '';
  if (model.startsWith('qwen/')) return 'OpenRouter';
  if (model.startsWith('Qwen/')) return 'Chutes.ai';
  return 'OpenRouter';
}

function MiniBar({ label, pct, detail, service }: { label: string; pct: number; detail: string; service?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</span>
          {service && (
            <span className={`text-[8px] font-mono ${glowColor(pct)}`}>
              {service}
            </span>
          )}
        </div>
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

  const entries = qwenData?.entries ?? [];
  const totalCost = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  const qwenPct = Math.min(100, (totalCost / QWEN_BUDGET) * 100);
  const qwenService = detectService(entries);

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
        title={`Session: ${sessionPct}% | Weekly: ${weeklyPct}% | Extra: ${extraPct}% | Qwen: $${totalCost.toFixed(2)}/$${QWEN_BUDGET}`}
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
          <MiniBar label="Session" pct={sessionPct} detail={`${sessionPct}%`} service="claude.ai" />
          <MiniBar label="Weekly" pct={weeklyPct} detail={`${weeklyPct}%`} service="claude.ai" />
          {web.extraUsage && web.extraUsage.isEnabled && (
            <MiniBar label="Extra" pct={extraPct} detail={`${extraSpent} (${extraPct}%)`} service="claude.ai" />
          )}
        </>
      )}

      {/* Qwen cost bar */}
      <MiniBar
        label="Qwen"
        pct={qwenPct}
        detail={`$${totalCost.toFixed(2)} / $${QWEN_BUDGET}`}
        service={qwenService}
      />

      {/* Session messages */}
      <MiniBar
        label="Msgs"
        pct={Math.min(100, (sessionMsgs / 50) * 100)}
        detail={`${sessionMsgs}`}
      />
    </div>
  );
}
