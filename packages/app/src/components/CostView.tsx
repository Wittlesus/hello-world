import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { ErrorState, LoadingState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

interface Session {
  id: string;
  startedAt: string;
  costUsd: number;
  tokensUsed: number;
  tasksCompleted: string[];
}

interface SessionsData {
  sessions: Session[];
}

interface ConfigData {
  config: {
    dailyBudgetUsd: number;
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
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

export function CostView() {
  const projectPath = useProjectPath();
  const {
    data: sessionsData,
    loading: sLoading,
    error: sError,
    refetch: sRefetch,
  } = useTauriData<SessionsData>('get_sessions', projectPath);
  const {
    data: configData,
    loading: cLoading,
    error: cError,
  } = useTauriData<ConfigData>('get_config', projectPath);

  if (sLoading || cLoading) return <LoadingState />;
  if (sError) return <ErrorState message={sError} onRetry={sRefetch} />;
  if (cError) return <ErrorState message={cError} />;

  const sessions = sessionsData?.sessions ?? [];
  const budget = configData?.config?.dailyBudgetUsd ?? 5;

  const totalSpent = sessions.reduce((sum, s) => sum + s.costUsd, 0);
  const totalTokens = sessions.reduce((sum, s) => sum + s.tokensUsed, 0);

  const today = new Date().toDateString();
  const todaySpent = sessions
    .filter((s) => new Date(s.startedAt).toDateString() === today)
    .reduce((sum, s) => sum + s.costUsd, 0);
  const remaining = Math.max(0, budget - todaySpent);
  const remainingPercent = budget > 0 ? (remaining / budget) * 100 : 100;
  const remainingColor =
    remainingPercent > 50
      ? 'text-green-400'
      : remainingPercent > 20
        ? 'text-yellow-400'
        : 'text-red-400';

  return (
    <ViewShell title="Cost" description="Spending by session and budget tracking">
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total spent"
          value={`$${totalSpent.toFixed(2)}`}
          sub={`${totalTokens.toLocaleString()} tokens`}
          color="text-gray-100"
        />
        <StatCard
          label="Daily budget"
          value={`$${budget.toFixed(2)}`}
          sub="per day"
          color="text-gray-100"
        />
        <StatCard
          label="Remaining today"
          value={`$${remaining.toFixed(2)}`}
          sub={`${remainingPercent.toFixed(0)}% left`}
          color={remainingColor}
        />
      </div>

      {totalSpent === 0 && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-4 py-3 mb-6 max-w-3xl">
          <p className="text-xs text-blue-300/80">
            Cost data populates as sessions run. Token usage is estimated per session and
            accumulated here.
          </p>
        </div>
      )}

      <div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-2 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                #
              </th>
              <th className="text-left py-2 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Date
              </th>
              <th className="text-right py-2 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Cost
              </th>
              <th className="text-right py-2 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Tokens
              </th>
              <th className="text-right py-2 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Tasks
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 px-3 text-center text-sm text-gray-500">
                  Cost data populates as sessions run. Token usage is estimated per session and
                  accumulated here.
                </td>
              </tr>
            ) : (
              [...sessions].reverse().map((s, i) => (
                <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                  <td className="py-2 px-3 font-mono text-gray-400">{sessions.length - i}</td>
                  <td className="py-2 px-3 text-gray-300">{formatDate(s.startedAt)}</td>
                  <td className="py-2 px-3 text-right font-mono text-gray-300">
                    ${s.costUsd.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-gray-400">
                    {s.tokensUsed.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-400">{s.tasksCompleted.length}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ViewShell>
  );
}
