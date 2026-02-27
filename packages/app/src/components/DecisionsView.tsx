import { useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { EmptyState, ErrorState, LoadingState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

interface Decision {
  id: string;
  title: string;
  context: string;
  chosen: string;
  alternatives: Array<{ option: string; tradeoff: string }>;
  rationale: string;
  decidedAt: string;
  decidedBy: 'pat' | 'claude' | 'both';
}

interface StateData {
  decisions: Decision[];
}

const DECIDED_BY_CONFIG: Record<string, { style: string; label: string }> = {
  pat: { style: 'bg-blue-500/20 text-blue-300', label: 'Pat' },
  claude: { style: 'bg-purple-500/20 text-purple-300', label: 'Claude' },
  both: { style: 'bg-emerald-500/20 text-emerald-300', label: 'Both' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function DecisionCard({ decision }: { decision: Decision }) {
  const [expanded, setExpanded] = useState(false);
  const by = DECIDED_BY_CONFIG[decision.decidedBy] ?? {
    style: 'bg-gray-500/20 text-gray-300',
    label: decision.decidedBy,
  };

  return (
    <button
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      className="w-full text-left bg-[#1a1a24] border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-gray-100 leading-snug">{decision.title}</span>
        <span className="shrink-0 text-[10px] text-gray-500">{formatDate(decision.decidedAt)}</span>
      </div>

      <div className="mt-2">
        <span className="text-xs text-gray-400">We went with: </span>
        <span className="text-xs font-medium text-green-300">{decision.chosen}</span>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${by.style}`}>
          {by.label}
        </span>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-3">
          {decision.context && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500">
                Context
              </span>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{decision.context}</p>
            </div>
          )}

          {decision.rationale && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500">Rationale</span>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{decision.rationale}</p>
            </div>
          )}

          {decision.alternatives.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500">Alternatives</span>
              <div className="mt-1 space-y-1">
                {decision.alternatives.map((alt, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-gray-400 shrink-0">{alt.option}:</span>
                    <span className="text-gray-500">{alt.tradeoff}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

export function DecisionsView() {
  const projectPath = useProjectPath();
  const { data, loading, error, refetch } = useTauriData<StateData>('get_state', projectPath);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const decisions = data?.decisions ?? [];

  return (
    <ViewShell
      title="Decisions"
      description={`${decisions.length} choice${decisions.length !== 1 ? 's' : ''} made so far`}
    >
      {decisions.length === 0 ? (
        <EmptyState message="No decisions recorded yet. Use hw_record_decision when an architectural choice is made — these accumulate into your project's decision log." />
      ) : (
        <div className="space-y-3">
          {[...decisions].reverse().map((d) => (
            <DecisionCard key={d.id} decision={d} />
          ))}
        </div>
      )}
    </ViewShell>
  );
}
