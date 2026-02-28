import { useProjectPath } from '../hooks/useProjectPath.js';
import { useClaudeUsage, type ClaudeUsageData, type ModelUsage, type WebUsage } from '../hooks/useClaudeUsage.js';
import { LoadingState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 100) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function friendlyModel(m: string): string {
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return m;
}

function modelColor(m: string): string {
  if (m.includes('opus')) return 'text-violet-400';
  if (m.includes('sonnet')) return 'text-blue-400';
  if (m.includes('haiku')) return 'text-emerald-400';
  return 'text-gray-400';
}

function modelBarColor(m: string): string {
  if (m.includes('opus')) return 'bg-violet-500/70';
  if (m.includes('sonnet')) return 'bg-blue-500/70';
  if (m.includes('haiku')) return 'bg-emerald-500/70';
  return 'bg-gray-500/70';
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </span>
      <div className={`text-2xl font-mono font-bold mt-1 ${color}`}>{value}</div>
      {sub && <span className="text-[10px] text-gray-500 mt-1 block">{sub}</span>}
    </div>
  );
}

function ModelRow({ model, usage, totalCost }: { model: string; usage: ModelUsage; totalCost: number }) {
  const pct = totalCost > 0 ? (usage.costUsd / totalCost) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-16 shrink-0">
        <span className={`text-xs font-mono font-bold ${modelColor(model)}`}>
          {friendlyModel(model)}
        </span>
      </div>
      <div className="flex-1">
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full ${modelBarColor(model)} rounded-full transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="w-20 text-right">
        <span className="text-xs font-mono text-gray-300">{formatCost(usage.costUsd)}</span>
      </div>
      <div className="w-20 text-right">
        <span className="text-[10px] font-mono text-gray-500">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: ClaudeUsageData }) {
  const days = data.dailyActivity.slice(-14); // last 14 days
  if (days.length === 0) return null;

  const maxMsgs = Math.max(...days.map(d => d.messageCount), 1);

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Daily Activity (last 14 days)
      </h3>
      <div className="flex items-end gap-1 h-24">
        {days.map((d) => {
          const h = Math.max(2, (d.messageCount / maxMsgs) * 100);
          const date = new Date(d.date);
          const label = `${date.getMonth() + 1}/${date.getDate()}`;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-violet-500/40 rounded-t hover:bg-violet-500/60 transition-colors"
                style={{ height: `${h}%` }}
                title={`${label}: ${d.messageCount.toLocaleString()} msgs, ${d.sessionCount} sessions`}
              />
              <span className="text-[7px] text-gray-600 font-mono">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TokenBreakdown({ data }: { data: ClaudeUsageData }) {
  const total = data.totalInputTokens + data.totalOutputTokens + data.totalCacheRead + data.totalCacheWrite;
  if (total === 0) return null;

  const segments = [
    { label: 'Cache Read', value: data.totalCacheRead, color: 'bg-blue-500/50', textColor: 'text-blue-400' },
    { label: 'Cache Write', value: data.totalCacheWrite, color: 'bg-purple-500/50', textColor: 'text-purple-400' },
    { label: 'Output', value: data.totalOutputTokens, color: 'bg-green-500/50', textColor: 'text-green-400' },
    { label: 'Input', value: data.totalInputTokens, color: 'bg-yellow-500/50', textColor: 'text-yellow-400' },
  ];

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-3">
        Token Breakdown
      </h3>
      <div className="space-y-1.5">
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          return (
            <div key={s.label} className="flex items-center gap-2">
              <span className={`text-[10px] font-mono w-20 ${s.textColor}`}>{s.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div className={`h-full ${s.color} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-gray-500 w-16 text-right">{formatNum(s.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function timeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 24) {
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  }
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function limitBarColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500/80';
  if (pct >= 50) return 'bg-yellow-500/70';
  return 'bg-sky-500/70';
}

function LimitBar({ label, pct, sub }: { label: string; pct: number; sub: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-300">{label}</span>
        <span className="text-xs font-mono text-gray-400">{pct}% used</span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full ${limitBarColor(pct)} rounded-full transition-all`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-500 mt-0.5 block">{sub}</span>
    </div>
  );
}

function WebUsageLimits({ web }: { web: WebUsage }) {
  const extra = web.extraUsage;
  const spent = extra ? (extra.usedCredits / 100).toFixed(2) : '0';
  const limit = extra ? (extra.monthlyLimit / 100).toFixed(0) : '0';

  return (
    <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
          Claude.ai Limits
        </h3>
        <span className="text-[9px] font-mono text-gray-600">
          fetched {new Date(web.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="space-y-3">
        <LimitBar
          label="Current Session"
          pct={web.fiveHour.utilization}
          sub={`Resets in ${timeUntil(web.fiveHour.resetsAt)}`}
        />
        <LimitBar
          label="Weekly (All Models)"
          pct={web.sevenDay.utilization}
          sub={`Resets ${timeUntil(web.sevenDay.resetsAt)}`}
        />
        {web.sevenDaySonnet && (
          <LimitBar
            label="Weekly (Sonnet)"
            pct={web.sevenDaySonnet.utilization}
            sub={`Resets ${timeUntil(web.sevenDaySonnet.resetsAt)}`}
          />
        )}
        {extra && extra.isEnabled && (
          <LimitBar
            label={`Extra Usage: $${spent} / $${limit}`}
            pct={extra.utilization}
            sub="Monthly spend"
          />
        )}
      </div>
    </div>
  );
}

export function CostView() {
  const projectPath = useProjectPath();
  const { data, loading } = useClaudeUsage(projectPath);

  if (loading && !data) return <LoadingState />;

  if (!data) {
    return (
      <ViewShell title="Cost" description="Claude Code usage and spending">
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-4 py-3 max-w-3xl">
          <p className="text-xs text-blue-300/80">
            No usage data found. Usage data is generated from ~/.claude/stats-cache.json on session start.
          </p>
        </div>
      </ViewShell>
    );
  }

  const models = Object.entries(data.modelBreakdown)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd);

  const costPerSession = data.totalSessions > 0 ? data.totalCostUsd / data.totalSessions : 0;
  const costPerMessage = data.totalMessages > 0 ? data.totalCostUsd / data.totalMessages : 0;

  return (
    <ViewShell title="Cost" description="Claude Code usage and spending">
      {/* Web usage limits */}
      {data.webUsage && <WebUsageLimits web={data.webUsage} />}

      {/* Top stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total Spent"
          value={formatCost(data.totalCostUsd)}
          sub={`since ${data.firstSessionDate ? new Date(data.firstSessionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'start'}`}
          color="text-gray-100"
        />
        <StatCard
          label="Sessions"
          value={data.totalSessions.toString()}
          sub={`${formatCost(costPerSession)}/session avg`}
          color="text-violet-400"
        />
        <StatCard
          label="Messages"
          value={formatNum(data.totalMessages)}
          sub={`${formatCost(costPerMessage * 1000)}/1K msgs`}
          color="text-blue-400"
        />
        <StatCard
          label="Output Tokens"
          value={formatNum(data.totalOutputTokens)}
          sub="generated"
          color="text-emerald-400"
        />
      </div>

      {/* Model breakdown + tokens */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Cost by Model
          </h3>
          {models.map(([model, usage]) => (
            <ModelRow key={model} model={model} usage={usage} totalCost={data.totalCostUsd} />
          ))}
        </div>

        <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4">
          <TokenBreakdown data={data} />
        </div>
      </div>

      {/* Daily chart */}
      <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4 mb-6">
        <DailyChart data={data} />
      </div>

      {/* Data freshness note */}
      <div className="text-[9px] text-gray-600 font-mono">
        Data from stats-cache.json (last computed: {data.lastComputedDate ?? 'unknown'}).
        Generated: {new Date(data.generatedAt).toLocaleString()}.
      </div>
    </ViewShell>
  );
}
CostView.displayName = 'CostView';
