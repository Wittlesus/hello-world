import { useTauriData } from '../hooks/useTauriData.js';
import { ViewShell } from './ViewShell.js';
import { LoadingState, ErrorState, EmptyState } from './LoadingState.js';

interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  tasksCompleted: string[];
  decisionsMade: string[];
  costUsd: number;
  tokensUsed: number;
  summary: string;
}

interface SessionsData {
  sessions: Session[];
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(startIso: string, endIso?: string): string {
  if (!endIso) return 'ongoing';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function SessionCard({ session, index, total }: { session: Session; index: number; total: number }) {
  const num = total - index;
  const isActive = !session.endedAt;

  return (
    <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono font-semibold text-gray-300">#{num}</span>
          {isActive && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/20 text-green-300">Active</span>
          )}
        </div>
        <span className="text-xs text-gray-500">{formatDateTime(session.startedAt)}</span>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
        <div>Duration: <span className="text-gray-200">{formatDuration(session.startedAt, session.endedAt)}</span></div>
        <div>Cost: <span className="text-gray-200">${session.costUsd.toFixed(2)}</span></div>
        <div>Tokens: <span className="text-gray-200">{session.tokensUsed.toLocaleString()}</span></div>
        <div>Tasks: <span className="text-gray-200">{session.tasksCompleted.length}</span></div>
        <div>Decisions: <span className="text-gray-200">{session.decisionsMade.length}</span></div>
      </div>

      {session.summary && (
        <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-800 leading-relaxed">{session.summary}</p>
      )}
    </div>
  );
}

export function SessionsView() {
  const { data, loading, error, refetch } = useTauriData<SessionsData>('get_sessions');

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const sessions = data?.sessions ?? [];

  return (
    <ViewShell title="Sessions" description={`${sessions.length} session${sessions.length !== 1 ? 's' : ''} recorded`}>
      {sessions.length === 0 ? (
        <EmptyState message="No sessions recorded yet" />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {[...sessions].reverse().map((s, i) => (
            <SessionCard key={s.id} session={s} index={i} total={sessions.length} />
          ))}
        </div>
      )}
    </ViewShell>
  );
}
